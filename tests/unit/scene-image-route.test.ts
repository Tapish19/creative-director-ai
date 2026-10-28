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
import { GET } from "@/app/api/scenes/[id]/image/route";
const owner = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const request = () =>
  GET(new Request(`http://localhost/api/scenes/${id}/image`), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ url: "https://test.supabase.co", key: "test" });
  mocks.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.result });
});
describe("private scene preview", () => {
  it("authenticates before looking up or signing a scene", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await request()).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { status: "succeeded", image_url: "other-owner/private.jpg" },
    { status: "pending", image_url: `${owner}/image.jpg` },
  ])("does not sign hidden, foreign or unfinished assets %#", async (data) => {
    mocks.result.mockResolvedValue({ data, error: null });
    expect((await request()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("issues a short-lived redirect only after ownership checks", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", image_url: `${owner}/image.jpg` },
      error: null,
    });
    mocks.sign.mockResolvedValue({
      data: { signedUrl: "https://test.supabase.co/storage/signed" },
      error: null,
    });
    const result = await request();
    expect(result.status).toBe(302);
    expect(mocks.sign).toHaveBeenCalledWith(`${owner}/image.jpg`, 60);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("Location")).toBe("https://test.supabase.co/storage/signed");
  });
  it("sanitizes storage errors", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "succeeded", image_url: `${owner}/image.jpg` },
      error: null,
    });
    mocks.sign.mockRejectedValue(new Error("secret-service-role-token"));
    const result = await request();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("secret");
  });
});
