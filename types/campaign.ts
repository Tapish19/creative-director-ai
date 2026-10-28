import type { z } from "zod";
import type { campaignSchema } from "@/lib/validation/campaign";

export type CampaignBrief = z.infer<typeof campaignSchema>;
export type ProjectStatus =
  | "draft"
  | "queued"
  | "generating"
  | "script_ready"
  | "images_ready"
  | "media_ready"
  | "video_ready"
  | "needs_revision"
  | "review_failed"
  | "partial"
  | "awaiting_approval"
  | "approved"
  | "failed";
export type GenerationStatus =
  | "queued"
  | "running"
  | "script_ready"
  | "images_ready"
  | "media_ready"
  | "video_ready"
  | "needs_revision"
  | "review_failed"
  | "partial"
  | "reviewing"
  | "awaiting_approval"
  | "approved"
  | "failed";
export type StepStatus = "pending" | "running" | "succeeded" | "failed";
export type AgentType = "planner" | "writer" | "images" | "voice" | "renderer" | "reviewer";

export type Project = CampaignBrief & {
  id: string;
  user_id: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
};

export type ActionState = {
  message?: string;
  fieldErrors?: Partial<Record<keyof CampaignBrief | "email" | "password", string[]>>;
};
