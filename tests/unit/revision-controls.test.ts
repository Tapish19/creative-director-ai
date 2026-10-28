import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/campaigns/revision-actions", () => ({ createRevision: async () => ({}) }));
import { RevisionControls, ScriptEditor, RegenerateScene } from "@/components/revision-controls";
import { testScript } from "../fixtures/creative";
describe("versioned editing controls", () => {
  it("offers feedback-based regeneration and script editing with explicit version preservation", () => {
    const html = renderToStaticMarkup(
      createElement(RevisionControls, {
        generationId: "generation",
        feedbackKey: "key",
        editKey: "edit-key",
        script: testScript,
        duration: 15,
        hasReview: true,
      }),
    );
    expect(html).toContain("saved review feedback");
    expect(html).toContain("keeps the current version intact");
    expect(html).toContain("Edit script");
    expect(html).toContain("Regenerate");
  });
  it("shows scene fields and explains media reuse and disabled automatic rewrites for edits", () => {
    const html = renderToStaticMarkup(
      createElement(ScriptEditor, {
        generationId: "generation",
        requestKey: "key",
        script: testScript,
        duration: 15,
      }),
    );
    expect(html).toContain("Narration");
    expect(html).toContain("Visual prompt");
    expect(html).toContain("Save as new version");
    expect(html).toContain("automatic rewrites are off");
    expect(html).toContain("15 / 15 seconds");
  });
  it("makes the scope of single-scene regeneration explicit", () => {
    const html = renderToStaticMarkup(
      createElement(RegenerateScene, {
        generationId: "generation",
        requestKey: "key",
        sceneId: "scene",
        sceneNumber: 2,
        prompt: testScript.scenes[1].visualPrompt,
      }),
    );
    expect(html).toContain("Regenerate scene 2");
    expect(html).toContain("Other images and unchanged narration are reused");
    expect(html).toContain(testScript.scenes[1].visualPrompt);
  });
});
