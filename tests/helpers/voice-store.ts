import type { PGlite } from "@electric-sql/pglite";
import type { Json } from "@/types/database";
import type { Voiceover } from "@/types/generation";
import type { JobClaim } from "@/services/jobs/store";
import type { VoiceJobStore, VoiceAttemptResult } from "@/services/jobs/voice-store";
import { service } from "./database";
export class SQLVoiceJobStore implements VoiceJobStore {
  constructor(private readonly db: PGlite) {}
  async claim(workerId: string) {
    return (
      await service<{ result: JobClaim | null }>(
        this.db,
        "select public.claim_voice_job($1) as result",
        [workerId],
      )
    ).rows[0].result;
  }
  async heartbeat(job: JobClaim) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.heartbeat_voice_job($1,$2) as result",
        [job.id, job.locked_by],
      )
    ).rows[0].result;
  }
  async load(job: JobClaim) {
    const voiceover = (
      await service<Voiceover>(this.db, "select * from public.voiceovers where generation_id=$1", [
        job.generation_id,
      ])
    ).rows[0];
    const context = (
      await service<{ owner: string; duration: number }>(
        this.db,
        "select p.user_id as owner,(g.brief_snapshot->>'duration')::integer as duration from public.generations g join public.projects p on p.id=g.project_id where g.id=$1",
        [job.generation_id],
      )
    ).rows[0];
    return { voiceover, ownerId: context.owner, targetDuration: context.duration };
  }
  async begin(job: JobClaim, input: Json, provider: string, model: string) {
    return (
      await service<{ result: string }>(
        this.db,
        "select public.begin_voice_attempt($1,$2,$3,$4,$5) as result",
        [job.id, job.locked_by, JSON.stringify(input), provider, model],
      )
    ).rows[0].result;
  }
  async finish(job: JobClaim, runId: string, result: VoiceAttemptResult) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.finish_voice_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
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
