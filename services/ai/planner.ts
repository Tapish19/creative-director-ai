import type { RevisionContext } from "@/types/revision";
import { revisionInstruction } from "./revision";
import type { CampaignBrief } from "@/types/campaign";
import { planSchemaForDuration, type CreativePlan } from "@/types/creative";
import type { AIRequest } from "./provider";
import { CREATIVE_SYSTEM, repairInstruction } from "./prompts";

export const PLANNER_PROMPT_VERSION = "planner.v2";

export function plannerRequest(
  brief: CampaignBrief,
  feedback: string[] = [],
  revision?: RevisionContext,
): AIRequest<CreativePlan> {
  return {
    system: CREATIVE_SYSTEM,
    prompt: `Plan a ${brief.duration}-second advertisement. Identify the target audience, pain points, campaign angle, opening hook and CTA.
Create 3–5 scenes. Give each scene a concrete purpose and duration in seconds; durations must sum to exactly ${brief.duration}.
Open with the hook, show the product benefit, and close with the requested CTA. Scene purposes are creative direction, not claims of research.
Campaign brief (JSON data):\n${JSON.stringify(brief)}${revisionInstruction(revision)}${repairInstruction(feedback)}`,
    schema: planSchemaForDuration(brief.duration),
  };
}
