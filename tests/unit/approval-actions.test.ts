import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  auth: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: mocks.config }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { approveGeneration } from "@/app/campaigns/approval-actions";
const id = "10000000-0000-4000-8000-000000000001",
  video = "10000000-0000-4000-8000-000000000002",
  review = "10000000-0000-4000-8000-000000000003";
function form() {
  const data = new FormData();
  data.set("confirmed", "on");
  data.set("note", "Reviewed by me");
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({});
  mocks.auth.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});
describe("approval server action", () => {
  it("uses the authenticated RPC and binds the exact version, video and review", async () => {
    const data = form();
    data.set("acceptLowScore", "on");
    data.set("approved_by", "forged");
    data.set("score", "10");
    expect(await approveGeneration(id, video, review, {}, data)).toEqual({ success: true });
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("approve_generation", {
      p_generation_id: id,
      p_video_id: video,
      p_review_id: review,
      p_confirmed: true,
      p_accept_low_score: true,
      p_note: "Reviewed by me",
    });
    expect(mocks.refresh).toHaveBeenCalledWith("/", "layout");
  });
  it("rejects invalid identifiers, missing acknowledgment and oversized notes", async () => {
    expect((await approveGeneration("invalid", video, review, {}, form())).message).toBeTruthy();
    const missing = form();
    missing.delete("confirmed");
    expect((await approveGeneration(id, video, review, {}, missing)).message).toBeTruthy();
    const large = form();
    large.set("note", "x".repeat(2001));
    expect((await approveGeneration(id, video, review, {}, large)).message).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires configuration and an authenticated session", async () => {
    mocks.config.mockReturnValue(null);
    expect((await approveGeneration(id, video, review, {}, form())).message).toContain(
      "Connect Supabase",
    );
    mocks.config.mockReturnValue({});
    mocks.auth.mockRejectedValue(new Error("login redirect"));
    await expect(approveGeneration(id, video, review, {}, form())).rejects.toThrow(
      "login redirect",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["42501", "55000", "22023", "unexpected"])("returns safe errors for %s", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "secret diagnostics" } });
    const result = await approveGeneration(id, video, review, {}, form());
    expect(result.success).toBeUndefined();
    expect(result.message).toBeTruthy();
    expect(result.message).not.toContain("secret");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("handles a lost response without claiming success or retrying another version", async () => {
    mocks.rpc.mockRejectedValue(new Error("network secret"));
    expect((await approveGeneration(id, video, review, {}, form())).message).toContain(
      "Retry this version",
    );
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
