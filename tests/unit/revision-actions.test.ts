import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  auth: vi.fn(),
  read: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: mocks.config }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { createRevision } from "@/app/campaigns/revision-actions";
import { testScript } from "../fixtures/creative";
const parent = "10000000-0000-4000-8000-000000000001",
  key = "10000000-0000-4000-8000-000000000002",
  child = "10000000-0000-4000-8000-000000000003";
function submit(payload: unknown) {
  const form = new FormData();
  form.set("payload", typeof payload === "string" ? payload : JSON.stringify(payload));
  return createRevision(parent, key, {}, form);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ url: "https://test.supabase.co", key: "test-only" });
  mocks.auth.mockResolvedValue({
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }),
      rpc: mocks.rpc,
    },
  });
  mocks.read.mockResolvedValue({
    data: { project_id: "project", brief_snapshot: { duration: 15 } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: child, error: null });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`redirect:${url}`);
  });
});
describe("authenticated revision actions", () => {
  it("uses the same request key and redirects only after confirmed queueing", async () => {
    await expect(submit({ mode: "feedback", instruction: "Improve the hook." })).rejects.toThrow(
      `redirect:/campaigns/project/generations/${child}`,
    );
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "enqueue_revision",
      expect.objectContaining({
        p_parent_id: parent,
        p_request_key: key,
        p_mode: "feedback",
        p_instruction: "Improve the hook.",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledWith("/", "layout");
  });
  it("assembles edited narration server-side using the stored duration", async () => {
    await expect(submit({ mode: "script_edit", scenes: testScript.scenes })).rejects.toThrow(
      "redirect:",
    );
    expect(mocks.rpc.mock.calls[0][1].p_script).toMatchObject({
      voiceover: testScript.voiceover,
      scenes: testScript.scenes,
    });
    mocks.rpc.mockClear();
    mocks.read.mockResolvedValue({
      data: { project_id: "project", brief_snapshot: { duration: 30 } },
      error: null,
    });
    const result = await submit({ mode: "script_edit", scenes: testScript.scenes });
    expect(result.issues?.join(" ")).toContain("30 seconds");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects forged automatic requests and malformed payloads before enqueue", async () => {
    for (const payload of [
      { mode: "automatic" },
      "{invalid",
      { mode: "scene", sceneId: "foreign", visualPrompt: "short" },
      "x".repeat(65537),
    ]) {
      expect((await submit(payload)).message).toBeTruthy();
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not enqueue a generation hidden by ownership policies", async () => {
    mocks.read.mockResolvedValue({ data: null, error: null });
    expect((await submit({ mode: "feedback", instruction: "" })).message).toContain("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["55000", "P0001", "22023", "database_error"])(
    "returns safe actionable errors for %s",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code, message: "private database diagnostics" },
      });
      const result = await submit({ mode: "feedback", instruction: "" });
      expect(result.message).toBeTruthy();
      expect(result.message).not.toContain("private database");
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
  it("never turns a lost enqueue response into a fresh request", async () => {
    mocks.rpc.mockRejectedValue(new Error("secret"));
    const result = await submit({ mode: "feedback", instruction: "" });
    expect(result.message).toContain("same request");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
