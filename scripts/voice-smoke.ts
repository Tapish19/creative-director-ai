import { mkdir, writeFile } from "node:fs/promises";
import { LocalVoiceProvider } from "../services/voice/local";
import { inspectWav } from "../services/voice/wav";

const provider = new LocalVoiceProvider();
const result = await provider.synthesize({
  text: "Still juggling bookings and bills? Bring hotel operations together with MyHotelLine. Book your free product demo today.",
});
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/myhotelline-voice.wav", result.data);
console.info(
  JSON.stringify({
    provider: provider.model,
    ...inspectWav(result.data),
    path: "artifacts/myhotelline-voice.wav",
  }),
);
