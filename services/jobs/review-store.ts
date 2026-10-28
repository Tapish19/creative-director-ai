import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/types/database";
import type { Generation, Video, AgentRun } from "@/types/generation";
import { JobStoreError, type JobClaim } from "./store";
export type ReviewContext = {
  generation: Generation;
  video: Video;
  ownerId: string;
  runs: AgentRun[];
};
export type ReviewAttemptResult = {
  output: Json | null;
  executionTime: number;
  errorCode?: string;
  errorMessage?: string;
  retry?: boolean;
  delayMs?: number;
  model: string;
  usage?: Json;
};
export interface ReviewJobStore {
  claim(
    workerId: string,
    threshold?: number,
    maxAutomaticRevisions?: number,
  ): Promise<JobClaim | null>;
  heartbeat(job: JobClaim): Promise<boolean>;
  load(job: JobClaim): Promise<ReviewContext>;
  begin(job: JobClaim, input: Json, provider: string, model: string): Promise<string>;
  finish(job: JobClaim, runId: string, result: ReviewAttemptResult): Promise<boolean>;
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
export class SupabaseReviewJobStore implements ReviewJobStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async claim(workerId: string, threshold?: number, maxAutomaticRevisions?: number) {
    const { data, error } = await this.client.rpc("claim_review_job", {
      p_worker_id: workerId,
      p_quality_threshold: threshold ?? 8,
      p_max_automatic_revisions: maxAutomaticRevisions ?? 2,
    });
    check(error);
    return data === null ? null : claimSchema.parse(data);
  }
  async heartbeat(job: JobClaim) {
    const { data, error } = await this.client.rpc("heartbeat_review_job", {
      p_job_id: job.id,
      p_token: job.locked_by,
    });
    check(error);
    return data === true;
  }
  async load(job: JobClaim) {
    const [generation, video, runs] = await Promise.all([
      this.client.from("generations").select("*").eq("id", job.generation_id).single(),
      this.client.from("videos").select("*").eq("generation_id", job.generation_id).single(),
      this.client
        .from("agent_runs")
        .select("*")
        .eq("generation_id", job.generation_id)
        .eq("agent_type", "reviewer"),
    ]);
    check(generation.error);
    check(video.error);
    check(runs.error);
    if (!generation.data || !video.data || !runs.data) throw new JobStoreError("not_found");
    const owner = await this.client
      .from("projects")
      .select("user_id")
      .eq("id", generation.data.project_id)
      .single();
    check(owner.error);
    if (!owner.data) throw new JobStoreError("not_found");
    return {
      generation: generation.data,
      video: video.data,
      runs: runs.data,
      ownerId: owner.data.user_id,
    };
  }
  async begin(job: JobClaim, input: Json, provider: string, model: string) {
    const { data, error } = await this.client.rpc("begin_review_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_input: input,
      p_provider: provider,
      p_model: model,
    });
    check(error);
    return z.uuid().parse(data);
  }
  async finish(job: JobClaim, runId: string, result: ReviewAttemptResult) {
    const { data, error } = await this.client.rpc("finish_review_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_run_id: runId,
      p_output: result.output,
      p_execution_time: result.executionTime,
      p_error_code: result.errorCode ?? null,
      p_error_message: result.errorMessage ?? null,
      p_retry: result.retry ?? false,
      p_delay_ms: Math.ceil(result.delayMs ?? 0),
      p_model: result.model,
      p_usage: result.usage ?? null,
    });
    check(error);
    return data === true;
  }
}
