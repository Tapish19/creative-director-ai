import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/types/database";
import {
  JobStoreError,
  toJson,
  type Attempt,
  type AttemptResult,
  type JobClaim,
  type TextAgent,
  type TextJobStore,
} from "./store";

const claimSchema = z.object({
  id: z.uuid(),
  generation_id: z.uuid(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  locked_by: z.string().min(1),
});
const attemptSchema = z.object({ id: z.uuid(), attempt: z.number().int().min(1).max(3) });

function check(error: { code?: string } | null) {
  if (error) throw new JobStoreError(error.code || "database_error");
}

export class SupabaseTextJobStore implements TextJobStore {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async claim(workerId: string) {
    const { data, error } = await this.client.rpc("claim_text_job", { p_worker_id: workerId });
    check(error);
    return data === null ? null : claimSchema.parse(data);
  }

  async heartbeat(job: JobClaim) {
    const { data, error } = await this.client.rpc("heartbeat_text_job", {
      p_job_id: job.id,
      p_token: job.locked_by,
    });
    check(error);
    return data === true;
  }

  async loadGeneration(id: string) {
    const { data, error } = await this.client.from("generations").select("*").eq("id", id).single();
    check(error);
    if (!data) throw new JobStoreError("not_found");
    return data;
  }

  async listRuns(id: string) {
    const { data, error } = await this.client
      .from("agent_runs")
      .select("*")
      .eq("generation_id", id)
      .order("attempt");
    check(error);
    return data ?? [];
  }

  async begin(job: JobClaim, agent: TextAgent, input: Json, provider: string, model: string) {
    const { data, error } = await this.client.rpc("begin_text_agent", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_agent: agent,
      p_input: input,
      p_provider: provider,
      p_model: model,
    });
    check(error);
    return attemptSchema.parse(data);
  }

  async record(job: JobClaim, attempt: Attempt, result: AttemptResult) {
    const { error } = await this.client.rpc("record_text_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_run_id: attempt.id,
      p_status: result.status,
      p_output: result.output,
      p_usage: result.usage ? toJson(result.usage) : null,
      p_model: result.model,
      p_execution_time: result.executionTime,
      p_error_code: result.errorCode ?? null,
      p_error_message: result.errorMessage ?? null,
    });
    check(error);
  }

  async defer(job: JobClaim, retry: boolean, delayMs: number, message: string) {
    const { data, error } = await this.client.rpc("defer_text_job", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_retry: retry,
      p_delay_ms: Math.ceil(delayMs),
      p_error: message,
    });
    check(error);
    return data === true;
  }
}
