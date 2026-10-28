import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/types/database";
import type { Scene, Voiceover } from "@/types/generation";
import { JobStoreError, type JobClaim } from "./store";
export type RenderContext = {
  scenes: Scene[];
  voiceover: Voiceover;
  ownerId: string;
  targetDuration: 15 | 30;
};
export type RenderAttemptResult = {
  output: Json | null;
  executionTime: number;
  errorCode?: string;
  errorMessage?: string;
  retry?: boolean;
  delayMs?: number;
};
export interface RenderJobStore {
  claim(workerId: string): Promise<JobClaim | null>;
  heartbeat(job: JobClaim): Promise<boolean>;
  load(job: JobClaim): Promise<RenderContext>;
  begin(job: JobClaim, input: Json, provider: string, model: string): Promise<string>;
  finish(job: JobClaim, runId: string, result: RenderAttemptResult): Promise<boolean>;
}
const claimSchema = z.object({
  id: z.uuid(),
  generation_id: z.uuid(),
  attempts: z.number().int().min(1),
  max_attempts: z.number().int().min(1),
  locked_by: z.string().min(1),
});
function check(error: { code?: string } | null) {
  if (error) throw new JobStoreError(error.code ?? "database_error");
}
export class SupabaseRenderJobStore implements RenderJobStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async claim(workerId: string) {
    const { data, error } = await this.client.rpc("claim_render_job", { p_worker_id: workerId });
    check(error);
    return data === null ? null : claimSchema.parse(data);
  }
  async heartbeat(job: JobClaim) {
    const { data, error } = await this.client.rpc("heartbeat_render_job", {
      p_job_id: job.id,
      p_token: job.locked_by,
    });
    check(error);
    return data === true;
  }
  async load(job: JobClaim) {
    const [scenes, voice, generation] = await Promise.all([
      this.client
        .from("scenes")
        .select("*")
        .eq("generation_id", job.generation_id)
        .order("scene_number"),
      this.client.from("voiceovers").select("*").eq("generation_id", job.generation_id).single(),
      this.client
        .from("generations")
        .select("project_id,brief_snapshot")
        .eq("id", job.generation_id)
        .single(),
    ]);
    check(scenes.error);
    check(voice.error);
    check(generation.error);
    if (!voice.data || !generation.data || !scenes.data) throw new JobStoreError("not_found");
    const project = await this.client
      .from("projects")
      .select("user_id")
      .eq("id", generation.data.project_id)
      .single();
    check(project.error);
    if (!project.data) throw new JobStoreError("not_found");
    return {
      scenes: scenes.data,
      voiceover: voice.data,
      ownerId: project.data.user_id,
      targetDuration: z
        .object({ duration: z.union([z.literal(15), z.literal(30)]) })
        .parse(generation.data.brief_snapshot).duration,
    };
  }
  async begin(job: JobClaim, input: Json, provider: string, model: string) {
    const { data, error } = await this.client.rpc("begin_render_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_input: input,
      p_provider: provider,
      p_model: model,
    });
    check(error);
    return z.uuid().parse(data);
  }
  async finish(job: JobClaim, runId: string, result: RenderAttemptResult) {
    const { data, error } = await this.client.rpc("finish_render_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_run_id: runId,
      p_output: result.output,
      p_execution_time: result.executionTime,
      p_error_code: result.errorCode ?? null,
      p_error_message: result.errorMessage ?? null,
      p_retry: result.retry ?? false,
      p_delay_ms: Math.ceil(result.delayMs ?? 0),
    });
    check(error);
    return data === true;
  }
}
