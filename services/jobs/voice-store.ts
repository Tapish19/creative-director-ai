import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/types/database";
import type { Voiceover } from "@/types/generation";
import { JobStoreError, type JobClaim } from "./store";

export type VoiceAttemptResult = {
  output: Json | null;
  executionTime: number;
  errorCode?: string;
  errorMessage?: string;
  retry?: boolean;
  delayMs?: number;
};
export interface VoiceJobStore {
  claim(workerId: string): Promise<JobClaim | null>;
  heartbeat(job: JobClaim): Promise<boolean>;
  load(job: JobClaim): Promise<{ voiceover: Voiceover; ownerId: string; targetDuration: number }>;
  begin(job: JobClaim, input: Json, provider: string, model: string): Promise<string>;
  finish(job: JobClaim, runId: string, result: VoiceAttemptResult): Promise<boolean>;
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

export class SupabaseVoiceJobStore implements VoiceJobStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async claim(workerId: string) {
    const { data, error } = await this.client.rpc("claim_voice_job", { p_worker_id: workerId });
    check(error);
    return data === null ? null : claimSchema.parse(data);
  }
  async heartbeat(job: JobClaim) {
    const { data, error } = await this.client.rpc("heartbeat_voice_job", {
      p_job_id: job.id,
      p_token: job.locked_by,
    });
    check(error);
    return data === true;
  }
  async load(job: JobClaim) {
    const [voiceover, generation] = await Promise.all([
      this.client.from("voiceovers").select("*").eq("generation_id", job.generation_id).single(),
      this.client
        .from("generations")
        .select("project_id,brief_snapshot")
        .eq("id", job.generation_id)
        .single(),
    ]);
    check(voiceover.error);
    check(generation.error);
    if (!voiceover.data || !generation.data) throw new JobStoreError("not_found");
    const project = await this.client
      .from("projects")
      .select("user_id")
      .eq("id", generation.data.project_id)
      .single();
    check(project.error);
    if (!project.data) throw new JobStoreError("not_found");
    return {
      voiceover: voiceover.data,
      ownerId: project.data.user_id,
      targetDuration: z
        .object({ duration: z.union([z.literal(15), z.literal(30)]) })
        .parse(generation.data.brief_snapshot).duration,
    };
  }
  async begin(job: JobClaim, input: Json, provider: string, model: string) {
    const { data, error } = await this.client.rpc("begin_voice_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_input: input,
      p_provider: provider,
      p_model: model,
    });
    check(error);
    return z.uuid().parse(data);
  }
  async finish(job: JobClaim, runId: string, result: VoiceAttemptResult) {
    const { data, error } = await this.client.rpc("finish_voice_attempt", {
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
