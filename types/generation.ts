import type { AgentType, GenerationStatus, StepStatus } from "./campaign";
import type { Json } from "./database";

export type Generation = {
  id: string;
  project_id: string;
  parent_generation_id: string | null;
  version: number;
  request_key: string;
  brief_snapshot: Json;
  prompt: string;
  status: GenerationStatus;
  plan: Json | null;
  script: Json | null;
  overall_score: number | null;
  quality_threshold: number;
  automatic_revision: number;
  automatic_revision_limit: number | null;
  automatic_revision_stop_reason: "limit_reached" | "quota_reached" | "manual_edit" | null;
  revision_mode: "initial" | "feedback" | "automatic" | "script_edit" | "scene";
  revision_context: Json;
  revision_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentRun = {
  id: string;
  scene_id: string | null;
  generation_id: string;
  agent_type: AgentType;
  input: Json;
  output: Json | null;
  status: StepStatus;
  attempt: number;
  provider: string | null;
  model: string | null;
  usage: Json | null;
  execution_time: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type Scene = {
  source_scene_id: string | null;
  source_generation_id: string | null;
  id: string;
  generation_id: string;
  scene_number: number;
  voiceover: string;
  caption: string;
  visual_prompt: string;
  image_url: string | null;
  duration: number;
  status: StepStatus;
  attempts: number;
  retry_count: number;
  error_message: string | null;
  created_at: string;
};

export type Job = {
  id: string;
  generation_id: string;
  kind:
    | "plan_and_write"
    | "generate_image"
    | "synthesize_voice"
    | "generate"
    | "regenerate_scene"
    | "render"
    | "review";
  scene_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  payload: Json;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_until: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type GenerationJob = Pick<
  Job,
  "id" | "status" | "attempts" | "max_attempts" | "available_at" | "last_error" | "updated_at"
>;
export type GenerationDetail = {
  generation: Generation;
  runs: AgentRun[];
  scenes: Scene[];
  job: GenerationJob | null;
  voiceover: Voiceover | null;
  video: Video | null;
  review: Review | null;
  reviewTask: ReviewTask | null;
  approval: GenerationApproval | null;
};

export type GenerationApproval = {
  generation_id: string;
  video_id: string;
  review_id: string;
  video_path: string;
  source_sha256: string;
  approved_by: string;
  approved_at: string;
  overall_score: number;
  quality_threshold: number;
  accepted_below_threshold: boolean;
  note: string;
};

export type Voiceover = {
  source_voiceover_id: string | null;
  source_generation_id: string | null;
  id: string;
  generation_id: string;
  narration: string;
  status: StepStatus;
  audio_path: string | null;
  duration_seconds: number | null;
  sample_rate: number | null;
  size_bytes: number | null;
  provider: string | null;
  model: string | null;
  voice: string | null;
  attempts: number;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type Video = {
  id: string;
  generation_id: string;
  video_url: string | null;
  voice_url: string | null;
  status: StepStatus;
  duration: number | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  attempts: number;
  retry_count: number;
  metadata: Json | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewTask = {
  generation_id: string;
  status: StepStatus;
  attempts: number;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
export type Review = {
  id: string;
  generation_id: string;
  video_id: string | null;
  source_sha256: string | null;
  hook_strength: number;
  clarity: number;
  audience_relevance: number;
  cta_strength: number;
  overall_score: number;
  problems: Json;
  suggestions: Json;
  quality_threshold: number;
  input_manifest: Json | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  created_at: string;
};
