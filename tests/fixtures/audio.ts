// Deterministic PCM test tone. Never imported by application providers or demos.
export function testPcm(seconds = 1, sampleRate = 22050) {
  const pcm = Buffer.alloc(seconds * sampleRate * 2);
  for (let frame = 0; frame < seconds * sampleRate; frame++)
    pcm.writeInt16LE(
      Math.round(5000 * Math.sin((2 * Math.PI * 440 * frame) / sampleRate)),
      frame * 2,
    );
  return pcm;
}
