import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  user: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  result: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: () => ({ select: mocks.select }),
    storage: { from: () => ({ createSignedUrl: mocks.sign }) },
  }),
}));
import { GET } from "@/app/api/generations/[id]/voice/route";
const owner = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002";
const path = `${owner}/${id}/voice/audio.wav`;
const request = () =>
  GET(new Request(`http://localhost/api/generations/${id}/voice`), {
    params: Promise.resolve({ id }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ url: "https://test.supabase.co", key: "test" });
  mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.result });
});
describe("private audio playback", () => {
  it("signs inherited narration only under the recorded source generation and current owner", async () => {
    const source = "10000000-0000-4000-8000-000000000003",
      reused = `${owner}/${source}/voice/audio.wav`;
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", audio_path: reused, source_generation_id: source },
      error: null,
    });
    mocks.sign.mockResolvedValue({
      data: { signedUrl: "https://test.supabase.co/signed-audio" },
      error: null,
    });
    expect((await request()).status).toBe(302);
    expect(mocks.sign).toHaveBeenCalledWith(reused, 900);
    mocks.sign.mockClear();
    mocks.result.mockResolvedValue({
      data: {
        status: "succeeded",
        audio_path: `other/${source}/voice/audio.wav`,
        source_generation_id: source,
      },
      error: null,
    });
    expect((await request()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("authenticates before reading or signing audio", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await request()).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { status: "pending", audio_path: path },
    { status: "succeeded", audio_path: `other/${id}/voice/audio.wav` },
    { status: "succeeded", audio_path: `${owner}/other/voice/audio.wav` },
  ])("does not sign absent, unfinished or foreign audio %#", async (data) => {
    mocks.result.mockResolvedValue({ data, error: null });
    expect((await request()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("redirects to a limited playback URL with private no-store caching", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", audio_path: path },
      error: null,
    });
    mocks.sign.mockResolvedValue({
      data: { signedUrl: "https://test.supabase.co/signed-audio" },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.sign).toHaveBeenCalledWith(path, 900);
  });
  it("sanitizes storage failures", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", audio_path: path },
      error: null,
    });
    mocks.sign.mockRejectedValue(new Error("secret"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
