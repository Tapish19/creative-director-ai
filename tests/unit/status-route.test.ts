import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  user: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  result: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: () => ({ select: mocks.select }),
  }),
}));
import { GET } from "@/app/api/generations/[id]/status/route";

const id = "10000000-0000-4000-8000-000000000001";
const request = () =>
  GET(new Request(`http://localhost/api/generations/${id}/status`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ url: "https://test.supabase.co", key: "test" });
  mocks.user.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.result });
});

describe("generation polling endpoint", () => {
  it("requires authenticated sessions before querying generation data", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await request()).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("returns 404 for a generation hidden by RLS", async () => {
    mocks.result.mockResolvedValue({ data: null, error: null });
    expect((await request()).status).toBe(404);
  });

  it("returns only the public polling state, never a worker lease token", async () => {
    mocks.result.mockResolvedValue({
      data: { status: "running", updated_at: "revision", locked_by: "private-lease" },
      error: null,
    });
    const response = await request();
    expect(await response.json()).toEqual({ revision: "revision", active: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("stops polling when the script is ready and sanitizes database failures", async () => {
    mocks.result
      .mockResolvedValueOnce({ data: { status: "script_ready", updated_at: "done" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "secret upstream diagnostics" } });
    expect(await (await request()).json()).toEqual({ revision: "done", active: false });
    const failed = await request();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret upstream");
  });
});

it("keeps polling while audiovisual review is active", async () => {
  mocks.result.mockResolvedValue({
    data: { status: "reviewing", updated_at: "review-revision" },
    error: null,
  });
  expect(await (await request()).json()).toEqual({ revision: "review-revision", active: true });
});
