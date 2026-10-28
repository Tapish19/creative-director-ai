"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import type { ActionState } from "@/types/campaign";
export async function enqueueVoice(generationId: string): Promise<ActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before generating voiceover." };
  if (!z.uuid().safeParse(generationId).success) return { message: "Invalid generation request." };
  const { supabase } = await requireUser();
  try {
    const { error } = await supabase.rpc("enqueue_voice", { p_generation_id: generationId });
    if (error)
      return {
        message:
          error.code === "55000"
            ? "Complete the images first. Failed voiceovers can be restarted twice; completed voiceovers are preserved."
            : error.code === "P0001"
              ? "Three campaigns are already active. Wait for one to finish."
              : "Could not queue voiceover. Check your connection and Phase 4 migrations.",
      };
  } catch {
    return { message: "The voice request could not be confirmed. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return {};
}
