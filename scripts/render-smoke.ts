import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { LocalVoiceProvider } from "../services/voice/local";
import { FFmpegRenderer } from "../services/video/ffmpeg";

// Explicit renderer fixture: designed test artwork, not AI-generated campaign imagery.
const folder = resolve("artifacts/render-smoke");
await mkdir(folder, { recursive: true });
const captions = ["Still juggling bookings?", "One cloud platform", "Book a free demo"];
const colors = ["#29233f", "#596e52", "#674f99"];
const scenes = [];
for (let index = 0; index < 3; index++) {
  const imagePath = join(folder, `scene-${index}.jpg`);
  await sharp(
    Buffer.from(
      `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1280" fill="${colors[index]}"/><circle cx="360" cy="500" r="230" fill="#ffffff" opacity=".12"/><rect x="230" y="290" width="260" height="380" rx="24" fill="#e9e2ee"/><g fill="${colors[index]}"><rect x="260" y="340" width="65" height="70"/><rect x="395" y="340" width="65" height="70"/><rect x="260" y="450" width="65" height="70"/><rect x="395" y="450" width="65" height="70"/><rect x="325" y="570" width="70" height="100"/></g><text x="360" y="170" text-anchor="middle" fill="white" font-family="Arial" font-size="43">MyHotelLine</text><text x="360" y="1200" text-anchor="middle" fill="white" font-family="Arial" font-size="18">RENDER TEST · DESIGNED PLACEHOLDER ART</text></svg>`,
    ),
  )
    .jpeg()
    .toFile(imagePath);
  scenes.push({ imagePath, duration: 5, caption: captions[index] });
}
const voice = await new LocalVoiceProvider().synthesize({
  text: "Still juggling bookings and bills? Bring hotel operations together with MyHotelLine. Book your free product demo today.",
});
const voicePath = join(folder, "voice.wav");
await writeFile(voicePath, voice.data);
const renderer = new FFmpegRenderer();
const output = await renderer.render({
  scenes,
  voicePath,
  outputPath: join(folder, "myhotelline-render-test.mp4"),
  width: 720,
  height: 1280,
  targetDuration: 15,
});
console.info(JSON.stringify(output));
