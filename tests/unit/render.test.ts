import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  captionText,
  narrationTempo,
  subtitleScript,
} from "@/services/video/timeline";
import { runMediaProcess } from "@/services/video/process";
const scenes = [4.999, 5.001, 5].map((duration, index) => ({
  imagePath: `${index}.jpg`,
  duration,
  caption: "Still juggling bookings?",
}));
describe("render timing and subtitle boundaries", () => {
  it("keeps an exact frame budget and adds transition overlap without shortening the output", () => {
    const timeline = buildTimeline(scenes, 15);
    expect(timeline.scenes.map((scene) => [scene.startFrame, scene.endFrame])).toEqual([
      [0, 150],
      [150, 300],
      [300, 450],
    ]);
    const clips =
      timeline.scenes.reduce((sum, scene) => sum + scene.frames, 0) +
      timeline.transitionFrames * (scenes.length - 1);
    expect(clips - timeline.transitionFrames * (scenes.length - 1)).toBe(450);
    expect(subtitleScript(timeline)).toContain("0:00:05.00,0:00:10.00");
  });
  it("rejects invalid scene counts, duration drift and unbounded captions", () => {
    expect(() => buildTimeline(scenes.slice(0, 2), 15)).toThrow();
    expect(() => buildTimeline(scenes, 30)).toThrow();
    expect(() =>
      buildTimeline(
        scenes.map((scene) => ({ ...scene, caption: "x".repeat(81) })),
        15,
      ),
    ).toThrow();
  });
  it("keeps ASS overrides and line breaks from becoming formatting instructions", () => {
    const text = captionText("Sale {\\pos(1,1)} \\N\nNow!");
    expect(text).not.toContain("{\\pos");
    expect(text).toContain("｛＼pos");
    expect(
      captionText("word ".repeat(12))
        .split("\\N")
        .every((line) => line.length <= 25),
    ).toBe(true);
  });
  it("preserves short narration, bounds speed-up and rejects severe overrun", () => {
    expect(narrationTempo(9, 15)).toBe(1);
    expect(narrationTempo(16, 15)).toBeCloseTo(16 / 14.75);
    expect(() => narrationTempo(20, 15)).toThrow("too long");
    expect(() => narrationTempo(NaN, 15)).toThrow();
  });
});
describe("native process boundaries", () => {
  it("rejects a missing executable with a safe configuration error", async () => {
    await expect(runMediaProcess("missing-test-media-binary", [])).rejects.toMatchObject({
      code: "configuration",
      retryable: false,
    });
  });
  it("terminates a process that exceeds its deadline", async () => {
    await expect(
      runMediaProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("honors cancellation without starting work on an aborted signal", async () => {
    expect(() =>
      runMediaProcess(process.execPath, ["-e", ""], { signal: AbortSignal.abort() }),
    ).toThrow();
  });
});
