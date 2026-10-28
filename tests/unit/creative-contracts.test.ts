import { describe, expect, it } from "vitest";
import { reviewSchema, scriptSchema } from "@/types/creative";

const scene = {
  sceneNumber: 1,
  duration: 5,
  voiceover: "Still managing your hotel manually?",
  caption: "Less admin. More hospitality.",
  visualPrompt: "An independent hotel owner working at a bright reception desk.",
};
const script = {
  script: "Complete ad script",
  voiceover: "Complete spoken narration",
  scenes: [scene, { ...scene, sceneNumber: 2 }, { ...scene, sceneNumber: 3 }],
};
const review = {
  hook_strength: 8,
  clarity: 9,
  audience_relevance: 8,
  cta_strength: 8,
  overall_score: 8.3,
  problems: [],
  suggestions: ["Make the opening more specific."],
};

describe("structured creative contracts", () => {
  it("requires structured scenes and rejects arbitrary prose", () => {
    expect(scriptSchema.safeParse(script).success).toBe(true);
    expect(scriptSchema.safeParse("Here is your script...").success).toBe(false);
    expect(scriptSchema.safeParse({ ...script, scenes: [scene] }).success).toBe(false);
  });

  it("rejects duplicate or out-of-order scenes and missing visual instructions", () => {
    expect(scriptSchema.safeParse({ ...script, scenes: [scene, scene, scene] }).success).toBe(
      false,
    );
    expect(
      scriptSchema.safeParse({
        ...script,
        scenes: script.scenes.map((value) => ({ ...value, visualPrompt: "" })),
      }).success,
    ).toBe(false);
  });

  it("accepts fractional scores and requires all review dimensions", () => {
    expect(reviewSchema.safeParse(review).success).toBe(true);
    expect(reviewSchema.safeParse({ overall_score: 8 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, clarity: 11 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, hook_strength: 0 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, overall_score: "8" }).success).toBe(false);
  });
});
