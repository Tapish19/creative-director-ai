import type { PGlite } from "@electric-sql/pglite";
import type { Json } from "@/types/database";
import type { Scene } from "@/types/generation";
import type { ImageJobStore, ImageJobClaim, ImageAttemptResult } from "@/services/jobs/image-store";
import { service } from "./database";

export class SQLImageJobStore implements ImageJobStore {
  constructor(private readonly db: PGlite) {}
  async claim(workerId: string) {
    return (
      await service<{ result: ImageJobClaim | null }>(
        this.db,
        "select public.claim_image_job($1) as result",
        [workerId],
      )
    ).rows[0].result;
  }
  async heartbeat(job: ImageJobClaim) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.heartbeat_image_job($1,$2) as result",
        [job.id, job.locked_by],
      )
    ).rows[0].result;
  }
  async load(job: ImageJobClaim) {
    const scene = (
      await service<Scene>(this.db, "select * from public.scenes where id = $1", [job.scene_id])
    ).rows[0];
    const context = (
      await service<{ user_id: string; product: string; tone: string }>(
        this.db,
        "select p.user_id, g.brief_snapshot->>'product_name' as product, g.brief_snapshot->>'tone' as tone from public.generations g join public.projects p on p.id = g.project_id where g.id = $1",
        [job.generation_id],
      )
    ).rows[0];
    return { scene, ownerId: context.user_id, product: context.product, tone: context.tone };
  }
  async begin(job: ImageJobClaim, input: Json, provider: string, model: string) {
    return (
      await service<{ result: string }>(
        this.db,
        "select public.begin_image_attempt($1,$2,$3,$4,$5) as result",
        [job.id, job.locked_by, JSON.stringify(input), provider, model],
      )
    ).rows[0].result;
  }
  async finish(job: ImageJobClaim, runId: string, result: ImageAttemptResult) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.finish_image_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
        [
          job.id,
          job.locked_by,
          runId,
          result.output === null ? null : JSON.stringify(result.output),
          result.executionTime,
          result.errorCode ?? null,
          result.errorMessage ?? null,
          result.retry ?? false,
          Math.ceil(result.delayMs ?? 0),
        ],
      )
    ).rows[0].result;
  }
}
