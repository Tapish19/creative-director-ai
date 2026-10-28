"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import type { ActionState } from "@/types/campaign";

export async function enqueueImages(generationId: string, sceneId?: string): Promise<ActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before generating images." };
  if (
    !z.uuid().safeParse(generationId).success ||
    (sceneId !== undefined && !z.uuid().safeParse(sceneId).success)
  )
    return { message: "Invalid scene request. Refresh the page and try again." };
  const { supabase } = await requireUser();
  try {
    const { error } = await supabase.rpc("enqueue_scene_images", {
      p_generation_id: generationId,
      ...(sceneId ? { p_scene_id: sceneId } : {}),
    });
    if (error)
      return {
        message:
          error.code === "55000"
            ? "Wait for active images to finish. Only failed scenes can be retried, up to twice."
            : error.code === "P0001"
              ? "Three campaigns are already active. Wait for one to finish."
              : "Could not queue images. Check your connection and apply the Phase 3 migrations.",
      };
  } catch {
    return { message: "The image request could not be confirmed. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return {};
}
