import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { VoiceProvider } from "./provider";
import { VoiceError } from "./errors";
import { inspectWav, MAX_AUDIO_BYTES, validateSpeechText } from "./wav";

export class LocalVoiceProvider implements VoiceProvider {
  readonly name = "local";
  readonly model: string;
  readonly voice: string;
  constructor(
    private readonly options: {
      engine?: "windows" | "espeak";
      executable?: string;
      voice?: string;
    } = {},
  ) {
    this.model =
      (options.engine ?? (process.platform === "win32" ? "windows" : "espeak")) === "windows"
        ? "windows-system-speech"
        : "espeak-ng";
    this.voice =
      options.voice || (this.model === "windows-system-speech" ? "en-US system default" : "en-us");
  }
  async synthesize(request: { text: string; signal?: AbortSignal }) {
    validateSpeechText(request.text);
    request.signal?.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), "creative-director-voice-"));
    const output = join(directory, "voice.wav");
    const input = join(directory, "narration.txt");
    const windows = this.model === "windows-system-speech";
    try {
      await writeFile(input, request.text, "utf8");
      const args = windows
        ? [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            fileURLToPath(new URL("../../scripts/synthesize-windows.ps1", import.meta.url)),
            "-InputPath",
            input,
            "-OutputPath",
            output,
            ...(this.options.voice ? ["-VoiceName", this.options.voice] : []),
          ]
        : ["-b", "1", "-v", this.voice, "-s", "160", "-w", output, "-f", input];
      await new Promise<void>((resolveProcess, reject) => {
        const child = spawn(
          this.options.executable || (windows ? "powershell.exe" : "espeak-ng"),
          args,
          { shell: false, windowsHide: true, stdio: "ignore" },
        );
        let interrupted = false;
        const abort = () => {
          interrupted = true;
          child.kill();
        };
        const deadline = setTimeout(abort, 60_000);
        request.signal?.addEventListener("abort", abort, { once: true });
        if (request.signal?.aborted) abort();
        const cleanup = () => {
          clearTimeout(deadline);
          request.signal?.removeEventListener("abort", abort);
        };
        child.once("error", () => {
          cleanup();
          reject(
            new VoiceError(
              "configuration",
              "The local speech engine could not start. Check its installation and executable path.",
              false,
            ),
          );
        });
        child.once("close", (code) => {
          cleanup();
          if (interrupted)
            reject(
              new VoiceError(
                request.signal?.aborted ? "cancelled" : "timeout",
                "Local speech generation was interrupted or timed out.",
                true,
              ),
            );
          else if (code !== 0)
            reject(
              new VoiceError(
                "configuration",
                "The local speech engine failed. Check that the selected English voice is installed.",
                false,
              ),
            );
          else resolveProcess();
        });
      });
      if ((await stat(output)).size > MAX_AUDIO_BYTES)
        throw new VoiceError("invalid_audio", "Local speech audio exceeded the size limit.", false);
      const data = await readFile(output);
      return {
        data,
        contentType: "audio/wav" as const,
        durationSeconds: inspectWav(data).durationSeconds,
        provider: this.name,
      };
    } finally {
      // Only remove the unique temporary directory this invocation created.
      const root = resolve(tmpdir());
      const target = resolve(directory);
      if (
        !target.startsWith(root + sep) ||
        !target.slice(root.length + 1).startsWith("creative-director-voice-")
      )
        throw new Error("Unsafe speech temporary directory");
      await rm(target, { recursive: true, force: true });
    }
  }
}
