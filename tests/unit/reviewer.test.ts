import { describe, expect, it, vi } from "vitest";
import { reviewerRequest } from "@/services/ai/reviewer";
import { GeminiProvider } from "@/services/ai/gemini";
import { reviewSchema, reviewSchemaForThreshold } from "@/types/creative";
import { readReviewWorkerConfig } from "@/workers/config";
import { testBrief, testScript, geminiResponse } from "../fixtures/creative";
import { testReview } from "../helpers/review-store";
describe("review contract", () => {
  it("uses an explicit audiovisual rubric and treats all creative content as data", () => {
    const request = reviewerRequest(testBrief, testScript, 8);
    expect(request.system).toContain("untrusted creative content");
    expect(request.prompt).toContain("Watch and listen");
    expect(request.prompt).toContain("0-3 seconds");
    expect(request.prompt).toContain(testScript.voiceover);
    expect(request.prompt).not.toContain("threshold");
  });
  it.each([
    { ...testReview, hook_strength: 0 },
    { ...testReview, clarity: 10.1 },
    { ...testReview, cta_strength: 8.11 },
    { ...testReview, overall_score: 9 },
    { ...testReview, problems: [""] },
    { ...testReview, suggestions: [] },
    { ...testReview, suggestions: ["x".repeat(501)] },
    { ...testReview, unrequested: 10 },
  ])("rejects invalid or misleading structured scores %#", (data) => {
    expect(reviewSchema.safeParse(data).success).toBe(false);
  });
  it("rounds half up without binary floating-point drift and requires low-score feedback", () => {
    expect(
      reviewSchema.parse({
        ...testReview,
        hook_strength: 8.1,
        clarity: 8.2,
        audience_relevance: 8.3,
        cta_strength: 8.4,
        overall_score: 8.3,
      }).overall_score,
    ).toBe(8.3);
    expect(reviewSchemaForThreshold(8).safeParse(testReview).success).toBe(true);
    expect(reviewSchemaForThreshold(8.1).safeParse(testReview).success).toBe(false);
    expect(
      reviewSchemaForThreshold(8.1).safeParse({
        ...testReview,
        problems: ["The opening is generic."],
      }).success,
    ).toBe(true);
  });
  it("keeps video bytes in the provider request and uses the structured review schema", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => geminiResponse(testReview));
    await new GeminiProvider({ apiKey: "secret", fetcher }).generateStructured({
      ...reviewerRequest(testBrief, testScript, 8),
      media: { mimeType: "video/mp4", data: new Uint8Array([1, 2, 3]) },
    });
    const [url, init] = fetcher.mock.calls[0],
      body = JSON.parse(String(init?.body));
    expect(String(url)).not.toContain("secret");
    expect(body.contents[0].parts[0].inlineData.data).toBe("AQID");
    expect(body.generationConfig.responseJsonSchema.properties.hook_strength.minimum).toBe(1);
    expect(body.generationConfig.responseJsonSchema.properties.overall_score.maximum).toBe(10);
  });
  it.each([0, 12 * 1024 * 1024 + 1])(
    "rejects %s video bytes before making a request",
    async (size) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        new GeminiProvider({ apiKey: "secret", fetcher }).generateStructured({
          ...reviewerRequest(testBrief, testScript, 8),
          media: { mimeType: "video/mp4", data: new Uint8Array(size) },
        }),
      ).rejects.toMatchObject({ code: "request_rejected", retryable: false });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("validates threshold configuration without leaking credentials", () => {
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key-long",
      GEMINI_API_KEY: "test-only",
    };
    expect(readReviewWorkerConfig(env).QUALITY_THRESHOLD).toBe(8);
    expect(readReviewWorkerConfig({ ...env, QUALITY_THRESHOLD: "8.4" }).QUALITY_THRESHOLD).toBe(
      8.4,
    );
    for (const value of ["NaN", "0", "10.1", "8.123"])
      expect(() => readReviewWorkerConfig({ ...env, QUALITY_THRESHOLD: value })).toThrow(
        "QUALITY_THRESHOLD",
      );
  });
});
