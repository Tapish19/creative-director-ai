import type { PGlite } from "@electric-sql/pglite";
import type { Json } from "@/types/database";
import type { Scene, Voiceover } from "@/types/generation";
import type { JobClaim } from "@/services/jobs/store";
import type { RenderJobStore, RenderAttemptResult } from "@/services/jobs/render-store";
import { service } from "./database";
export class SQLRenderJobStore implements RenderJobStore {
  constructor(private readonly db: PGlite) {}
  async claim(workerId: string) {
    return (
      await service<{ result: JobClaim | null }>(
        this.db,
        "select public.claim_render_job($1) as result",
        [workerId],
      )
    ).rows[0].result;
  }
  async heartbeat(job: JobClaim) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.heartbeat_render_job($1,$2) as result",
        [job.id, job.locked_by],
      )
    ).rows[0].result;
  }
  async load(job: JobClaim) {
    const scenes = (
      await service<Scene>(
        this.db,
        "select * from public.scenes where generation_id=$1 order by scene_number",
        [job.generation_id],
      )
    ).rows;
    const voiceover = (
      await service<Voiceover>(this.db, "select * from public.voiceovers where generation_id=$1", [
        job.generation_id,
      ])
    ).rows[0];
    const context = (
      await service<{ owner: string; duration: 15 | 30 }>(
        this.db,
        "select p.user_id as owner,(g.brief_snapshot->>'duration')::integer as duration from public.generations g join public.projects p on p.id=g.project_id where g.id=$1",
        [job.generation_id],
      )
    ).rows[0];
    return { scenes, voiceover, ownerId: context.owner, targetDuration: context.duration };
  }
  async begin(job: JobClaim, input: Json, provider: string, model: string) {
    return (
      await service<{ result: string }>(
        this.db,
        "select public.begin_render_attempt($1,$2,$3,$4,$5) as result",
        [job.id, job.locked_by, JSON.stringify(input), provider, model],
      )
    ).rows[0].result;
  }
  async finish(job: JobClaim, runId: string, result: RenderAttemptResult) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.finish_render_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
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
export async function completeRenderFixture(db: PGlite, owner: string, generation: string) {
  const store = new SQLRenderJobStore(db);
  const job = (await store.claim("10000000-0000-4000-8000-000000000009"))!;
  const run = await store.begin(job, {}, "test-only", "fixture");
  await store.finish(job, run, {
    output: {
      path: `${owner}/${generation}/video/${run}.mp4`,
      contentType: "video/mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      durationSeconds: 15,
      sizeBytes: 5000,
      width: 720,
      height: 1280,
      fps: 30,
    },
    executionTime: 1,
  });
}
