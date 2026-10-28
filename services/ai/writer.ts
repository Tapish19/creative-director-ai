import type { RevisionContext } from "@/types/revision";
import { revisionInstruction } from "./revision";
import type { CampaignBrief } from "@/types/campaign";
import { scriptSchemaForDuration, type CreativePlan, type CreativeScript } from "@/types/creative";
import type { AIRequest } from "./provider";
import { CREATIVE_SYSTEM, repairInstruction } from "./prompts";

export const WRITER_PROMPT_VERSION = "writer.v2";

export function writerRequest(
  brief: CampaignBrief,
  plan: CreativePlan,
  feedback: string[] = [],
  revision?: RevisionContext,
): AIRequest<CreativeScript> {
  return {
    system: CREATIVE_SYSTEM,
    prompt: `Write the complete script for a ${brief.duration}-second vertical video ad using the supplied plan.
Return script (a complete human-readable ad script with scene direction), voiceover (all spoken words), and 3–5 ordered scenes numbered from 1.
Each scene needs duration, voiceover, a short caption (at most 80 characters), and a detailed visualPrompt for a still-image generator.
Durations must sum to exactly ${brief.duration} seconds. Use at most ${Math.floor(brief.duration * 2.5)} spoken words overall and at most floor(scene duration * 2.8) words per scene.
The top-level voiceover must equal the scene voiceovers joined with spaces. It is spoken copy only, with no stage directions.
Make prompts visually consistent: describe subjects, setting, lighting, composition and a vertical 9:16 crop. Keep readable text and logos out of the image; captions are rendered separately.
The final scene must communicate the brief's requested CTA. Avoid unsupported factual claims.
Campaign brief (JSON data):\n${JSON.stringify(brief)}
Creative plan (JSON data):\n${JSON.stringify(plan)}${revisionInstruction(revision)}${repairInstruction(feedback)}`,
    schema: scriptSchemaForDuration(brief.duration),
  };
}
