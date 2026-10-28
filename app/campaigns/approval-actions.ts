"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";

export type ApprovalActionState = { message?: string; success?: boolean };
const requestSchema = z.object({
  generationId: z.uuid(),
  videoId: z.uuid(),
  reviewId: z.uuid(),
  confirmed: z.literal("on"),
  acceptLowScore: z.enum(["on", "off"]),
  note: z.string().trim().max(2000),
});

export async function approveGeneration(
  generationId: string,
  videoId: string,
  reviewId: string,
  _previous: ApprovalActionState,
  form: FormData,
): Promise<ApprovalActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before approving a video." };
  const { supabase } = await requireUser();
  const parsed = requestSchema.safeParse({
    generationId,
    videoId,
    reviewId,
    confirmed: form.get("confirmed"),
    acceptLowScore: form.get("acceptLowScore") ?? "off",
    note: form.get("note") ?? "",
  });
  if (!parsed.success)
    return {
      message: "Confirm that you reviewed this version. Notes must be 2,000 characters or fewer.",
    };
  try {
    const { data, error } = await supabase.rpc("approve_generation", {
      p_generation_id: generationId,
      p_video_id: videoId,
      p_review_id: reviewId,
      p_confirmed: true,
      p_accept_low_score: parsed.data.acceptLowScore === "on",
      p_note: parsed.data.note,
    });
    if (error || data !== generationId)
      return {
        message:
          error?.code === "42501"
            ? "This generation is unavailable."
            : error?.code === "55000"
              ? "Approval is unavailable while processing or if the video or review changed. Reload the version and try again."
              : error?.code === "22023"
                ? "Confirm your review and acknowledge the below-threshold score if shown."
                : "Could not save approval. Check your connection and apply the Phase 8 migration.",
      };
  } catch {
    return {
      message:
        "Approval could not be confirmed. Retry this version; an existing approval will not be duplicated.",
    };
  }
  revalidatePath("/", "layout");
  return { success: true };
}
