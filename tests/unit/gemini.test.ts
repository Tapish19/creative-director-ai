import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "@/services/ai/gemini";
import { retryDelayMs } from "@/services/ai/errors";
import { plannerRequest } from "@/services/ai/planner";
import { writerRequest } from "@/services/ai/writer";
import { readWorkerConfig } from "@/workers/config";
import { geminiResponse, testBrief, testPlan, testScript } from "../fixtures/creative";

const minimal = {
  system: "system",
  prompt: "prompt",
  schema: z.object({ name: z.string() }).strict(),
};

describe("Gemini structured adapter", () => {
  it("sends credentials in a header, transmits a JSON schema and validates the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(geminiResponse(testPlan));
    const provider = new GeminiProvider({ apiKey: "test-secret", fetcher });
    const result = await provider.generateStructured(plannerRequest(testBrief));
    expect(result.data).toEqual(testPlan);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 240 });
    expect(result.model).toBe("gemini-test-version");
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).not.toContain("test-secret");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-secret" });
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.scenePlan.minItems).toBe(3);
    expect(body.contents[0].parts[0].text).toContain("MyHotelLine");
  });

  it("supports refined script schemas and removes internal thought text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { thought: true, text: "internal thought" },
                { text: JSON.stringify(testScript) },
              ],
            },
          },
        ],
      }),
    );
    const result = await new GeminiProvider({ apiKey: "key", fetcher }).generateStructured(
      writerRequest(testBrief, testPlan),
    );
    expect(result.data).toEqual(testScript);
  });

  it.each([
    [429, "rate_limit", true],
    [503, "unavailable", true],
    [408, "unavailable", true],
    [401, "configuration", false],
    [403, "configuration", false],
    [404, "configuration", false],
    [400, "request_rejected", false],
  ])(
    "classifies HTTP %s without persisting provider error bodies",
    async (status, code, retryable) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("secret-bearing upstream diagnostics", {
          status: Number(status),
          headers: { "retry-after": "120" },
        }),
      );
      const call = new GeminiProvider({ apiKey: "key", fetcher }).generateStructured(minimal);
      await expect(call).rejects.toMatchObject({ code, retryable });
      await expect(call).rejects.not.toHaveProperty(
        "message",
        expect.stringContaining("secret-bearing"),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (status === 429)
        await expect(call).rejects.toMatchObject({ details: { retryAfterMs: 120_000 } });
    },
  );

  it("does not salvage arbitrary prose or Markdown as JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: '```json\n{"name":"test"}\n```' }] },
          },
        ],
      }),
    );
    await expect(
      new GeminiProvider({ apiKey: "key", fetcher }).generateStructured(minimal),
    ).rejects.toMatchObject({ code: "invalid_json", retryable: true });
  });

  it("includes bounded validation feedback for a repair attempt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(geminiResponse({ name: 123 }));
    await expect(
      new GeminiProvider({ apiKey: "key", fetcher }).generateStructured(minimal),
    ).rejects.toMatchObject({
      code: "invalid_output",
      details: { validationIssues: [expect.stringContaining("name")] },
    });
  });

  it("rejects truncation and blocked outputs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse({ name: "test" }, { finishReason: "MAX_TOKENS" }))
      .mockResolvedValueOnce(Response.json({ promptFeedback: { blockReason: "SAFETY" } }));
    const provider = new GeminiProvider({ apiKey: "key", fetcher });
    await expect(provider.generateStructured(minimal)).rejects.toMatchObject({
      code: "invalid_output",
    });
    await expect(provider.generateStructured(minimal)).rejects.toMatchObject({
      code: "blocked",
      retryable: false,
    });
  });

  it("rejects oversized responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(256_001)));
    await expect(
      new GeminiProvider({ apiKey: "key", fetcher }).generateStructured(minimal),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("times out a hanging transport", async () => {
    const fetcher: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
      );
    await expect(
      new GeminiProvider({ apiKey: "key", fetcher, timeoutMs: 20 }).generateStructured(minimal),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });

  it("propagates lease cancellation without making a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new GeminiProvider({ apiKey: "key", fetcher }).generateStructured({
        ...minimal,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("honors provider Retry-After even when longer than the backoff cap", () => {
    expect(retryDelayMs(1, 120_000, () => 0)).toBe(120_000);
    expect(retryDelayMs(2, 0, () => 0)).toBe(2_000);
  });

  it("requires real configuration and never logs secret values in configuration failures", () => {
    expect(() => new GeminiProvider({ apiKey: "" })).toThrow("GEMINI_API_KEY");
    expect(() => new GeminiProvider({ apiKey: "private", model: "../evil?key=secret" })).toThrow(
      "GEMINI_MODEL",
    );
    expect(() => readWorkerConfig({ SUPABASE_URL: "secret-invalid-url" })).toThrow("SUPABASE_URL");
    expect(() => readWorkerConfig({ SUPABASE_URL: "secret-invalid-url" })).not.toThrow(
      "secret-invalid-url",
    );
  });
});
