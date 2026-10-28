import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Video } from "@/types/generation";
import type { RenderStorage } from "./storage";
import { FFmpegRenderer } from "./ffmpeg";
import { mediaExecutables } from "./config";
import { runMediaProcess } from "./process";
import { RenderError } from "./errors";
export type ReviewManifest = {
  videoId: string;
  sourcePath: string;
  sourceSha256: string;
  submittedSha256: string;
  scope: "video_and_audio";
  transcoded: boolean;
  durationSeconds: number;
  sizeBytes: number;
  width: number;
  height: number;
};
export interface ReviewMedia {
  prepare(
    video: Video,
    owner: string,
    generation: string,
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; manifest: ReviewManifest }>;
}
export class VideoReviewMedia implements ReviewMedia {
  constructor(
    private readonly storage: Pick<RenderStorage, "download">,
    private readonly renderer = new FFmpegRenderer(),
  ) {}
  async prepare(video: Video, owner: string, generation: string, signal?: AbortSignal) {
    if (
      video.status !== "succeeded" ||
      !video.video_url?.startsWith(`${owner}/${generation}/video/`)
    )
      throw new RenderError(
        "invalid_input",
        "A completed video belonging to this generation is required.",
        false,
      );
    signal?.throwIfAborted();
    const source = await this.storage.download(video.video_url, 100 * 1024 * 1024);
    if (source.byteLength !== Number(video.size_bytes))
      throw new RenderError(
        "invalid_video",
        "The saved video size does not match its render record.",
        false,
      );
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const metadata = video.metadata;
    const expected =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata.sha256
        : undefined;
    if (expected && expected !== sourceSha256)
      throw new RenderError(
        "invalid_video",
        "The saved video did not match its render checksum.",
        false,
      );
    const directory = await mkdtemp(join(tmpdir(), "creative-director-review-"));
    try {
      const path = join(directory, "source.mp4");
      await writeFile(path, source);
      const info = await this.renderer.probe(path, signal);
      const image = info.streams.find((stream) => stream.codec_type === "video");
      if (
        !image ||
        image.codec_name !== "h264" ||
        image.width !== 720 ||
        image.height !== 1280 ||
        !info.streams.some(
          (stream) => stream.codec_type === "audio" && stream.codec_name === "aac",
        ) ||
        ![15, 30].includes(Number(video.duration)) ||
        !Number.isFinite(Number(info.format.duration)) ||
        Math.abs(Number(info.format.duration) - Number(video.duration)) > 0.1
      )
        throw new RenderError(
          "invalid_video",
          "The saved video does not match its completed render metadata.",
          false,
        );
      let data: Uint8Array = source;
      const transcoded = source.byteLength > 12 * 1024 * 1024;
      if (transcoded) {
        await runMediaProcess(
          mediaExecutables().ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            "source.mp4",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-vf",
            "scale=360:640,fps=15",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-maxrate",
            "1000k",
            "-bufsize",
            "2000k",
            "-threads",
            "2",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-movflags",
            "+faststart",
            "proxy.mp4",
          ],
          { cwd: directory, signal, timeoutMs: 120_000 },
        );
        const proxy = join(directory, "proxy.mp4"),
          check = await this.renderer.probe(proxy, signal);
        if (
          !Number.isFinite(Number(check.format.duration)) ||
          Math.abs(Number(check.format.duration) - Number(video.duration)) > 0.1 ||
          !check.streams.some(
            (stream) => stream.codec_type === "audio" && stream.codec_name === "aac",
          ) ||
          !check.streams.some(
            (stream) =>
              stream.codec_type === "video" &&
              stream.codec_name === "h264" &&
              stream.width === 360 &&
              stream.height === 640,
          )
        )
          throw new RenderError(
            "invalid_video",
            "The review copy failed audiovisual validation.",
            false,
          );
        data = await readFile(proxy);
      }
      if (!data.byteLength || data.byteLength > 12 * 1024 * 1024)
        throw new RenderError(
          "invalid_video",
          "The review copy exceeds the 12 MiB submission limit.",
          false,
        );
      signal?.throwIfAborted();
      return {
        data,
        manifest: {
          videoId: video.id,
          sourcePath: video.video_url,
          sourceSha256,
          submittedSha256: createHash("sha256").update(data).digest("hex"),
          scope: "video_and_audio" as const,
          transcoded,
          durationSeconds: Number(info.format.duration),
          sizeBytes: data.byteLength,
          width: transcoded ? 360 : 720,
          height: transcoded ? 640 : 1280,
        },
      };
    } finally {
      const root = resolve(tmpdir()),
        target = resolve(directory);
      if (
        !target.startsWith(root + sep) ||
        !target.slice(root.length + 1).startsWith("creative-director-review-")
      )
        throw new Error("Unsafe review temporary directory");
      await rm(target, { recursive: true, force: true });
    }
  }
}
