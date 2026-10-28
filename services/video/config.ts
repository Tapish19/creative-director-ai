import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { RenderError } from "./errors";

export function mediaExecutables(env: Record<string, string | undefined> = process.env) {
  const root = resolve(".tools/ffmpeg");
  const folder =
    process.platform === "win32" && existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => join(root, item.name, "bin"))
          .find(
            (bin) => existsSync(join(bin, "ffmpeg.exe")) && existsSync(join(bin, "ffprobe.exe")),
          )
      : undefined;
  return {
    ffmpeg:
      env.FFMPEG_PATH?.trim() && env.FFMPEG_PATH !== "ffmpeg"
        ? env.FFMPEG_PATH.trim()
        : folder
          ? join(folder, "ffmpeg.exe")
          : "ffmpeg",
    ffprobe:
      env.FFPROBE_PATH?.trim() && env.FFPROBE_PATH !== "ffprobe"
        ? env.FFPROBE_PATH.trim()
        : folder
          ? join(folder, "ffprobe.exe")
          : "ffprobe",
  };
}
export function renderMusicPath(env: Record<string, string | undefined> = process.env) {
  const path = env.RENDER_MUSIC_PATH?.trim();
  if (!path) return undefined;
  if (!existsSync(path) || !path.toLowerCase().endsWith(".wav"))
    throw new RenderError(
      "configuration",
      "RENDER_MUSIC_PATH must point to an existing local WAV file.",
      false,
    );
  return resolve(path);
}
