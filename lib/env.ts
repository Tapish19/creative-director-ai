import "server-only";
import { z } from "zod";

const supabaseSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  key: z.string().min(20),
});

export function getSupabaseConfig() {
  const parsed = supabaseSchema.safeParse({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  return parsed.success ? parsed.data : null;
}
