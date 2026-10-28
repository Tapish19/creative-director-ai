import type { ImageProvider } from "@/services/images/provider";
import type { ImageStorage } from "@/services/images/storage";
import { normalizeImageError } from "@/services/images/errors";
import { normalizePortrait, PORTRAIT, sceneImagePrompt } from "@/services/images/portrait";
import { retryDelayMs } from "@/services/ai/errors";
import type { ImageJobClaim, ImageJobStore } from "./image-store";
import { toJson } from "./store";

export async function processImageJob(
  store: ImageJobStore,
  provider: ImageProvider,
  storage: ImageStorage,
  job: ImageJobClaim,
  signal?: AbortSignal,
) {
  const context = await store.load(job);
  const request = {
    prompt: sceneImagePrompt(context.scene.visual_prompt, context.product, context.tone),
    ...PORTRAIT,
  };
  const runId = await store.begin(
    job,
    toJson({
      ...request,
      sceneNumber: context.scene.scene_number,
      framing: "center-crop",
      promptVersion: "scene-image-v1",
    }),
    provider.name,
    provider.model,
  );
  const started = Date.now();
  const path = `${context.ownerId}/${job.generation_id}/${job.scene_id}/${runId}.jpg`;
  let output;
  try {
    signal?.throwIfAborted();
    const image = await provider.generate({ ...request, signal });
    signal?.throwIfAborted();
    const portrait = await normalizePortrait(image.data);
    signal?.throwIfAborted();
    // Immutable attempt paths prevent a worker with an expired lease from
    // overwriting another worker's asset. Only the fenced commit publishes it.
    await storage.upload(path, portrait.data);
    output = toJson({
      path,
      provider: provider.name,
      model: provider.model,
      width: portrait.width,
      height: portrait.height,
      sourceWidth: portrait.sourceWidth,
      sourceHeight: portrait.sourceHeight,
      sizeBytes: portrait.data.length,
      contentType: portrait.contentType,
      framing: "center-crop",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = normalizeImageError(error);
    const retry = await store.finish(job, runId, {
      output: null,
      executionTime: Date.now() - started,
      errorCode: failure.code,
      errorMessage: failure.message,
      retry: failure.retryable,
      delayMs: retryDelayMs(job.attempts, failure.retryAfterMs),
    });
    return retry ? "retry_scheduled" : "scene_failed";
  }
  signal?.throwIfAborted();
  // Database failures are not provider failures. A lost response can mean the
  // commit succeeded; do not delete uploaded objects or write a second outcome.
  await store.finish(job, runId, { output, executionTime: Date.now() - started });
  return "image_ready";
}
