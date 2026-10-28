import { z } from "zod";
import type { ImageProvider } from "./provider";
import { ImageError } from "./errors";

export const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const envelope = z.object({
  success: z.literal(true),
  result: z.object({ image: z.string().min(4) }),
});

export class CloudflareImageProvider implements ImageProvider {
  readonly name = "cloudflare";
  readonly model = CLOUDFLARE_IMAGE_MODEL;
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly config: { accountId: string; apiToken: string; fetch?: typeof fetch },
  ) {
    if (!/^[a-f0-9]{32}$/i.test(config.accountId) || !config.apiToken.trim())
      throw new ImageError(
        "configuration",
        "Cloudflare image credentials are missing or invalid.",
        false,
      );
    this.fetcher = config.fetch ?? fetch;
  }

  async generate(request: Parameters<ImageProvider["generate"]>[0]) {
    if (!request.prompt.trim() || request.prompt.length > 2048)
      throw new ImageError("invalid_prompt", "Image prompt must contain 1–2048 characters.", false);
    const signal = AbortSignal.any([
      AbortSignal.timeout(90_000),
      ...(request.signal ? [request.signal] : []),
    ]);
    try {
      const response = await this.fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/ai/run/${this.model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            "Content-Type": "application/json",
          },
          // FLUX Schnell documents prompt/steps, not width/height. The pipeline
          // explicitly crops the returned image to the requested portrait canvas.
          body: JSON.stringify({ prompt: request.prompt, steps: 4 }),
          signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new ImageError(
            "configuration",
            "Cloudflare rejected the image credentials or account permissions.",
            false,
          );
        if (response.status === 429) {
          const value = response.headers.get("retry-after") ?? "";
          const delay = /^\d+(\.\d+)?$/.test(value)
            ? Number(value) * 1000
            : Date.parse(value) - Date.now();
          throw new ImageError(
            "rate_limit",
            "Cloudflare image quota or rate limit reached.",
            true,
            Number.isFinite(delay) ? Math.max(0, delay) : 0,
          );
        }
        throw new ImageError(
          "request_rejected",
          "Cloudflare could not generate this scene image.",
          response.status >= 500 || response.status === 408,
        );
      }
      if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body) {
        await response.body?.cancel();
        throw new ImageError(
          "invalid_image",
          "The image response exceeded the allowed size or was empty.",
          true,
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new ImageError(
              "invalid_image",
              "The image response exceeded the allowed size.",
              true,
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      let result: z.infer<typeof envelope>;
      try {
        result = envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        throw new ImageError(
          "invalid_image",
          "Cloudflare returned an invalid image response.",
          true,
        );
      }
      const encoded = result.result.image;
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new ImageError("invalid_image", "Cloudflare returned invalid image data.", true);
      const data = Buffer.from(encoded, "base64");
      const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
      if ((!png && !jpeg) || data.length > 6 * 1024 * 1024)
        throw new ImageError(
          "invalid_image",
          "Cloudflare returned an unsupported image file.",
          true,
        );
      return {
        data,
        contentType: png ? ("image/png" as const) : ("image/jpeg" as const),
        provider: this.name,
      };
    } catch (error) {
      if (request.signal?.aborted)
        throw new ImageError("cancelled", "Image generation was interrupted.", true);
      if (error instanceof ImageError) throw error;
      if (signal.aborted)
        throw new ImageError("timeout", "Cloudflare image generation timed out.", true);
      throw new ImageError(
        "unavailable",
        "Cloudflare image generation is temporarily unavailable.",
        true,
      );
    }
  }
}
