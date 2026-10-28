import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { Scene } from "@/types/generation";
import { JobStoreError, type JobClaim } from "./store";

export type ImageJobClaim = JobClaim & { scene_id: string };
export type ImageContext = { scene: Scene; ownerId: string; product: string; tone: string };
export type ImageAttemptResult = {
  output: Json | null;
  executionTime: number;
  errorCode?: string;
  errorMessage?: string;
  retry?: boolean;
  delayMs?: number;
};
export interface ImageJobStore {
  claim(workerId: string): Promise<ImageJobClaim | null>;
  heartbeat(job: ImageJobClaim): Promise<boolean>;
  load(job: ImageJobClaim): Promise<ImageContext>;
  begin(job: ImageJobClaim, input: Json, provider: string, model: string): Promise<string>;
  finish(job: ImageJobClaim, runId: string, result: ImageAttemptResult): Promise<boolean>;
}
const claimSchema = z.object({
  id: z.uuid(),
  generation_id: z.uuid(),
  scene_id: z.uuid(),
  attempts: z.number().int().min(1),
  max_attempts: z.number().int().min(1),
  locked_by: z.string().min(1),
});
function check(error: { code?: string } | null) {
  if (error) throw new JobStoreError(error.code ?? "database_error");
}

export class SupabaseImageJobStore implements ImageJobStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async claim(workerId: string) {
    const { data, error } = await this.client.rpc("claim_image_job", { p_worker_id: workerId });
    check(error);
    return data === null ? null : claimSchema.parse(data);
  }
  async heartbeat(job: ImageJobClaim) {
    const { data, error } = await this.client.rpc("heartbeat_image_job", {
      p_job_id: job.id,
      p_token: job.locked_by,
    });
    check(error);
    return data === true;
  }
  async load(job: ImageJobClaim) {
    const [scene, generation] = await Promise.all([
      this.client
        .from("scenes")
        .select("*")
        .eq("id", job.scene_id)
        .eq("generation_id", job.generation_id)
        .single(),
      this.client
        .from("generations")
        .select("project_id,brief_snapshot")
        .eq("id", job.generation_id)
        .single(),
    ]);
    check(scene.error);
    check(generation.error);
    if (!scene.data || !generation.data) throw new JobStoreError("not_found");
    const project = await this.client
      .from("projects")
      .select("user_id")
      .eq("id", generation.data.project_id)
      .single();
    check(project.error);
    if (!project.data) throw new JobStoreError("not_found");
    const brief = z
      .object({ product_name: z.string().max(120), tone: z.string().max(120) })
      .parse(generation.data.brief_snapshot);
    return {
      scene: scene.data,
      ownerId: project.data.user_id,
      product: brief.product_name,
      tone: brief.tone,
    };
  }
  async begin(job: ImageJobClaim, input: Json, provider: string, model: string) {
    const { data, error } = await this.client.rpc("begin_image_attempt", {
      p_job_id: job.id,
      p_token: job.locked_by,
      p_input: input,
      p_provider: provider,
      p_model: model,
    });
    check(error);
    return z.uuid().parse(data);
  }
  async finish(job: ImageJobClaim, runId: string, result: ImageAttemptResult) {
    const { data, error } = await this.client.rpc("finish_image_attempt", {
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
