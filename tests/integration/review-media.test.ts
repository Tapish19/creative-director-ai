import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VideoReviewMedia } from "@/services/video/review-media";
import { FFmpegRenderer } from "@/services/video/ffmpeg";
import { runMediaProcess } from "@/services/video/process";
import { mediaExecutables } from "@/services/video/config";
import type { Video } from "@/types/generation";
const owner = "10000000-0000-4000-8000-000000000001",
  generation = "10000000-0000-4000-8000-000000000002";
const checksum = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
let directory: string, source: Buffer;
const video = (data: Uint8Array): Video => ({
  id: "10000000-0000-4000-8000-000000000003",
  generation_id: generation,
  video_url: `${owner}/${generation}/video/render.mp4`,
  voice_url: "test-only.wav",
  status: "succeeded",
  duration: 15,
  size_bytes: data.byteLength,
  width: 720,
  height: 1280,
  fps: 30,
  attempts: 1,
  retry_count: 0,
  metadata: { sha256: checksum(data) },
  error_message: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "creative-director-review-test-"));
  // Explicit synthetic media fixture; this test exercises native audiovisual preparation.
  await runMediaProcess(mediaExecutables().ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=720x1280:r=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "15",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    join(directory, "source.mp4"),
  ]);
  source = await readFile(join(directory, "source.mp4"));
});
afterAll(async () => {
  if (!directory) return;
  const root = resolve(tmpdir()),
    target = resolve(directory);
  if (
    !target.startsWith(root + sep) ||
    !target.slice(root.length + 1).startsWith("creative-director-review-test-")
  )
    throw new Error("Unsafe test directory");
  await rm(target, { recursive: true, force: true });
});
describe("real video review evidence", () => {
  it("submits the unchanged original when it fits and records matching checksums", async () => {
    const output = await new VideoReviewMedia({ download: async () => source }).prepare(
      video(source),
      owner,
      generation,
    );
    expect(Buffer.from(output.data).equals(source)).toBe(true);
    expect(output.manifest).toMatchObject({
      scope: "video_and_audio",
      sourceSha256: checksum(source),
      submittedSha256: checksum(source),
      transcoded: false,
      durationSeconds: 15,
      width: 720,
      height: 1280,
    });
  });
  it("makes a bounded audiovisual proxy of a large valid MP4 while retaining source identity", async () => {
    // An ISO BMFF free box expands the file without changing the audiovisual streams.
    const free = Buffer.alloc(13 * 1024 * 1024);
    free.writeUInt32BE(free.length, 0);
    free.write("free", 4);
    const large = Buffer.concat([source, free]);
    const output = await new VideoReviewMedia({ download: async () => large }).prepare(
      video(large),
      owner,
      generation,
    );
    expect(output.data.byteLength).toBeLessThan(12 * 1024 * 1024);
    expect(output.manifest.sourceSha256).toBe(checksum(large));
    expect(output.manifest).toMatchObject({ transcoded: true, width: 360, height: 640 });
    expect(output.manifest.submittedSha256).not.toBe(output.manifest.sourceSha256);
    const path = join(directory, "submitted.mp4");
    await writeFile(path, output.data);
    const probe = await new FFmpegRenderer().probe(path);
    expect(
      probe.streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac"),
    ).toBe(true);
    expect(probe.streams.find((stream) => stream.codec_type === "video")).toMatchObject({
      width: 360,
      height: 640,
    });
    expect(Number(probe.format.duration)).toBeCloseTo(15, 1);
  }, 120_000);
  it("rejects foreign storage paths, altered bytes and inconsistent duration", async () => {
    const download = vi.fn(async () => source),
      media = new VideoReviewMedia({ download });
    await expect(
      media.prepare({ ...video(source), video_url: "other/video.mp4" }, owner, generation),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(download).not.toHaveBeenCalled();
    await expect(
      media.prepare({ ...video(source), metadata: { sha256: "0".repeat(64) } }, owner, generation),
    ).rejects.toMatchObject({ code: "invalid_video", retryable: false });
    await expect(
      media.prepare({ ...video(source), duration: 30 }, owner, generation),
    ).rejects.toMatchObject({ code: "invalid_video", retryable: false });
  });
});
