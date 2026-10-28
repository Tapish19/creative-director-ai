"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/env";
import type { ActionState } from "@/types/campaign";

export async function startTextGeneration(
  projectId: string,
  requestKey: string,
): Promise<ActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase to save and generate a campaign." };
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(requestKey).success)
    return { message: "Invalid generation request. Refresh the page and try again." };
  const { supabase } = await requireUser();
  let generationId: string;
  try {
    const { data, error } = await supabase.rpc("enqueue_text_generation", {
      p_project_id: projectId,
      p_request_key: requestKey,
    });
    if (error || !data) {
      if (error?.code === "P0001")
        return {
          message:
            "Generation limit reached: at most 3 active campaigns and 20 new generations per account in 24 hours.",
        };
      return {
        message:
          "Could not queue the generation. Check your connection and that the Phase 2 database migrations have been applied.",
      };
    }
    generationId = data;
  } catch {
    return {
      message:
        "The generation could not be confirmed. Try again; the same request will not create duplicate jobs.",
    };
  }
  revalidatePath("/");
  revalidatePath(`/campaigns/${projectId}`);
  redirect(`/campaigns/${projectId}/generations/${generationId}`);
}
