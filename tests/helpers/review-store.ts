import type { PGlite } from "@electric-sql/pglite";
import type { Json } from "@/types/database";
import type { Generation, Video, AgentRun } from "@/types/generation";
import type { JobClaim } from "@/services/jobs/store";
import type { ReviewJobStore, ReviewAttemptResult } from "@/services/jobs/review-store";
import { service } from "./database";
export class SQLReviewJobStore implements ReviewJobStore {
  constructor(private readonly db: PGlite) {}
  async claim(workerId: string, threshold = 8, maxAutomaticRevisions = 0) {
    return (
      await service<{ result: JobClaim | null }>(
        this.db,
        "select public.claim_review_job($1,$2,$3) as result",
        [workerId, threshold, maxAutomaticRevisions],
      )
    ).rows[0].result;
  }
  async heartbeat(job: JobClaim) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.heartbeat_review_job($1,$2) as result",
        [job.id, job.locked_by],
      )
    ).rows[0].result;
  }
  async load(job: JobClaim) {
    const generation = (
      await service<Generation>(this.db, "select * from public.generations where id=$1", [
        job.generation_id,
      ])
    ).rows[0];
    const video = (
      await service<Video>(this.db, "select * from public.videos where generation_id=$1", [
        job.generation_id,
      ])
    ).rows[0];
    const runs = (
      await service<AgentRun>(
        this.db,
        "select * from public.agent_runs where generation_id=$1 and agent_type='reviewer'",
        [job.generation_id],
      )
    ).rows;
    const owner = (
      await service<{ user_id: string }>(
        this.db,
        "select user_id from public.projects where id=$1",
        [generation.project_id],
      )
    ).rows[0];
    return { generation, video, runs, ownerId: owner.user_id };
  }
  async begin(job: JobClaim, input: Json, provider: string, model: string) {
    return (
      await service<{ result: string }>(
        this.db,
        "select public.begin_review_attempt($1,$2,$3,$4,$5) as result",
        [job.id, job.locked_by, JSON.stringify(input), provider, model],
      )
    ).rows[0].result;
  }
  async finish(job: JobClaim, runId: string, result: ReviewAttemptResult) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.finish_review_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result",
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
          result.model,
          JSON.stringify(result.usage ?? null),
        ],
      )
    ).rows[0].result;
  }
}

export const testReview = {
  hook_strength: 8,
  clarity: 8,
  audience_relevance: 8,
  cta_strength: 8,
  overall_score: 8,
  problems: [],
  suggestions: ["Try a more concrete opening question in scene 1."],
};
export async function completeReviewFixture(db: PGlite) {
  const store = new SQLReviewJobStore(db),
    job = (await store.claim("10000000-0000-4000-8000-000000000010"))!;
  const context = await store.load(job),
    run = await store.begin(job, { promptVersion: "test-only" }, "test-only", "fixture");
  await store.finish(job, run, {
    output: {
      review: testReview,
      manifest: {
        videoId: context.video.id,
        sourcePath: context.video.video_url,
        sourceSha256: "a".repeat(64),
        submittedSha256: "a".repeat(64),
        scope: "video_and_audio",
      },
    },
    executionTime: 1,
    model: "fixture",
  });
}
