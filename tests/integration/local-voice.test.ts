import { describe, expect, it } from "vitest";
import { LocalVoiceProvider } from "@/services/voice/local";
import { inspectWav } from "@/services/voice/wav";

describe("installed local speech engine", () => {
  it("synthesizes real narration with no network or API key", async () => {
    const audio = await new LocalVoiceProvider().synthesize({
      text: "Bring hotel operations together with MyHotelLine. Book your free product demo today.",
    });
    const measured = inspectWav(audio.data);
    expect(audio.provider).toBe("local");
    expect(measured.durationSeconds).toBeGreaterThan(1);
    expect(measured.durationSeconds).toBeLessThan(30);
    expect(audio.durationSeconds).toBe(measured.durationSeconds);
  }, 70000);
});
