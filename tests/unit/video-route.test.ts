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
import { GET } from "@/app/api/generations/[id]/video/route";
const owner = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002";
const path = `${owner}/${id}/video/video.mp4`;
const request = (query = "") =>
  GET(new Request(`http://localhost/api/generations/${id}/video${query}`), {
    params: Promise.resolve({ id }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ url: "https://test.supabase.co", key: "test" });
  mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.result });
});
describe("private video playback", () => {
  it("authenticates before reading or signing video", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await request()).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { status: "pending", video_url: path },
    { status: "succeeded", video_url: `other/${id}/video/video.mp4` },
    { status: "succeeded", video_url: `${owner}/other/video/video.mp4` },
  ])("does not sign absent, unfinished or foreign video %#", async (data) => {
    mocks.result.mockResolvedValue({ data, error: null });
    expect((await request()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("redirects to a limited playback URL with private no-store caching", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", video_url: path },
      error: null,
    });
    mocks.sign.mockResolvedValue({
      data: { signedUrl: "https://test.supabase.co/signed-video" },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.sign).toHaveBeenCalledWith(path, 900, undefined);
  });
  it("sanitizes storage failures", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", video_url: path },
      error: null,
    });
    mocks.sign.mockRejectedValue(new Error("secret"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});

it("signs a downloadable MP4 with a server-chosen filename", async () => {
  mocks.result.mockResolvedValue({ data: { status: "succeeded", video_url: path }, error: null });
  mocks.sign.mockResolvedValue({
    data: { signedUrl: "https://test.supabase.co/signed-video" },
    error: null,
  });
  expect((await request("?download=1&filename=unsafe")).status).toBe(302);
  expect(mocks.sign).toHaveBeenCalledWith(path, 900, { download: `creative-director-${id}.mp4` });
});
