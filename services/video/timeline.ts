import { RenderError } from "./errors";
export const VIDEO_WIDTH = 720,
  VIDEO_HEIGHT = 1280,
  VIDEO_FPS = 30;
export type RenderScene = { imagePath: string; duration: number; caption: string };

export function buildTimeline(scenes: RenderScene[], duration: number) {
  if (
    ![15, 30].includes(duration) ||
    scenes.length < 3 ||
    scenes.length > 5 ||
    scenes.some(
      (scene) =>
        !Number.isFinite(scene.duration) ||
        scene.duration <= 0 ||
        scene.caption.length < 1 ||
        scene.caption.length > 80,
    ) ||
    Math.abs(scenes.reduce((sum, scene) => sum + scene.duration, 0) - duration) > 0.01
  )
    throw new RenderError(
      "invalid_input",
      "The storyboard must contain 3–5 scenes totaling 15 or 30 seconds.",
      false,
    );
  let cursor = 0;
  const timeline = scenes.map((scene, index) => {
    const frames =
      index === scenes.length - 1
        ? duration * VIDEO_FPS - cursor
        : Math.round(scene.duration * VIDEO_FPS);
    if (frames < 2)
      throw new RenderError("invalid_input", "A scene is too short for video rendering.", false);
    const startFrame = cursor;
    cursor += frames;
    return { ...scene, frames, startFrame, endFrame: cursor };
  });
  const transitionFrames = Math.max(
    1,
    Math.min(10, Math.floor(Math.min(...timeline.map((scene) => scene.frames)) / 2)),
  );
  return { scenes: timeline, transitionFrames, duration, fps: VIDEO_FPS };
}
export function narrationTempo(voiceDuration: number, target: number) {
  if (!Number.isFinite(voiceDuration) || voiceDuration < 0.2)
    throw new RenderError("invalid_audio", "Narration duration is invalid.", false);
  const tempo = voiceDuration <= target - 0.25 ? 1 : voiceDuration / (target - 0.25);
  if (tempo > 1.25)
    throw new RenderError(
      "narration_too_long",
      "Narration is too long to fit naturally. Shorten the script before rendering a new version.",
      false,
    );
  return tempo;
}
function assTime(seconds: number) {
  const centiseconds = Math.round(seconds * 100);
  return `0:${String(Math.floor(centiseconds / 6000)).padStart(2, "0")}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}
export function captionText(text: string) {
  // ASS overrides and escape sequences are formatting instructions, not user text.
  const plain = text
    .replace(/[\\{}]/g, (character) => ({ "\\": "＼", "{": "｛", "}": "｝" })[character]!)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "");
  const lines: string[] = [];
  let line = "";
  for (const word of plain.split(/\s+/)) {
    for (let index = 0; index < word.length; index += 24) {
      const part = word.slice(index, index + 24);
      if (line && line.length + part.length + 1 > 25) {
        lines.push(line);
        line = "";
      }
      line += `${line ? " " : ""}${part}`;
    }
  }
  if (line) lines.push(line);
  return lines.join("\\N");
}
export function subtitleScript(timeline: ReturnType<typeof buildTimeline>) {
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Arial,44,&H00FFFFFF,&H00FFFFFF,&H0021192D,&H801C1724,-1,0,0,0,100,100,0,0,3,14,0,2,60,60,190,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${timeline.scenes.map((scene) => `Dialogue: 0,${assTime(scene.startFrame / 30)},${assTime(scene.endFrame / 30)},Caption,,0,0,0,,${captionText(scene.caption)}`).join("\n")}\n`;
}
