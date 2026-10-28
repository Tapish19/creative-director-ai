import { mkdtemp, readFile, writeFile, copyFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { VideoRenderer } from "./provider";
import { runMediaProcess } from "./process";
import { mediaExecutables } from "./config";
import {
  buildTimeline,
  narrationTempo,
  subtitleScript,
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
  VIDEO_FPS,
} from "./timeline";
import { inspectWav, MAX_AUDIO_BYTES } from "@/services/voice/wav";
import { RenderError } from "./errors";

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
      pix_fmt: z.string().optional(),
      duration: z.string().optional(),
      nb_frames: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string() }),
});
export class FFmpegRenderer implements VideoRenderer {
  readonly name = "ffmpeg";
  version?: string;
  constructor(private readonly binaries = mediaExecutables()) {}
  async verifyRuntime() {
    const [version, filters, encoders] = await Promise.all([
      runMediaProcess(this.binaries.ffmpeg, ["-version"], { timeoutMs: 15_000 }),
      runMediaProcess(this.binaries.ffmpeg, ["-hide_banner", "-filters"], { timeoutMs: 15_000 }),
      runMediaProcess(this.binaries.ffmpeg, ["-hide_banner", "-encoders"], { timeoutMs: 15_000 }),
      runMediaProcess(this.binaries.ffprobe, ["-version"], { timeoutMs: 15_000 }),
    ]);
    if (
      !["zoompan", "xfade", "ass", "loudnorm", "atempo"].every((filter) =>
        new RegExp(`\\b${filter}\\b`).test(filters),
      ) ||
      !/\blibx264\b/.test(encoders) ||
      !/\baac\b/.test(encoders)
    )
      throw new RenderError(
        "configuration",
        "FFmpeg requires libx264, AAC, libass and the motion/audio filters.",
        false,
      );
    this.version = version.split(/\r?\n/)[0].slice(0, 200);
  }
  async probe(path: string, signal?: AbortSignal) {
    try {
      return probeSchema.parse(
        JSON.parse(
          await runMediaProcess(
            this.binaries.ffprobe,
            ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
            { signal, timeoutMs: 30_000 },
          ),
        ),
      );
    } catch (error) {
      if (error instanceof RenderError) throw error;
      throw new RenderError("invalid_video", "FFprobe returned invalid video metadata.", true);
    }
  }
  async render(request: Parameters<VideoRenderer["render"]>[0]) {
    if (request.width !== VIDEO_WIDTH || request.height !== VIDEO_HEIGHT)
      throw new RenderError(
        "invalid_input",
        "The renderer requires a 720×1280 portrait canvas.",
        false,
      );
    const timeline = buildTimeline(request.scenes, request.targetDuration);
    const directory = await mkdtemp(join(tmpdir(), "creative-director-render-"));
    try {
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-filter_complex_threads",
        "1",
      ];
      for (let index = 0; index < request.scenes.length; index++) {
        request.signal?.throwIfAborted();
        const scene = request.scenes[index];
        if ((await stat(scene.imagePath)).size > 8 * 1024 * 1024)
          throw new RenderError(
            "invalid_image",
            "A scene image exceeds the render input limit.",
            false,
          );
        // Decode and re-encode to a fixed local JPEG. No user path enters a filter expression.
        await sharp(await readFile(scene.imagePath), {
          limitInputPixels: 20_000_000,
          failOn: "warning",
        })
          .rotate()
          .resize(VIDEO_WIDTH, VIDEO_HEIGHT, { fit: "cover" })
          .jpeg({ quality: 95 })
          .toFile(join(directory, `scene-${index}.jpg`));
        args.push("-i", `scene-${index}.jpg`);
      }
      if ((await stat(request.voicePath)).size > MAX_AUDIO_BYTES)
        throw new RenderError("invalid_audio", "Narration exceeds the render input limit.", false);
      const narration = await readFile(request.voicePath);
      const audio = inspectWav(narration);
      const tempo = narrationTempo(audio.durationSeconds, request.targetDuration);
      await writeFile(join(directory, "voice.wav"), narration);
      args.push("-i", "voice.wav");
      if (request.musicPath) {
        if ((await stat(request.musicPath)).size > MAX_AUDIO_BYTES)
          throw new RenderError(
            "invalid_audio",
            "Background music exceeds the WAV size limit.",
            false,
          );
        const music = await readFile(request.musicPath);
        inspectWav(music);
        await writeFile(join(directory, "music.wav"), music);
        args.push("-stream_loop", "-1", "-i", "music.wav");
      }
      const filters: string[] = [];
      timeline.scenes.forEach((scene, index) => {
        const frames =
          scene.frames + (index < timeline.scenes.length - 1 ? timeline.transitionFrames : 0);
        const zoom = index % 2 === 0 ? `1+0.08*on/${frames}` : `1.08-0.08*on/${frames}`;
        const x = index % 2 === 0 ? "iw/2-iw/zoom/2" : `(iw-iw/zoom)*on/${frames}`;
        filters.push(
          `[${index}:v]scale=1440:2560,zoompan=z='${zoom}':x='${x}':y='ih/2-ih/zoom/2':d=${frames}:s=720x1280:fps=30,trim=end_frame=${frames},setpts=PTS-STARTPTS,settb=1/30,format=yuv444p,fps=30[v${index}]`,
        );
      });
      let previous = "v0";
      for (let index = 1; index < timeline.scenes.length; index++) {
        filters.push(
          `[${previous}][v${index}]xfade=transition=fade:duration=${timeline.transitionFrames / 30}:offset=${timeline.scenes[index].startFrame / 30},fps=30[mix${index}]`,
        );
        previous = `mix${index}`;
      }
      filters.push(
        `[${previous}]ass=filename=captions.ass,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${request.targetDuration * 30},setpts=N/30/TB,scale=out_range=tv,format=yuv420p,setparams=range=limited,setsar=1[vout]`,
      );
      const audioIndex = request.scenes.length;
      filters.push(
        `[${audioIndex}:a]atempo=${tempo.toFixed(8)},loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=duration=${request.targetDuration},asetpts=PTS-STARTPTS[narration]`,
      );
      if (request.musicPath) {
        filters.push(
          `[${audioIndex + 1}:a]atrim=duration=${request.targetDuration},asetpts=PTS-STARTPTS,volume=0.08,afade=t=in:d=0.4,afade=t=out:st=${request.targetDuration - 1}:d=1[music]`,
        );
        filters.push(
          "[narration][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1[aout]",
        );
      } else filters.push("[narration]anull[aout]");
      await writeFile(join(directory, "captions.ass"), subtitleScript(timeline), "utf8");
      await writeFile(join(directory, "render.ffgraph"), filters.join(";\n"), "utf8");
      args.push(
        "-filter_complex_script",
        "render.ffgraph",
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-t",
        String(request.targetDuration),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "output.mp4",
      );
      await runMediaProcess(this.binaries.ffmpeg, args, {
        cwd: directory,
        signal: request.signal,
        timeoutMs: 300_000,
      });
      const output = join(directory, "output.mp4");
      const info = await this.probe(output, request.signal);
      const video = info.streams.find((stream) => stream.codec_type === "video");
      const sound = info.streams.find((stream) => stream.codec_type === "audio");
      const duration = Number(info.format.duration);
      const size = (await stat(output)).size;
      if (
        info.streams.length !== 2 ||
        video?.codec_name !== "h264" ||
        video.width !== VIDEO_WIDTH ||
        video.height !== VIDEO_HEIGHT ||
        video.pix_fmt !== "yuv420p" ||
        video.avg_frame_rate !== "30/1" ||
        Number(video.nb_frames) !== request.targetDuration * 30 ||
        sound?.codec_name !== "aac" ||
        Math.abs(Number(sound.duration) - request.targetDuration) > 0.1 ||
        !Number.isFinite(duration) ||
        Math.abs(duration - request.targetDuration) > 0.1 ||
        size < 1000 ||
        size > 100 * 1024 * 1024
      )
        throw new RenderError(
          "invalid_video",
          "The rendered MP4 failed duration, codec, frame-count or size validation.",
          true,
          JSON.stringify({ info, size }),
        );
      request.signal?.throwIfAborted();
      await copyFile(output, request.outputPath);
      return {
        path: request.outputPath,
        durationSeconds: duration,
        sizeBytes: size,
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
        fps: VIDEO_FPS,
        narrationTempo: tempo,
        musicIncluded: !!request.musicPath,
      };
    } finally {
      const root = resolve(tmpdir()),
        target = resolve(directory);
      if (
        !target.startsWith(root + sep) ||
        !target.slice(root.length + 1).startsWith("creative-director-render-")
      )
        throw new Error("Unsafe render temporary directory");
      await rm(target, { recursive: true, force: true });
    }
  }
}
