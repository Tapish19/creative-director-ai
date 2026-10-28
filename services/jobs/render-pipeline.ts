import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { VideoRenderer } from "@/services/video/provider";
import type { RenderStorage } from "@/services/video/storage";
import { RenderError, normalizeRenderError } from "@/services/video/errors";
import { retryDelayMs } from "@/services/ai/errors";
import { toJson, type JobClaim } from "./store";
import type { RenderJobStore } from "./render-store";

export async function processRenderJob(
  store: RenderJobStore,
  renderer: VideoRenderer,
  storage: RenderStorage,
  job: JobClaim,
  options: { signal?: AbortSignal; musicPath?: string } = {},
) {
  const context = await store.load(job);
  const run = await store.begin(
    job,
    toJson({
      scenes: context.scenes.map((scene) => ({
        id: scene.id,
        imagePath: scene.image_url,
        duration: scene.duration,
        caption: scene.caption,
      })),
      voicePath: context.voiceover.audio_path,
      targetDuration: context.targetDuration,
      width: 720,
      height: 1280,
      fps: 30,
      captionTiming: "storyboard",
      musicRequested: !!options.musicPath,
      renderVersion: "ffmpeg-v1",
    }),
    renderer.name,
    renderer.version ?? "h264-aac-v1",
  );
  const started = Date.now();
  const path = `${context.ownerId}/${job.generation_id}/video/${run}.mp4`;
  const directory = await mkdtemp(join(tmpdir(), "creative-director-inputs-"));
  let output;
  try {
    try {
      options.signal?.throwIfAborted();

      if (
        context.voiceover.status !== "succeeded" ||
        !context.voiceover.audio_path?.startsWith(
          `${context.ownerId}/${context.voiceover.source_generation_id ?? job.generation_id}/voice/`,
        ) ||
        context.scenes.some(
          (scene) =>
            scene.status !== "succeeded" ||
            !scene.image_url?.startsWith(
              `${context.ownerId}/${scene.source_generation_id ?? job.generation_id}/${scene.source_scene_id ?? scene.id}/`,
            ),
        )
      )
        throw new RenderError(
          "invalid_input",
          "Completed media for this generation is required before rendering.",
          false,
        );
      const scenes = [];
      for (let index = 0; index < context.scenes.length; index++) {
        options.signal?.throwIfAborted();
        const scene = context.scenes[index];
        const imagePath = join(directory, `scene-${index}.jpg`);
        await writeFile(imagePath, await storage.download(scene.image_url!, 8 * 1024 * 1024));
        scenes.push({ imagePath, duration: scene.duration, caption: scene.caption });
      }
      const voicePath = join(directory, "voice.wav");
      await writeFile(
        voicePath,
        await storage.download(context.voiceover.audio_path!, 12 * 1024 * 1024),
      );
      const result = await renderer.render({
        scenes,
        voicePath,
        musicPath: options.musicPath,
        outputPath: join(directory, "video.mp4"),
        targetDuration: context.targetDuration,
        width: 720,
        height: 1280,
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      const bytes = await readFile(result.path);
      if (bytes.length !== result.sizeBytes || bytes.length > 100 * 1024 * 1024)
        throw new RenderError(
          "invalid_video",
          "The rendered video size did not match its verified metadata.",
          true,
        );
      await storage.upload(path, bytes);
      output = toJson({
        ...result,
        path,
        contentType: "video/mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        captionTiming: "storyboard",
        renderVersion: "ffmpeg-v1",
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const failure = normalizeRenderError(error);
      const retry = await store.finish(job, run, {
        output: null,
        executionTime: Date.now() - started,
        errorCode: failure.code,
        errorMessage: failure.message,
        retry: failure.retryable,
        delayMs: retryDelayMs(job.attempts),
      });
      return retry ? "retry_scheduled" : "render_failed";
    }
    options.signal?.throwIfAborted();
    await store.finish(job, run, { output, executionTime: Date.now() - started });
    return "video_ready";
  } finally {
    const root = resolve(tmpdir()),
      target = resolve(directory);
    if (
      !target.startsWith(root + sep) ||
      !target.slice(root.length + 1).startsWith("creative-director-inputs-")
    )
      throw new Error("Unsafe render inputs directory");
    await rm(target, { recursive: true, force: true });
  }
}
