import { describe, expect, it, vi } from "vitest";
import { ElevenLabsVoiceProvider } from "@/services/voice/elevenlabs";
import { LocalVoiceProvider } from "@/services/voice/local";
import { createVoiceProvider } from "@/services/voice/factory";
import { inspectWav, MAX_AUDIO_BYTES, pcmToWav } from "@/services/voice/wav";
import { testPcm } from "../fixtures/audio";
const config = { apiKey: "test-only-key", voiceId: "test-voice" };
const request = { text: "Book your free product demo today." };
const pcmResponse = (data = testPcm()) =>
  new Response(data, { headers: { "content-type": "audio/pcm" } });
describe("voice provider selection", () => {
  it("selects a real local engine without an ElevenLabs key", () => {
    expect(createVoiceProvider({}).name).toBe("local");
  });
  it("selects ElevenLabs when configured and does not silently change providers for a missing voice", () => {
    expect(
      createVoiceProvider({ ELEVENLABS_API_KEY: "key", ELEVENLABS_VOICE_ID: "voice" }).name,
    ).toBe("elevenlabs");
    expect(() => createVoiceProvider({ ELEVENLABS_API_KEY: "secret" })).toThrow("voice ID");
    expect(() => createVoiceProvider({ LOCAL_TTS_ENGINE: "invalid" })).toThrow("LOCAL_TTS_ENGINE");
  });
  it("reports unavailable local engines without leaking their command line", async () => {
    await expect(
      new LocalVoiceProvider({
        engine: "espeak",
        executable: "missing-test-speech-binary",
      }).synthesize(request),
    ).rejects.toMatchObject({ code: "configuration", retryable: false });
  });
});
describe("ElevenLabs adapter", () => {
  it("uses the real PCM API contract and measures duration from frames", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(pcmResponse());
    const result = await new ElevenLabsVoiceProvider({ ...config, fetch: fetcher }).synthesize(
      request,
    );
    expect(result.durationSeconds).toBe(1);
    expect(inspectWav(result.data).sampleRate).toBe(22050);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/test-voice?output_format=pcm_22050",
    );
    expect(init?.headers).toMatchObject({ "xi-api-key": config.apiKey });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: request.text,
      model_id: "eleven_multilingual_v2",
    });
  });
  it.each([400, 401, 403, 408, 429, 500, 503])(
    "classifies HTTP %s without leaking provider errors",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          new Response("secret diagnostics", { status, headers: { "Retry-After": "120" } }),
        );
      const call = new ElevenLabsVoiceProvider({ ...config, fetch: fetcher }).synthesize(request);
      await expect(call).rejects.toMatchObject({
        retryable: [408, 429, 500, 503].includes(status),
      });
      await expect(call).rejects.not.toThrow("secret");
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (status === 429) await expect(call).rejects.toMatchObject({ retryAfterMs: 120000 });
    },
  );
  it("rejects non-audio, silence and truncated PCM", async () => {
    for (const response of [
      Response.json({ error: "not audio" }),
      pcmResponse(Buffer.alloc(44100)),
      pcmResponse(Buffer.from([1, 2, 3])),
    ]) {
      await expect(
        new ElevenLabsVoiceProvider({
          ...config,
          fetch: vi.fn().mockResolvedValue(response),
        }).synthesize(request),
      ).rejects.toMatchObject({ code: "invalid_audio" });
    }
  });
  it("bounds response streams without trusting Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES));
      },
      cancel,
    });
    await expect(
      new ElevenLabsVoiceProvider({
        ...config,
        fetch: vi
          .fn()
          .mockResolvedValue(new Response(stream, { headers: { "content-type": "audio/pcm" } })),
      }).synthesize(request),
    ).rejects.toMatchObject({ code: "invalid_audio" });
    expect(cancel).toHaveBeenCalled();
  });
  it("validates narration before calling the provider and handles cancellation", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("secret upstream"));
    const provider = new ElevenLabsVoiceProvider({ ...config, fetch: fetcher });
    await expect(provider.synthesize({ text: "x".repeat(2001) })).rejects.toMatchObject({
      code: "invalid_text",
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      provider.synthesize({ ...request, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "cancelled" });
    await expect(provider.synthesize(request)).rejects.toMatchObject({ code: "unavailable" });
  });
});
describe("audio validation", () => {
  it("rejects forged RIFF lengths, sample rates, encoding and silent output", () => {
    const original = pcmToWav(testPcm());
    for (const [offset, value] of [
      [4, 1],
      [24, 0],
      [20, 3],
      [32, 4],
    ]) {
      const broken = Buffer.from(original);
      broken.writeUInt32LE(value, offset);
      expect(() => inspectWav(broken)).toThrow("invalid");
    }
    expect(() => inspectWav(pcmToWav(Buffer.alloc(44100)))).toThrow("silent");
  });
  it("enforces finite duration rather than trusting metadata from a provider", () => {
    expect(inspectWav(pcmToWav(testPcm(2))).durationSeconds).toBe(2);
    expect(() => inspectWav(pcmToWav(testPcm(121)))).toThrow("invalid");
  });
});
