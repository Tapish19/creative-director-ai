import { spawn } from "node:child_process";
import { RenderError } from "./errors";

export function runMediaProcess(
  executable: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  options.signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      errors = "",
      timedOut = false,
      oversized = false;
    const abort = () => {
      child.kill("SIGKILL");
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      abort();
    }, options.timeoutMs ?? 300_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString("utf8");
      if (output.length > 256_000) {
        oversized = true;
        abort();
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      errors = (errors + data.toString("utf8")).slice(-16_000);
    });
    const cleanup = () => {
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abort);
    };
    child.once("error", () => {
      cleanup();
      reject(
        new RenderError(
          "configuration",
          "FFmpeg or FFprobe could not start. Check the installed executable paths.",
          false,
        ),
      );
    });
    child.once("close", (code) => {
      cleanup();
      if (options.signal?.aborted)
        reject(new RenderError("cancelled", "Video rendering was interrupted.", true));
      else if (timedOut || oversized)
        reject(
          new RenderError("timeout", "Media processing exceeded its time or output limit.", true),
        );
      else if (code !== 0) {
        const missing = /No such filter|Unknown encoder|not found|Error opening.*font/i.test(
          errors,
        );
        // Diagnostics stay in the trusted process; the queue persists only the safe message.
        reject(
          new RenderError(
            missing ? "configuration" : "ffmpeg_failed",
            missing
              ? "FFmpeg is missing a required codec, filter, font or input. Install a build with libx264, AAC and libass."
              : "FFmpeg could not render or inspect the media. The source assets are preserved.",
            !missing,
            errors,
          ),
        );
      } else resolve(output);
    });
  });
}
