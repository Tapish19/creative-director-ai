import { revisionContextSchema } from "@/types/revision";
import { campaignSchema } from "@/lib/validation/campaign";
import { planSchemaForDuration, type CreativePlan } from "@/types/creative";
import type { AgentRun } from "@/types/generation";
import { AIError, normalizeAIError, retryDelayMs } from "@/services/ai/errors";
import type { AIProvider, AIRequest, AIResult } from "@/services/ai/provider";
import { plannerRequest, PLANNER_PROMPT_VERSION } from "@/services/ai/planner";
import { writerRequest, WRITER_PROMPT_VERSION } from "@/services/ai/writer";
import { toJson, type JobClaim, type TextAgent, type TextJobStore } from "./store";

function previousFeedback(runs: AgentRun[], agent: TextAgent): string[] {
  const last = runs
    .filter((run) => run.agent_type === agent && run.status === "failed")
    .sort((a, b) => b.attempt - a.attempt)[0];
  const output = last?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const issues = output.validationIssues;
  return Array.isArray(issues)
    ? issues.filter((issue): issue is string => typeof issue === "string").slice(0, 12)
    : [];
}

type StepResult<T> = { ok: true; data: T } | { ok: false; retryScheduled: boolean };

async function runStep<T>(
  store: TextJobStore,
  provider: AIProvider,
  job: JobClaim,
  agent: TextAgent,
  promptVersion: string,
  request: AIRequest<T>,
  signal?: AbortSignal,
): Promise<StepResult<T>> {
  signal?.throwIfAborted();
  const attempt = await store.begin(
    job,
    agent,
    toJson({ promptVersion, system: request.system, prompt: request.prompt }),
    provider.name,
    provider.model,
  );
  const start = performance.now();
  let result: AIResult<T>;
  try {
    result = await provider.generateStructured({ ...request, signal });
  } catch (cause) {
    // Shutdown or lease loss leaves the claim for recovery; a stale worker must not write.
    if (signal?.aborted) throw cause;
    const error = normalizeAIError(cause);
    await store.record(job, attempt, {
      status: "failed",
      output: toJson(error.details),
      model: provider.model,
      executionTime: Math.round(performance.now() - start),
      errorCode: error.code,
      errorMessage: error.message,
    });
    const retryScheduled = await store.defer(
      job,
      error.retryable && attempt.attempt < 3,
      retryDelayMs(attempt.attempt, error.details.retryAfterMs),
      error.message,
    );
    return { ok: false, retryScheduled };
  }
  signal?.throwIfAborted();
  // Persistence errors are not provider failures. Let the lease expire and recover safely.
  await store.record(job, attempt, {
    status: "succeeded",
    output: toJson(result.data),
    usage: result.usage,
    model: result.model,
    executionTime: Math.round(performance.now() - start),
  });
  return { ok: true, data: result.data };
}

export async function processTextJob(
  store: TextJobStore,
  provider: AIProvider,
  job: JobClaim,
  signal?: AbortSignal,
): Promise<"script_ready" | "retry_scheduled" | "failed"> {
  const generation = await store.loadGeneration(job.generation_id);
  const parsedBrief = campaignSchema.safeParse(generation.brief_snapshot);
  if (!parsedBrief.success) {
    await store.defer(
      job,
      false,
      0,
      "The saved brief is invalid. Create a new campaign with a valid brief.",
    );
    return "failed";
  }
  const parsedRevision =
    generation.revision_mode === "feedback" || generation.revision_mode === "automatic"
      ? revisionContextSchema.safeParse(generation.revision_context)
      : null;
  if (parsedRevision && !parsedRevision.success) {
    await store.defer(
      job,
      false,
      0,
      "The saved revision context is invalid. Create a new generation.",
    );
    return "failed";
  }
  const revision = parsedRevision?.success ? parsedRevision.data : undefined;
  const brief = parsedBrief.data;
  const runs = await store.listRuns(generation.id);
  let plan: CreativePlan;
  if (generation.plan) {
    const cached = planSchemaForDuration(brief.duration).safeParse(generation.plan);
    if (!cached.success) {
      await store.defer(job, false, 0, "The saved plan is invalid. Create a new generation.");
      return "failed";
    }
    plan = cached.data;
  } else {
    if (runs.filter((run) => run.agent_type === "planner").length >= 3) {
      await store.defer(job, false, 0, "Planner attempt limit reached after worker recovery.");
      return "failed";
    }
    const result = await runStep(
      store,
      provider,
      job,
      "planner",
      PLANNER_PROMPT_VERSION,
      plannerRequest(brief, previousFeedback(runs, "planner"), revision),
      signal,
    );
    if (!result.ok) return result.retryScheduled ? "retry_scheduled" : "failed";
    plan = result.data;
  }
  if (runs.filter((run) => run.agent_type === "writer").length >= 3) {
    await store.defer(job, false, 0, "Writer attempt limit reached after worker recovery.");
    return "failed";
  }
  const result = await runStep(
    store,
    provider,
    job,
    "writer",
    WRITER_PROMPT_VERSION,
    writerRequest(brief, plan, previousFeedback(runs, "writer"), revision),
    signal,
  );
  if (!result.ok) return result.retryScheduled ? "retry_scheduled" : "failed";
  return "script_ready";
}

// Re-export a stable error type for worker diagnostics without exposing upstream response bodies.
export { AIError };
