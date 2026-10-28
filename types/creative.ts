import { z } from "zod";

export const sceneSchema = z
  .object({
    sceneNumber: z.number().int().min(1).max(5),
    duration: z.number().positive().max(30),
    voiceover: z.string().min(1).max(1000),
    caption: z.string().min(1).max(80),
    visualPrompt: z.string().min(20).max(3000),
  })
  .strict();

export const planSchema = z
  .object({
    targetAudience: z.string().min(1).max(500),
    painPoints: z.array(z.string().min(1).max(500)).min(1).max(6),
    campaignAngle: z.string().min(1).max(1000),
    hook: z.string().min(1).max(300),
    cta: z.string().min(1).max(300),
    scenePlan: z
      .array(
        z
          .object({ purpose: z.string().min(1).max(1000), duration: z.number().positive().max(30) })
          .strict(),
      )
      .min(3)
      .max(5),
  })
  .strict();

export const scriptSchema = z
  .object({
    script: z.string().min(1).max(8000),
    voiceover: z.string().min(1).max(2000),
    scenes: z.array(sceneSchema).min(3).max(5),
  })
  .strict()
  .superRefine(({ scenes }, ctx) => {
    scenes.forEach((scene, i) => {
      if (scene.sceneNumber !== i + 1)
        ctx.addIssue({
          code: "custom",
          path: ["scenes", i, "sceneNumber"],
          message: "Scenes must be consecutively numbered from 1.",
        });
    });
  });

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");
export const spokenWordCount = (value: string) =>
  normalizeWhitespace(value).split(" ").filter(Boolean).length;

export function planSchemaForDuration(duration: 15 | 30) {
  return planSchema.superRefine((plan, context) => {
    const total = plan.scenePlan.reduce((sum, scene) => sum + scene.duration, 0);
    if (Math.abs(total - duration) > 0.01)
      context.addIssue({
        code: "custom",
        path: ["scenePlan"],
        message: `Scene durations must sum to exactly ${duration} seconds.`,
      });
  });
}

export function scriptSchemaForDuration(duration: 15 | 30) {
  return scriptSchema.superRefine((script, context) => {
    const total = script.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    if (Math.abs(total - duration) > 0.01)
      context.addIssue({
        code: "custom",
        path: ["scenes"],
        message: `Scene durations must sum to exactly ${duration} seconds.`,
      });
    if (
      normalizeWhitespace(script.voiceover) !==
      normalizeWhitespace(script.scenes.map((scene) => scene.voiceover).join(" "))
    )
      context.addIssue({
        code: "custom",
        path: ["voiceover"],
        message: "Full voiceover must match the ordered scene voiceovers exactly.",
      });
    if (spokenWordCount(script.voiceover) > Math.floor(duration * 2.5))
      context.addIssue({
        code: "custom",
        path: ["voiceover"],
        message: `Use no more than ${Math.floor(duration * 2.5)} spoken words.`,
      });
    script.scenes.forEach((scene, index) => {
      if (spokenWordCount(scene.voiceover) > Math.floor(scene.duration * 2.8))
        context.addIssue({
          code: "custom",
          path: ["scenes", index, "voiceover"],
          message: `This scene allows at most ${Math.floor(scene.duration * 2.8)} spoken words.`,
        });
    });
  });
}

const score = z.number().min(1).max(10).multipleOf(0.1);
export const reviewSchema = z
  .object({
    hook_strength: score,
    clarity: score,
    audience_relevance: score,
    cta_strength: score,
    overall_score: score,
    problems: z.array(z.string().trim().min(1).max(500)).max(20),
    suggestions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  })
  .strict()
  .superRefine((review, context) => {
    const tenths = [
      review.hook_strength,
      review.clarity,
      review.audience_relevance,
      review.cta_strength,
    ].map((value) => Math.round(value * 10));
    const mean = Math.round(tenths.reduce((sum, value) => sum + value, 0) / 4) / 10;
    if (Math.abs(mean - review.overall_score) > 0.001)
      context.addIssue({
        code: "custom",
        path: ["overall_score"],
        message: "Overall score must equal the four dimension scores' mean rounded to one decimal.",
      });
  });

export function reviewSchemaForThreshold(threshold: number) {
  return reviewSchema.superRefine((review, context) => {
    if (review.overall_score < threshold && review.problems.length === 0)
      context.addIssue({
        code: "custom",
        path: ["problems"],
        message: "A below-threshold review must identify at least one concrete problem.",
      });
  });
}

export type CreativePlan = z.infer<typeof planSchema>;
export type CreativeScript = z.infer<typeof scriptSchema>;
export type CreativeScene = z.infer<typeof sceneSchema>;
export type CreativeReview = z.infer<typeof reviewSchema>;
