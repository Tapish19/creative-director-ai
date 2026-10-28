import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/campaigns/approval-actions", () => ({ approveGeneration: async () => ({}) }));
import { ApprovalPanel } from "@/components/approval-panel";
const base: ComponentProps<typeof ApprovalPanel> = {
  generationId: "generation",
  version: 2,
  videoId: "video",
  reviewId: "review",
  score: 8,
  threshold: 8,
  approval: null,
  eligible: true,
  campaignActive: false,
};
function render(overrides: Partial<typeof base> = {}) {
  return renderToStaticMarkup(createElement(ApprovalPanel, { ...base, ...overrides }));
}
describe("human approval controls", () => {
  it("requires viewing acknowledgment and identifies the version", () => {
    const html = render();
    expect(html).toContain("Approve version 2");
    expect(html.match(/<input[^>]*name="confirmed"[^>]*>/)?.[0]).toContain('required=""');
    expect(html).not.toContain('name="acceptLowScore"');
    expect(html).toContain("does not publish");
  });
  it("requires a separate acknowledgment for below-threshold approval", () => {
    const html = render({ score: 6.9 });
    expect(html.match(/<input[^>]*name="acceptLowScore"[^>]*>/)?.[0]).toContain('required=""');
    expect(html).toContain("6.9 / 10");
  });
  it("does not offer approval during processing or without an eligible review", () => {
    expect(render({ campaignActive: true })).not.toContain("<form");
    expect(render({ eligible: false })).not.toContain("<form");
  });
  it("shows the permanent decision, escapes notes and offers the exact MP4", () => {
    const html = render({
      approval: {
        generation_id: "generation",
        video_id: "video",
        review_id: "review",
        video_path: "private.mp4",
        source_sha256: "a".repeat(64),
        approved_by: "owner",
        approved_at: "2026-10-27T10:00:00Z",
        overall_score: 6.9,
        quality_threshold: 8,
        accepted_below_threshold: true,
        note: "<script>unsafe</script>",
      },
    });
    expect(html).toContain("Version 2 approved");
    expect(html).toContain("acknowledgment of the AI score");
    expect(html).toContain("/api/generations/generation/video?download=1");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<script>unsafe");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a".repeat(64));
  });
});
