import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FFmpegRenderer } from "@/services/video/ffmpeg";
import { mediaExecutables } from "@/services/video/config";
import { runMediaProcess } from "@/services/video/process";
import { LocalVoiceProvider } from "@/services/voice/local";
import { inspectWav, pcmToWav } from "@/services/voice/wav";
import { testPcm } from "../fixtures/audio";
let directory: string;
let voicePath: string;
const paths: string[] = [];
const renderer = new FFmpegRenderer();
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "creative-director-ffmpeg-test-"));
  await renderer.verifyRuntime();
  for (let index = 0; index < 5; index++) {
    const path = join(directory, `source-${index}.jpg`);
    await sharp(
      Buffer.from(
        `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1280" fill="${["#d83232", "#32b450", "#3248d8", "#b448c9", "#5c5c38"][index]}"/><circle cx="200" cy="400" r="100" fill="#222222"/></svg>`,
      ),
    )
      .jpeg()
      .toFile(path);
    paths.push(path);
  }
  voicePath = join(directory, "voice.wav");
  const voice = await new LocalVoiceProvider().synthesize({
    text: "Still juggling bookings and bills? Bring hotel operations together with MyHotelLine. Book your free product demo today.",
  });
  await writeFile(voicePath, voice.data);
});
afterAll(async () => {
  if (!directory) return;
  const root = resolve(tmpdir()),
    target = resolve(directory);
  if (
    !target.startsWith(root + sep) ||
    !target.slice(root.length + 1).startsWith("creative-director-ffmpeg-test-")
  )
    throw new Error("Unsafe test directory");
  await rm(target, { recursive: true, force: true });
});
describe("real FFmpeg rendering", () => {
  it("renders and fully decodes a 15-second H.264/AAC MP4 with visible captions, motion and a blended transition", async () => {
    const outputPath = join(directory, "fifteen.mp4");
    const result = await renderer.render({
      scenes: paths
        .slice(0, 3)
        .map((imagePath) => ({ imagePath, duration: 5, caption: "Book your free demo" })),
      voicePath,
      outputPath,
      width: 720,
      height: 1280,
      targetDuration: 15,
    });
    expect(result).toMatchObject({
      durationSeconds: 15,
      width: 720,
      height: 1280,
      fps: 30,
      narrationTempo: 1,
      musicIncluded: false,
    });
    const info = await renderer.probe(outputPath);
    expect(info.streams.find((stream) => stream.codec_type === "video")?.nb_frames).toBe("450");
    await runMediaProcess(
      mediaExecutables().ffmpeg,
      ["-v", "error", "-i", outputPath, "-f", "null", "-"],
      { timeoutMs: 60000 },
    );
    const frames = [];
    for (const [index, time] of [1, 4, 5.16].entries()) {
      const path = join(directory, `frame-${index}.png`);
      await runMediaProcess(mediaExecutables().ffmpeg, [
        "-v",
        "error",
        "-y",
        "-ss",
        String(time),
        "-i",
        outputPath,
        "-frames:v",
        "1",
        path,
      ]);
      frames.push(await readFile(path));
    }
    const first = await sharp(frames[0]).raw().toBuffer();
    const later = await sharp(frames[1]).raw().toBuffer();
    expect(first.equals(later)).toBe(false);
    const caption = await sharp(frames[0])
      .extract({ left: 60, top: 970, width: 600, height: 150 })
      .raw()
      .toBuffer();
    let white = 0;
    for (let index = 0; index < caption.length; index += 3)
      if (caption[index] > 220 && caption[index + 1] > 220 && caption[index + 2] > 220) white++;
    expect(white).toBeGreaterThan(500);
    const blend = await sharp(frames[2])
      .extract({ left: 20, top: 20, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(blend[0]).toBeGreaterThan(60);
    expect(blend[1]).toBeGreaterThan(60);
    const decoded = join(directory, "decoded.wav");
    await runMediaProcess(mediaExecutables().ffmpeg, [
      "-v",
      "error",
      "-y",
      "-i",
      outputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "22050",
      "-c:a",
      "pcm_s16le",
      decoded,
    ]);
    expect(inspectWav(await readFile(decoded)).durationSeconds).toBeCloseTo(15, 1);
  }, 120000);
  it("renders a 30-second five-scene video with optional music and exact duration", async () => {
    const musicPath = join(directory, "music.wav");
    await writeFile(musicPath, pcmToWav(testPcm(2)));
    const result = await renderer.render({
      scenes: paths.map((imagePath) => ({
        imagePath,
        duration: 6,
        caption: "A clearer way to manage",
      })),
      voicePath,
      musicPath,
      outputPath: join(directory, "thirty.mp4"),
      width: 720,
      height: 1280,
      targetDuration: 30,
    });
    expect(result.durationSeconds).toBe(30);
    expect(result.musicIncluded).toBe(true);
    const info = await renderer.probe(result.path);
    expect(info.streams.find((stream) => stream.codec_type === "video")?.nb_frames).toBe("900");
  }, 120000);
  it("rejects narration that cannot fit without excessive acceleration", async () => {
    const tooLong = join(directory, "long.wav");
    await writeFile(tooLong, pcmToWav(testPcm(25)));
    await expect(
      renderer.render({
        scenes: paths
          .slice(0, 3)
          .map((imagePath) => ({ imagePath, duration: 5, caption: "A scene" })),
        voicePath: tooLong,
        outputPath: join(directory, "invalid.mp4"),
        width: 720,
        height: 1280,
        targetDuration: 15,
      }),
    ).rejects.toMatchObject({ code: "narration_too_long", retryable: false });
  });
});
