import { sampleCampaign } from "@/lib/sample-campaign";
import type { CreativePlan, CreativeScript } from "@/types/creative";

// Controlled provider responses for tests only. No application route imports these fixtures.
export const testBrief = { ...sampleCampaign };
export const testPlan: CreativePlan = {
  targetAudience: "Independent hotel owners",
  painPoints: ["Booking and billing spread across manual processes"],
  campaignAngle: "More time for hospitality",
  hook: "Still juggling bookings and bills?",
  cta: "Book a free product demo",
  scenePlan: [
    { purpose: "Introduce the manual administration problem", duration: 5 },
    { purpose: "Show one cloud platform for hotel operations", duration: 5 },
    { purpose: "Invite viewers to book a free demo", duration: 5 },
  ],
};
export const testScript: CreativeScript = {
  script:
    "Scene 1: Manual hotel administration. Scene 2: A single cloud platform. Scene 3: Invite hotel owners to book a demo.",
  voiceover:
    "Still juggling bookings and bills? Bring hotel operations together with MyHotelLine. Book your free product demo today.",
  scenes: [
    {
      sceneNumber: 1,
      duration: 5,
      voiceover: "Still juggling bookings and bills?",
      caption: "Too much admin?",
      visualPrompt:
        "Vertical 9:16 still of an independent hotel owner at a reception desk with booking papers, natural light, no text.",
    },
    {
      sceneNumber: 2,
      duration: 5,
      voiceover: "Bring hotel operations together with MyHotelLine.",
      caption: "One cloud platform",
      visualPrompt:
        "Vertical 9:16 still of the same hotel owner using a laptop at the reception desk, soft daylight, no readable text.",
    },
    {
      sceneNumber: 3,
      duration: 5,
      voiceover: "Book your free product demo today.",
      caption: "Book a free demo",
      visualPrompt:
        "Vertical 9:16 still of the same hotel owner welcoming a guest in a bright lobby, natural light, no logos or text.",
    },
  ],
};

export function geminiResponse(
  data: unknown,
  options: { finishReason?: string; model?: string } = {},
) {
  return Response.json({
    candidates: [
      {
        finishReason: options.finishReason ?? "STOP",
        content: { parts: [{ text: JSON.stringify(data) }] },
      },
    ],
    modelVersion: options.model ?? "gemini-test-version",
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 240 },
  });
}
