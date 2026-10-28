import type { VoiceProvider } from "./provider";
import { VoiceError } from "./errors";
import { inspectWav, MAX_AUDIO_BYTES, pcmToWav, validateSpeechText } from "./wav";

export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly model: string;
  readonly voice: string;
  constructor(
    private readonly config: {
      apiKey: string;
      voiceId: string;
      model?: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!config.apiKey.trim() || !/^[a-zA-Z0-9_-]{1,100}$/.test(config.voiceId))
      throw new VoiceError(
        "configuration",
        "ElevenLabs requires an API key and a valid voice ID.",
        false,
      );
    this.model = config.model || "eleven_multilingual_v2";
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(this.model))
      throw new VoiceError("configuration", "ElevenLabs model ID is invalid.", false);
    this.voice = config.voiceId;
  }
  async synthesize(request: { text: string; signal?: AbortSignal }) {
    validateSpeechText(request.text);
    const signal = AbortSignal.any([
      AbortSignal.timeout(90_000),
      ...(request.signal ? [request.signal] : []),
    ]);
    try {
      const response = await (this.config.fetch ?? fetch)(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voice}?output_format=pcm_22050`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/octet-stream",
          },
          body: JSON.stringify({ text: request.text, model_id: this.model }),
          signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status))
          throw new VoiceError(
            "configuration",
            "ElevenLabs rejected the API key or voice permissions.",
            false,
          );
        const after = response.headers.get("retry-after") ?? "";
        const delay = /^\d+(\.\d+)?$/.test(after)
          ? Number(after) * 1000
          : Date.parse(after) - Date.now();
        throw new VoiceError(
          response.status === 429 ? "rate_limit" : "request_rejected",
          response.status === 429
            ? "ElevenLabs quota or rate limit reached."
            : "ElevenLabs could not synthesize this voiceover.",
          response.status === 429 || response.status === 408 || response.status >= 500,
          Number.isFinite(delay) ? Math.max(0, delay) : 0,
        );
      }
      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (
        !response.body ||
        !["audio/pcm", "audio/x-pcm", "application/octet-stream"].includes(contentType ?? "") ||
        Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES - 44
      ) {
        await response.body?.cancel();
        throw new VoiceError(
          "invalid_audio",
          "ElevenLabs returned an unexpected audio response.",
          true,
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_AUDIO_BYTES - 44) {
            await reader.cancel();
            throw new VoiceError("invalid_audio", "Voice audio exceeded the size limit.", true);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = pcmToWav(Buffer.concat(chunks));
      return {
        data,
        contentType: "audio/wav" as const,
        durationSeconds: inspectWav(data).durationSeconds,
        provider: this.name,
      };
    } catch (error) {
      if (request.signal?.aborted)
        throw new VoiceError("cancelled", "Voice generation was interrupted.", true);
      if (error instanceof VoiceError) throw error;
      if (signal.aborted)
        throw new VoiceError("timeout", "ElevenLabs voice generation timed out.", true);
      throw new VoiceError("unavailable", "ElevenLabs is temporarily unavailable.", true);
    }
  }
}
