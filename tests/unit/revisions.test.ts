import { describe, expect, it } from "vitest";
import { editedScript, revisionRequestSchema } from "@/types/revision";
import { readReviewWorkerConfig } from "@/workers/config";
import { testScript } from "../fixtures/creative";
describe("revision contracts", () => {
  it("builds a consistent script and full voiceover from editable scenes", () => {
    const result = editedScript(testScript.scenes, 15);
    expect(result.voiceover).toBe(testScript.voiceover);
    expect(result.script).toContain("Scene 1 (5s)");
    expect(result.scenes).toEqual(testScript.scenes);
  });
  it("rejects missing scenes, broken duration totals and overlong speech", () => {
    expect(() => editedScript(testScript.scenes.slice(0, 2), 15)).toThrow();
    expect(() => editedScript(testScript.scenes, 30)).toThrow();
    expect(() =>
      editedScript(
        testScript.scenes.map((scene) => ({ ...scene, voiceover: "a ".repeat(30) })),
        15,
      ),
    ).toThrow();
    expect(
      revisionRequestSchema.safeParse({ mode: "feedback", instruction: "x".repeat(2001) }).success,
    ).toBe(false);
  });
  it("rejects unsafe revision limits instead of silently allowing more than two", () => {
    const env = {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key-long-enough",
      GEMINI_API_KEY: "test-only",
    };
    expect(readReviewWorkerConfig(env).MAX_AUTOMATIC_REVISIONS).toBe(2);
    for (const limit of ["0", "1", "2"])
      expect(
        readReviewWorkerConfig({ ...env, MAX_AUTOMATIC_REVISIONS: limit }).MAX_AUTOMATIC_REVISIONS,
      ).toBe(Number(limit));
    for (const limit of ["3", "-1", "1.5", "NaN"])
      expect(() => readReviewWorkerConfig({ ...env, MAX_AUTOMATIC_REVISIONS: limit })).toThrow(
        "MAX_AUTOMATIC_REVISIONS",
      );
  });
});
