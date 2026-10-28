import Link from "next/link";
import { Aperture, ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = !!getSupabaseConfig();
  if (configured) {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) redirect("/");
  }
  const { error } = await searchParams;
  return (
    <main id="main" className="login-page">
      <Link href="/" className="back-link">
        <ArrowLeft size={15} />
        Back to studio
      </Link>
      <div className="login-card">
        <div className="login-brand">
          <Aperture size={31} />
        </div>
        <div className="eyebrow">CREATIVE DIRECTOR AI</div>
        <h1>
          Welcome to your studio<span className="accent-dot">.</span>
        </h1>
        <p>Make a little room for your next big idea.</p>
        {!configured && (
          <p className="form-message">
            Supabase needs to be configured before you can sign in.{" "}
            <Link href="/settings">View setup details</Link>.
          </p>
        )}
        {error && (
          <p className="error-notice" role="alert">
            {error === "signout"
              ? "Sign-out failed. Please try again."
              : "The confirmation link could not be verified. Try signing in or request a new confirmation from Supabase."}
          </p>
        )}
        <AuthForm configured={configured} />
      </div>
      <p className="login-footer">A thoughtful workflow. A story that’s yours.</p>
    </main>
  );
}
