import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { CloudflareImageProvider } from "@/services/images/cloudflare";
import { normalizePortrait, sceneImagePrompt } from "@/services/images/portrait";
import { readImageWorkerConfig } from "@/workers/config";

const credentials = { accountId: "a".repeat(32), apiToken: "test-only-token" };
const request = {
  prompt: "An independent hotel owner at a reception desk",
  width: 720,
  height: 1280,
};
const provider = (fetcher: typeof fetch) =>
  new CloudflareImageProvider({ ...credentials, fetch: fetcher });

describe("Cloudflare image adapter", () => {
  it("uses the documented REST envelope, bearer header and supported model parameters", async () => {
    const data = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#abcdef" },
    })
      .png()
      .toBuffer();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ success: true, result: { image: data.toString("base64") } }),
      );
    const result = await provider(fetcher).generate(request);
    expect(Buffer.from(result.data)).toEqual(data);
    expect(result.contentType).toBe("image/png");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-only-token" });
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: request.prompt, steps: 4 });
  });
  it.each([401, 403, 400, 500, 503])(
    "classifies HTTP %s without exposing upstream diagnostics",
    async (status) => {
      const call = provider(
        vi.fn().mockResolvedValue(new Response("private-token-secret", { status })),
      ).generate(request);
      await expect(call).rejects.toMatchObject({ retryable: status >= 500 });
      await expect(call).rejects.not.toThrow("private-token-secret");
    },
  );
  it("honors Retry-After without sleeping in the provider", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("quota", { status: 429, headers: { "Retry-After": "120" } }));
    await expect(provider(fetcher).generate(request)).rejects.toMatchObject({
      code: "rate_limit",
      retryAfterMs: 120000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { success: false, result: { image: "AAAA" } },
    { success: true, result: { image: "not base64!" } },
    { success: true, result: { image: Buffer.from("<svg>not an image</svg>").toString("base64") } },
  ])("rejects unsuccessful envelopes and invalid image payloads %#", async (body) => {
    await expect(
      provider(vi.fn().mockResolvedValue(Response.json(body))).generate(request),
    ).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("bounds streaming responses even without a Content-Length header", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
      },
      cancel,
    });
    await expect(
      provider(vi.fn().mockResolvedValue(new Response(stream))).generate(request),
    ).rejects.toMatchObject({ code: "invalid_image" });
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects oversized prompts before making a request", async () => {
    const fetcher = vi.fn();
    await expect(
      provider(fetcher).generate({ ...request, prompt: "a".repeat(2049) }),
    ).rejects.toMatchObject({ code: "invalid_prompt", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes network failures and recognizes cancellation", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("secret-url-token"));
    await expect(provider(fetcher).generate(request)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      provider(fetcher).generate({ ...request, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("portrait preparation", () => {
  it("decodes an actual source image, crops to 720×1280 and emits a real JPEG", async () => {
    const source = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#caa8df" },
    })
      .png()
      .toBuffer();
    const result = await normalizePortrait(source);
    const metadata = await sharp(result.data).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 720, height: 1280 });
    expect(result).toMatchObject({ sourceWidth: 1024, sourceHeight: 1024 });
  });
  it("rejects corrupt and undersized images before upload", async () => {
    await expect(normalizePortrait(Buffer.from("broken"))).rejects.toMatchObject({
      code: "invalid_image",
    });
    const tiny = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    await expect(normalizePortrait(tiny)).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("keeps composition guidance when truncating long visual prompts", () => {
    const result = sceneImagePrompt("a".repeat(3000), "p".repeat(120), "t".repeat(120));
    expect(result.length).toBeLessThanOrEqual(2048);
    expect(result).toContain("vertical 9:16 safe area");
    expect(result).toContain("No lettering");
  });
  it("validates only image-worker credentials without leaking their values", () => {
    expect(() => readImageWorkerConfig({ CLOUDFLARE_ACCOUNT_ID: "bad-secret" })).toThrow(
      "CLOUDFLARE_ACCOUNT_ID",
    );
    expect(() => readImageWorkerConfig({ CLOUDFLARE_ACCOUNT_ID: "bad-secret" })).not.toThrow(
      "bad-secret",
    );
    expect(
      readImageWorkerConfig({
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "x".repeat(30),
        CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
        CLOUDFLARE_API_TOKEN: "token",
      }).CLOUDFLARE_API_TOKEN,
    ).toBe("token");
  });
});
