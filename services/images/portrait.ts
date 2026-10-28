import sharp from "sharp";
import { ImageError } from "./errors";

export const PORTRAIT = { width: 720, height: 1280 } as const;

export function sceneImagePrompt(visualPrompt: string, product: string, tone: string) {
  const framing =
    "Commercial photography, coherent cinematic lighting. Center the subject within a narrow vertical 9:16 safe area; leave space for captions. No lettering, watermarks or invented logos.";
  const context = `Campaign: ${product}. Tone: ${tone}. `;
  const budget = 2048 - context.length - framing.length - 2;
  return `${context}${visualPrompt.slice(0, budget)}\n${framing}`;
}

export async function normalizePortrait(data: Uint8Array) {
  try {
    const source = sharp(data, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await source.metadata();
    if (
      !["jpeg", "png"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width < 256 ||
      metadata.height < 256
    )
      throw new Error("Unsupported image dimensions");
    const image = await source
      .rotate()
      .resize(PORTRAIT.width, PORTRAIT.height, { fit: "cover", position: "centre" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return {
      data: image,
      contentType: "image/jpeg" as const,
      ...PORTRAIT,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
    };
  } catch {
    throw new ImageError(
      "invalid_image",
      "The generated image could not be decoded as a usable scene image.",
      true,
    );
  }
}
