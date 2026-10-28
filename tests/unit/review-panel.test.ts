import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/campaigns/review-actions", () => ({ enqueueReview: async () => ({}) }));
import { ReviewPanel } from "@/components/review-panel";
import type { Review, ReviewTask } from "@/types/generation";
const review: Review = {
  id: "test",
  generation_id: "generation",
  video_id: "video",
  source_sha256: "a".repeat(64),
  hook_strength: 8,
  clarity: 8,
  audience_relevance: 8,
  cta_strength: 8,
  overall_score: 8,
  quality_threshold: 8,
  problems: [],
  suggestions: ["Make the opening more concrete."],
  input_manifest: { transcoded: false },
  provider: "test-only",
  model: "fixture",
  prompt_version: "test-only",
  created_at: new Date().toISOString(),
};
const task: ReviewTask = {
  generation_id: "generation",
  status: "failed",
  attempts: 3,
  retry_count: 0,
  error_message: "The provider is unavailable.",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const render = (props: Partial<Parameters<typeof ReviewPanel>[0]>) =>
  renderToStaticMarkup(
    createElement(ReviewPanel, {
      generationId: "generation",
      review: null,
      task: null,
      canStart: true,
      ...props,
    }),
  );
describe("review results panel", () => {
  it("shows dimension scores and feedback without treating a passing score as approval", () => {
    const html = render({ review });
    expect(html).toContain("Meets the AI quality threshold");
    expect(html).toContain("Not approved");
    expect(html).toContain('aria-label="Hook strength"');
    expect(html).toContain("Make the opening more concrete.");
    expect(html).not.toContain("Retry review");
  });
  it("shows revision feedback and discloses compressed review evidence", () => {
    const html = render({
      review: {
        ...review,
        quality_threshold: 8.5,
        problems: ["Opening copy is generic."],
        input_manifest: { transcoded: true },
      },
    });
    expect(html).toContain("Below the AI quality threshold");
    expect(html).toContain("Opening copy is generic.");
    expect(html).toContain("compressed audiovisual copy");
  });
  it("keeps a below-threshold assessment visible after human approval", () => {
    const html = render({ review: { ...review, quality_threshold: 8.5 }, approved: true });
    expect(html).toContain("Below the AI quality threshold");
    expect(html).toContain("Approved by you");
    expect(html).not.toContain("Not approved");
    expect(html).toContain('value="8"');
  });
  it("never invents a score while waiting and offers a retry for terminal failure", () => {
    expect(render({ task: { ...task, status: "pending" }, canStart: false })).toContain(
      "Review retry scheduled",
    );
    const html = render({ task });
    expect(html).toContain("Retry review");
    expect(html).not.toContain("/ 10");
  });
  it("removes the retry action once the two-restart budget is exhausted", () => {
    const html = render({ task: { ...task, retry_count: 2 } });
    expect(html).not.toContain("Retry review");
    expect(html).toContain("Review retry limit reached");
  });
});
