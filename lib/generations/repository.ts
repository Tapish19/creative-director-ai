import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { GenerationDetail } from "@/types/generation";

export async function listGenerations(projectId: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("generations")
    .select(
      "id, version, status, created_at, updated_at, overall_score, parent_generation_id, revision_mode, automatic_revision",
    )
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(50);
  if (error) throw new Error("Generation history could not be loaded.");
  return data ?? [];
}

export async function getActiveGeneration(projectId: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("generations")
    .select("id,version,updated_at")
    .eq("project_id", projectId)
    .in("status", ["queued", "running", "reviewing"])
    .maybeSingle();
  if (error) throw new Error("Active generation could not be loaded.");
  return data;
}

export async function getGeneration(
  projectId: string,
  generationId: string,
): Promise<GenerationDetail> {
  if (!z.uuid().safeParse(generationId).success) notFound();
  const { supabase } = await requireUser();
  const { data: generation, error } = await supabase
    .from("generations")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", generationId)
    .maybeSingle();
  if (error) throw new Error("Generation could not be loaded.");
  if (!generation) notFound();
  const [runs, scenes, jobs, voice, video, review, reviewTask, approval] = await Promise.all([
    supabase.from("agent_runs").select("*").eq("generation_id", generationId).order("created_at"),
    supabase.from("scenes").select("*").eq("generation_id", generationId).order("scene_number"),
    supabase
      .from("jobs")
      .select("id,status,attempts,max_attempts,available_at,last_error,updated_at")
      .eq("generation_id", generationId)
      .eq("kind", "plan_and_write")
      .maybeSingle(),
    supabase.from("voiceovers").select("*").eq("generation_id", generationId).maybeSingle(),
    supabase.from("videos").select("*").eq("generation_id", generationId).maybeSingle(),
    supabase.from("reviews").select("*").eq("generation_id", generationId).maybeSingle(),
    supabase.from("review_tasks").select("*").eq("generation_id", generationId).maybeSingle(),
    supabase
      .from("generation_approvals")
      .select("*")
      .eq("generation_id", generationId)
      .maybeSingle(),
  ]);
  if (
    runs.error ||
    scenes.error ||
    jobs.error ||
    voice.error ||
    video.error ||
    review.error ||
    reviewTask.error ||
    approval.error
  )
    throw new Error("Generation details could not be loaded.");
  return {
    generation,
    runs: runs.data ?? [],
    scenes: scenes.data ?? [],
    job: jobs.data,
    voiceover: voice.data,
    video: video.data,
    review: review.data,
    reviewTask: reviewTask.data,
    approval: approval.data,
  };
}
