import { VoiceError } from "./errors";

export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const invalid = () =>
  new VoiceError(
    "invalid_audio",
    "The voice provider returned invalid, silent or oversized WAV audio.",
    true,
  );

// Validate PCM frames rather than estimating duration from the text. Accept RIFF
// metadata chunks emitted by native engines, but only uncompressed 16-bit mono PCM.
export function inspectWav(input: Uint8Array) {
  const data = Buffer.from(input);
  if (
    data.length < 44 ||
    data.length > MAX_AUDIO_BYTES ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE" ||
    data.readUInt32LE(4) + 8 !== data.length
  )
    throw invalid();
  let sampleRate = 0;
  let frames: Buffer | undefined;
  let formatSeen = false;
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > data.length) throw invalid();
    if (kind === "fmt ") {
      if (formatSeen || size < 16) throw invalid();
      formatSeen = true;
      sampleRate = data.readUInt32LE(start + 4);
      if (
        data.readUInt16LE(start) !== 1 ||
        data.readUInt16LE(start + 2) !== 1 ||
        data.readUInt16LE(start + 14) !== 16 ||
        sampleRate < 8000 ||
        sampleRate > 48000 ||
        data.readUInt16LE(start + 12) !== 2 ||
        data.readUInt32LE(start + 8) !== sampleRate * 2
      )
        throw invalid();
    }
    if (kind === "data") {
      if (frames) throw invalid();
      frames = data.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
    if (offset > data.length) throw invalid();
  }
  if (!sampleRate || !frames || frames.length % 2 !== 0) throw invalid();
  const durationSeconds = frames.length / (sampleRate * 2);
  if (durationSeconds < 0.2 || durationSeconds > 120) throw invalid();
  let energy = 0;
  for (let offset = 0; offset < frames.length; offset += 2)
    energy += frames.readInt16LE(offset) ** 2;
  if (Math.sqrt(energy / (frames.length / 2)) < 2) throw invalid();
  return { durationSeconds, sampleRate, channels: 1 as const, bitsPerSample: 16 as const };
}

export function pcmToWav(pcm: Uint8Array, sampleRate = 22050) {
  if (!pcm.length || pcm.length % 2 || pcm.length + 44 > MAX_AUDIO_BYTES) throw invalid();
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function validateSpeechText(text: string) {
  if (!text.trim() || text.length > 2000)
    throw new VoiceError("invalid_text", "Voiceover must contain 1–2000 characters.", false);
}
