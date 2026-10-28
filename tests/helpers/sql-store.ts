import type { PGlite } from "@electric-sql/pglite";
import type { Json } from "@/types/database";
import type { Generation, AgentRun } from "@/types/generation";
import type {
  Attempt,
  AttemptResult,
  JobClaim,
  TextAgent,
  TextJobStore,
} from "@/services/jobs/store";
import { service } from "./database";

// Test adapter for the exact PostgreSQL RPC contracts used by SupabaseTextJobStore.
export class SQLTextJobStore implements TextJobStore {
  constructor(private readonly db: PGlite) {}

  async claim(workerId: string) {
    return (
      await service<{ result: JobClaim | null }>(
        this.db,
        "select public.claim_text_job($1) as result",
        [workerId],
      )
    ).rows[0].result;
  }
  async heartbeat(job: JobClaim) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.heartbeat_text_job($1, $2) as result",
        [job.id, job.locked_by],
      )
    ).rows[0].result;
  }
  async loadGeneration(id: string) {
    return (
      await service<Generation>(this.db, "select * from public.generations where id = $1", [id])
    ).rows[0];
  }
  async listRuns(id: string) {
    return (
      await service<AgentRun>(
        this.db,
        "select * from public.agent_runs where generation_id = $1 order by attempt",
        [id],
      )
    ).rows;
  }
  async begin(job: JobClaim, agent: TextAgent, input: Json, provider: string, model: string) {
    return (
      await service<{ result: Attempt }>(
        this.db,
        "select public.begin_text_agent($1, $2, $3, $4, $5, $6) as result",
        [job.id, job.locked_by, agent, JSON.stringify(input), provider, model],
      )
    ).rows[0].result;
  }
  async record(job: JobClaim, attempt: Attempt, result: AttemptResult) {
    await service(this.db, "select public.record_text_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      job.id,
      job.locked_by,
      attempt.id,
      result.status,
      result.output === null ? null : JSON.stringify(result.output),
      result.usage ? JSON.stringify(result.usage) : null,
      result.model,
      result.executionTime,
      result.errorCode ?? null,
      result.errorMessage ?? null,
    ]);
  }
  async defer(job: JobClaim, retry: boolean, delayMs: number, message: string) {
    return (
      await service<{ result: boolean }>(
        this.db,
        "select public.defer_text_job($1,$2,$3,$4,$5) as result",
        [job.id, job.locked_by, retry, delayMs, message],
      )
    ).rows[0].result;
  }
}
