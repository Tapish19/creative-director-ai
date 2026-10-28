import { ElevenLabsVoiceProvider } from "./elevenlabs";
import { LocalVoiceProvider } from "./local";
import { VoiceError } from "./errors";

export function createVoiceProvider(env: Record<string, string | undefined>) {
  if (env.ELEVENLABS_API_KEY?.trim())
    return new ElevenLabsVoiceProvider({
      apiKey: env.ELEVENLABS_API_KEY.trim(),
      voiceId: env.ELEVENLABS_VOICE_ID?.trim() ?? "",
      model: env.ELEVENLABS_MODEL?.trim() || undefined,
    });
  const engine =
    env.LOCAL_TTS_ENGINE?.trim() || (process.platform === "win32" ? "windows" : "espeak");
  if (engine !== "windows" && engine !== "espeak")
    throw new VoiceError("configuration", "LOCAL_TTS_ENGINE must be windows or espeak.", false);
  return new LocalVoiceProvider({
    engine,
    executable: env.LOCAL_TTS_PATH?.trim() || undefined,
    voice: env.LOCAL_TTS_VOICE?.trim() || undefined,
  });
}
