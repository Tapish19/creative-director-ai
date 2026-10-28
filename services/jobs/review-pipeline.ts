import { campaignSchema } from "@/lib/validation/campaign";
import { scriptSchemaForDuration } from "@/types/creative";
import { reviewerRequest, REVIEWER_PROMPT_VERSION } from "@/services/ai/reviewer";
import type { AIProvider } from "@/services/ai/provider";
import { AIError, normalizeAIError, retryDelayMs } from "@/services/ai/errors";
import { RenderError } from "@/services/video/errors";
import type { ReviewMedia, ReviewManifest } from "@/services/video/review-media";
import { toJson, type JobClaim } from "./store";
import type { ReviewJobStore } from "./review-store";
export async function processReviewJob(
  store: ReviewJobStore,
  provider: AIProvider,
  media: ReviewMedia,
  job: JobClaim,
  signal?: AbortSignal,
) {
  const context = await store.load(job),
    brief = campaignSchema.safeParse(context.generation.brief_snapshot);
  const script = brief.success
    ? scriptSchemaForDuration(brief.data.duration).safeParse(context.generation.script)
    : null;
  const last = context.runs
    .filter((run) => run.agent_type === "reviewer" && run.status === "failed")
    .sort((a, b) => b.attempt - a.attempt)[0]?.output;
  const issues =
    last && typeof last === "object" && !Array.isArray(last) && Array.isArray(last.validationIssues)
      ? last.validationIssues
          .filter((item): item is string => typeof item === "string")
          .slice(0, 12)
      : [];
  const request =
    brief.success && script?.success
      ? reviewerRequest(
          brief.data,
          script.data,
          Number(context.generation.quality_threshold),
          issues,
        )
      : null;
  const run = await store.begin(
    job,
    toJson({
      promptVersion: REVIEWER_PROMPT_VERSION,
      system: request?.system ?? null,
      prompt: request?.prompt ?? null,
      videoId: context.video.id,
      sourcePath: context.video.video_url,
      qualityThreshold: Number(context.generation.quality_threshold),
    }),
    provider.name,
    provider.model,
  );
  const started = Date.now();
  let output;
  let model = provider.model;
  let usage;
  let manifest: ReviewManifest | undefined;
  try {
    if (!request)
      throw new AIError(
        "invalid_output",
        "The saved brief or script is invalid. Create a corrected generation.",
        false,
      );
    const prepared = await media.prepare(context.video, context.ownerId, job.generation_id, signal);
    manifest = prepared.manifest;
    const result = await provider.generateStructured({
      ...request,
      media: { mimeType: "video/mp4", data: prepared.data },
      signal,
    });
    model = result.model;
    usage = result.usage;
    const validated = request.schema.safeParse(result.data);
    if (!validated.success)
      throw new AIError(
        "invalid_output",
        "The review did not satisfy the scoring contract.",
        true,
        {
          validationIssues: validated.error.issues
            .slice(0, 12)
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        },
      );
    output = toJson({ review: validated.data, manifest });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const error = cause instanceof RenderError ? cause : normalizeAIError(cause);
    const details = error instanceof AIError ? error.details : {};
    const retry = await store.finish(job, run, {
      output: toJson({ ...details, manifest }),
      executionTime: Date.now() - started,
      errorCode: error.code,
      errorMessage: error.message,
      retry: error.retryable,
      delayMs: retryDelayMs(job.attempts, details.retryAfterMs),
      model,
      usage: toJson(usage ?? null),
    });
    return retry ? "retry_scheduled" : "review_failed";
  }
  signal?.throwIfAborted();
  // A failed commit is recovered under a fresh lease, never recorded as a model failure.
  await store.finish(job, run, {
    output,
    executionTime: Date.now() - started,
    model,
    usage: toJson(usage ?? null),
  });
  return "reviewed";
}
