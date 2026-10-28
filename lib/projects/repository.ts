import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { ProjectStatus } from "@/types/campaign";

export const PAGE_SIZE = 9;

export async function listProjects({
  search,
  page,
  status,
}: {
  search: string;
  page: number;
  status?: ProjectStatus;
}) {
  const { supabase, user } = await requireUser();
  let query = supabase.from("projects").select("*", { count: "exact" }).eq("user_id", user.id);
  if (search) query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error)
    throw new Error("Campaigns could not be loaded. Check your database migration and connection.");
  return { projects: data ?? [], count: count ?? 0 };
}

export async function getProject(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error("The campaign could not be loaded.");
  if (!data) notFound();
  return data;
}
