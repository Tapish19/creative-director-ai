"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";
import type { ActionState } from "@/types/campaign";

export async function authenticate(
  mode: "signin" | "signup",
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!getSupabaseConfig()) return { message: "Connect Supabase before signing in." };
  const parsed = authSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  try {
    const supabase = await createClient();
    if (mode === "signup") {
      const requestHeaders = await headers();
      const origin = requestHeaders.get("origin");
      if (!origin) return { message: "Open the app in your browser and try again." };
      const { error, data } = await supabase.auth.signUp({
        ...parsed.data,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error)
        return { message: "Could not create your account. Check your details or try again later." };
      if (!data.session)
        return { message: "Check your email to confirm your account, then sign in." };
    } else {
      const { error } = await supabase.auth.signInWithPassword(parsed.data);
      if (error)
        return {
          message:
            "Sign-in failed. Check your email and password, confirm your email, or try again later.",
        };
    }
  } catch {
    return { message: "Authentication is temporarily unavailable. Please try again." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) redirect("/login?error=signout");
  redirect("/login");
}
