"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import type { ActionState } from "@/types/campaign";
export async function enqueueRender(generationId: string): Promise<ActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before rendering video." };
  if (!z.uuid().safeParse(generationId).success) return { message: "Invalid generation request." };
  const { supabase } = await requireUser();
  try {
    const { error } = await supabase.rpc("enqueue_render", { p_generation_id: generationId });
    if (error)
      return {
        message:
          error.code === "55000"
            ? "Images and voice must finish first. Failed renders can restart twice; completed videos are preserved."
            : error.code === "P0001"
              ? "Three campaigns are already active. Wait for one to finish."
              : "Could not queue the render. Check your connection and Phase 5 migrations.",
      };
  } catch {
    return { message: "The render request could not be confirmed. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return {};
}
