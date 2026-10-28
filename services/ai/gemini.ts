import { z } from "zod";
import { AIError } from "./errors";
import type { AIProvider, AIRequest, AIResult } from "./provider";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const MAX_RESPONSE_BYTES = 256_000;

const envelopeSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({ text: z.string().optional(), thought: z.boolean().optional() }),
            ),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  modelVersion: z.string().optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().nonnegative().optional(),
      candidatesTokenCount: z.number().nonnegative().optional(),
    })
    .optional(),
});

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body)
    throw new AIError("invalid_output", "Gemini returned an empty response.", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AIError(
          "invalid_output",
          "Gemini returned an unexpectedly large response.",
          true,
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** One HTTP attempt. Durable retries belong to the orchestrator, never to two nested loops. */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly config: {
      apiKey: string;
      model?: string;
      timeoutMs?: number;
      fetcher?: typeof fetch;
    },
  ) {
    if (!config.apiKey.trim())
      throw new AIError("configuration", "GEMINI_API_KEY is missing.", false);
    this.model = config.model?.trim() || DEFAULT_GEMINI_MODEL;
    if (!/^gemini-[a-z0-9.-]+$/.test(this.model))
      throw new AIError("configuration", "GEMINI_MODEL must be a valid Gemini model ID.", false);
    this.timeoutMs = config.timeoutMs ?? 60_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000)
      throw new AIError(
        "configuration",
        "The Gemini timeout must be between 1 and 120000 milliseconds.",
        false,
      );
    this.fetcher = config.fetcher ?? fetch;
  }

  async generateStructured<T>(request: AIRequest<T>): Promise<AIResult<T>> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      signal.throwIfAborted();
      if (
        request.media &&
        (request.media.mimeType !== "video/mp4" ||
          request.media.data.byteLength === 0 ||
          request.media.data.byteLength > 12 * 1024 * 1024)
      )
        throw new AIError(
          "request_rejected",
          "Video review requires a non-empty MP4 of at most 12 MiB.",
          false,
        );
      const response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [
              {
                role: "user",
                parts: [
                  ...(request.media
                    ? [
                        {
                          inlineData: {
                            mimeType: request.media.mimeType,
                            data: Buffer.from(request.media.data).toString("base64"),
                          },
                        },
                      ]
                    : []),
                  { text: request.prompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: z.toJSONSchema(request.schema),
              maxOutputTokens: 8192,
            },
          }),
        },
      );

      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429)
          throw new AIError(
            "rate_limit",
            "Gemini rate limit reached. A retry will respect the provider’s delay.",
            true,
            { retryAfterMs: retryAfter(response.headers.get("retry-after")) },
          );
        if (response.status === 401 || response.status === 403)
          throw new AIError(
            "configuration",
            "Gemini rejected the credentials or project permissions.",
            false,
          );
        if (response.status === 404)
          throw new AIError(
            "configuration",
            "The configured Gemini model is unavailable. Check GEMINI_MODEL.",
            false,
          );
        if (response.status === 408 || response.status >= 500)
          throw new AIError("unavailable", "Gemini is temporarily unavailable.", true);
        throw new AIError(
          "request_rejected",
          "Gemini rejected this request. Check the provider configuration and supported schema.",
          false,
        );
      }

      const body = await readBoundedBody(response);
      let envelope: z.infer<typeof envelopeSchema>;
      try {
        envelope = envelopeSchema.parse(JSON.parse(body));
      } catch {
        throw new AIError("invalid_output", "Gemini returned an invalid response envelope.", true);
      }
      const candidate = envelope.candidates?.[0];
      if (
        envelope.promptFeedback?.blockReason ||
        (candidate?.finishReason &&
          [
            "SAFETY",
            "RECITATION",
            "BLOCKLIST",
            "PROHIBITED_CONTENT",
            "SPII",
            "IMAGE_SAFETY",
          ].includes(candidate.finishReason))
      ) {
        throw new AIError(
          "blocked",
          "Gemini blocked this creative request. Revise the brief before trying again.",
          false,
        );
      }
      const rawText =
        candidate?.content?.parts
          .filter((part) => !part.thought)
          .map((part) => part.text ?? "")
          .join("") ?? "";
      const diagnostics = { rawText: rawText.slice(0, 32_000) };
      if (candidate?.finishReason !== "STOP" || !rawText.trim())
        throw new AIError(
          "invalid_output",
          "Gemini did not finish a complete structured response.",
          true,
          diagnostics,
        );

      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new AIError("invalid_json", "Gemini returned invalid JSON.", true, diagnostics);
      }
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        const validationIssues = parsed.error.issues
          .slice(0, 12)
          .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`);
        throw new AIError(
          "invalid_output",
          "Gemini’s response did not satisfy the creative contract.",
          true,
          { ...diagnostics, validationIssues },
        );
      }
      return {
        data: parsed.data,
        model: envelope.modelVersion ?? this.model,
        usage: envelope.usageMetadata
          ? {
              inputTokens: envelope.usageMetadata.promptTokenCount ?? 0,
              outputTokens: envelope.usageMetadata.candidatesTokenCount ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      if (request.signal?.aborted)
        throw new AIError("cancelled", "The generation attempt was interrupted.", false);
      if (timeout.aborted)
        throw new AIError("timeout", "Gemini exceeded the response time limit.", true);
      if (error instanceof AIError) throw error;
      throw new AIError("unavailable", "Could not reach Gemini. The request may be retried.", true);
    }
  }
}
