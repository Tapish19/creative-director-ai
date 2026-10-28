import { describe, expect, it } from "vitest";
import { planSchemaForDuration, scriptSchemaForDuration } from "@/types/creative";
import { plannerRequest } from "@/services/ai/planner";
import { writerRequest } from "@/services/ai/writer";
import { testBrief, testPlan, testScript } from "../fixtures/creative";

describe("planner and writer duration contracts", () => {
  it("accepts a coherent 15-second storyboard and a 30-second variant", () => {
    expect(planSchemaForDuration(15).parse(testPlan)).toEqual(testPlan);
    expect(scriptSchemaForDuration(15).parse(testScript)).toEqual(testScript);
    expect(
      scriptSchemaForDuration(30).safeParse({
        ...testScript,
        scenes: testScript.scenes.map((scene) => ({ ...scene, duration: 10 })),
      }).success,
    ).toBe(true);
  });

  it("rejects duration drift in either agent", () => {
    expect(planSchemaForDuration(30).safeParse(testPlan).success).toBe(false);
    expect(scriptSchemaForDuration(30).safeParse(testScript).success).toBe(false);
  });

  it("rejects narration that differs from scenes or cannot fit into the scene", () => {
    expect(
      scriptSchemaForDuration(15).safeParse({ ...testScript, voiceover: "Unrelated narration" })
        .success,
    ).toBe(false);
    const scenes = testScript.scenes.map((scene, i) => ({
      ...scene,
      voiceover: i === 0 ? "word ".repeat(20).trim() : scene.voiceover,
    }));
    expect(
      scriptSchemaForDuration(15).safeParse({
        ...testScript,
        scenes,
        voiceover: scenes.map((scene) => scene.voiceover).join(" "),
      }).success,
    ).toBe(false);
  });

  it("carries validated context and repair guidance into the next request", () => {
    const planner = plannerRequest(testBrief, ["Scene durations must sum to exactly 15 seconds."]);
    expect(planner.prompt).toContain("Scene durations must sum to exactly 15 seconds.");
    expect(planner.system).toContain("untrusted data");
    const writer = writerRequest(testBrief, testPlan);
    expect(writer.prompt).toContain(testPlan.campaignAngle);
    expect(writer.prompt).toContain("37 spoken words");
    expect(writer.system).toContain("you have not visited it");
  });
});
