"use client";

import { RefreshCw } from "lucide-react";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="panel error-panel" role="alert">
      <h1>Your workspace couldn’t load.</h1>
      <p>
        Please check your connection and Supabase configuration, then try again. Your saved
        campaigns are not changed.
      </p>
      <button className="button primary" onClick={reset}>
        <RefreshCw size={16} />
        Try again
      </button>
    </section>
  );
}
