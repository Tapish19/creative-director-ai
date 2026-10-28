import { LogOut, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { getSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export async function Account() {
  if (!getSupabaseConfig())
    return (
      <Link href="/settings" className="account-link" aria-label="Connect your workspace">
        <span className="avatar">Y</span>
        <span>
          Your workspace<small>Connect Supabase to begin</small>
        </span>
        <ArrowUpRight size={16} />
      </Link>
    );
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return (
      <Link href="/login" className="account-link">
        <span className="avatar">Y</span>Sign in
        <ArrowUpRight size={16} />
      </Link>
    );
  return (
    <div className="account-link">
      <span className="avatar">{(user.email ?? "Y")[0].toUpperCase()}</span>
      <span className="account-email">
        {user.email}
        <small>Private workspace</small>
      </span>
      <form action={signOut}>
        <button className="icon-button" aria-label="Sign out">
          <LogOut size={17} />
        </button>
      </form>
    </div>
  );
}
