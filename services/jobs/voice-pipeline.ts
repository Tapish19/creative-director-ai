import type { VoiceProvider } from "@/services/voice/provider";
import type { VoiceStorage } from "@/services/voice/storage";
import { normalizeVoiceError } from "@/services/voice/errors";
import { inspectWav } from "@/services/voice/wav";
import { retryDelayMs } from "@/services/ai/errors";
import { toJson, type JobClaim } from "./store";
import type { VoiceJobStore } from "./voice-store";

export async function processVoiceJob(
  store: VoiceJobStore,
  provider: VoiceProvider,
  storage: VoiceStorage,
  job: JobClaim,
  signal?: AbortSignal,
) {
  const context = await store.load(job);
  const run = await store.begin(
    job,
    toJson({
      text: context.voiceover.narration,
      voice: provider.voice,
      targetDuration: context.targetDuration,
      format: "pcm16-mono-wav",
      requestVersion: "voice-v1",
    }),
    provider.name,
    provider.model,
  );
  const started = Date.now();
  const path = `${context.ownerId}/${job.generation_id}/voice/${run}.wav`;
  let output;
  try {
    signal?.throwIfAborted();
    const audio = await provider.synthesize({ text: context.voiceover.narration, signal });
    signal?.throwIfAborted();
    const measured = inspectWav(audio.data);
    await storage.upload(path, audio.data);
    output = toJson({
      path,
      ...measured,
      contentType: "audio/wav",
      sizeBytes: audio.data.length,
      provider: provider.name,
      model: provider.model,
      voice: provider.voice,
      targetDuration: context.targetDuration,
      exceedsTarget: measured.durationSeconds > context.targetDuration,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = normalizeVoiceError(error);
    const retry = await store.finish(job, run, {
      output: null,
      executionTime: Date.now() - started,
      errorCode: failure.code,
      errorMessage: failure.message,
      retry: failure.retryable,
      delayMs: retryDelayMs(job.attempts, failure.retryAfterMs),
    });
    return retry ? "retry_scheduled" : "voice_failed";
  }
  signal?.throwIfAborted();
  // A lost database response can follow a successful commit. Leave the immutable
  // upload intact and allow lease recovery instead of publishing another outcome.
  await store.finish(job, run, { output, executionTime: Date.now() - started });
  return "voice_ready";
}
