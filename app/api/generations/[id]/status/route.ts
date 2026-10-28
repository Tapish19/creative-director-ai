import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return json({ error: "Invalid generation identifier." }, 400);
  if (!getSupabaseConfig()) return json({ error: "Workspace is not configured." }, 503);
  try {
    const client = await createClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return json({ error: "Sign in to view this generation." }, 401);
    // RLS scopes the UUID lookup to this authenticated user; no worker token is returned.
    const { data, error } = await client
      .from("generations")
      .select("status,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return json({ error: "Could not refresh generation status." }, 503);
    if (!data) return json({ error: "Generation not found." }, 404);
    return json({
      revision: data.updated_at,
      active: data.status === "queued" || data.status === "running" || data.status === "reviewing",
    });
  } catch {
    return json({ error: "Could not refresh generation status." }, 503);
  }
}
