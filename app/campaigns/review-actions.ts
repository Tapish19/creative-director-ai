"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import type { ActionState } from "@/types/campaign";
export async function enqueueReview(generationId: string): Promise<ActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before reviewing video." };
  if (!z.uuid().safeParse(generationId).success) return { message: "Invalid generation request." };
  const { supabase } = await requireUser();
  try {
    const { error } = await supabase.rpc("enqueue_review", { p_generation_id: generationId });
    if (error)
      return {
        message:
          error.code === "55000"
            ? "The video must finish first. Failed reviews can restart twice; completed scores are preserved."
            : error.code === "P0001"
              ? "Three campaigns are already active. Wait for one to finish."
              : "Could not queue the review. Check your connection and Phase 6 migrations.",
      };
  } catch {
    return { message: "The review request could not be confirmed. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return {};
}
