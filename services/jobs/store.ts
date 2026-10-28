import type { Json } from "@/types/database";
import type { AgentRun, Generation } from "@/types/generation";
import type { AIResult } from "@/services/ai/provider";

export type TextAgent = "planner" | "writer";
export type JobClaim = {
  id: string;
  generation_id: string;
  attempts: number;
  max_attempts: number;
  locked_by: string;
};
export type Attempt = { id: string; attempt: number };
export type AttemptResult = {
  status: "succeeded" | "failed";
  output: Json | null;
  usage?: AIResult<unknown>["usage"];
  model: string;
  executionTime: number;
  errorCode?: string;
  errorMessage?: string;
};

export interface TextJobStore {
  claim(workerId: string): Promise<JobClaim | null>;
  heartbeat(job: JobClaim): Promise<boolean>;
  loadGeneration(id: string): Promise<Generation>;
  listRuns(id: string): Promise<AgentRun[]>;
  begin(
    job: JobClaim,
    agent: TextAgent,
    input: Json,
    provider: string,
    model: string,
  ): Promise<Attempt>;
  record(job: JobClaim, attempt: Attempt, result: AttemptResult): Promise<void>;
  defer(job: JobClaim, retry: boolean, delayMs: number, message: string): Promise<boolean>;
}

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export class JobStoreError extends Error {
  constructor(public readonly code: string) {
    super(
      code === "55000"
        ? "Worker lease or attempt state changed."
        : "The job database operation failed.",
    );
    this.name = "JobStoreError";
  }
}
