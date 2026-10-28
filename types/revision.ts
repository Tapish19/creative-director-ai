import { z } from "zod";
import {
  reviewSchema,
  scriptSchema,
  sceneSchema,
  scriptSchemaForDuration,
  type CreativeScene,
} from "./creative";
export const revisionContextSchema = z
  .object({
    sourceGenerationId: z.uuid(),
    previousScript: scriptSchema,
    review: reviewSchema.nullable(),
    instruction: z.string().min(1).max(2000),
    requestedSceneId: z.uuid().optional(),
    requestedVisualPrompt: z.string().max(3000).optional(),
    requestHash: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .strict();
export type RevisionContext = z.infer<typeof revisionContextSchema>;
export const revisionRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("feedback"), instruction: z.string().trim().max(2000) }).strict(),
  z.object({ mode: z.literal("script_edit"), scenes: z.array(sceneSchema).min(3).max(5) }).strict(),
  z
    .object({
      mode: z.literal("scene"),
      sceneId: z.uuid(),
      visualPrompt: z.string().trim().min(20).max(3000),
    })
    .strict(),
]);
export function editedScript(scenes: CreativeScene[], duration: 15 | 30) {
  return scriptSchemaForDuration(duration).parse({
    script: scenes
      .map(
        (scene) =>
          `Scene ${scene.sceneNumber} (${scene.duration}s): ${scene.voiceover}\nCaption: ${scene.caption}`,
      )
      .join("\n\n"),
    voiceover: scenes.map((scene) => scene.voiceover).join(" "),
    scenes,
  });
}
