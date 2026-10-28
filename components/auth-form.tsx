"use client";

import { useActionState, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { authenticate } from "@/app/auth/actions";
import type { ActionState } from "@/types/campaign";

export function AuthForm({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, action, pending] = useActionState(authenticate.bind(null, mode), {} as ActionState);
  return (
    <>
      <div className="auth-tabs">
        <button
          aria-pressed={mode === "signin"}
          disabled={pending}
          onClick={() => setMode("signin")}
        >
          Sign in
        </button>
        <button
          aria-pressed={mode === "signup"}
          disabled={pending}
          onClick={() => setMode("signup")}
        >
          Create account
        </button>
      </div>
      <form action={action} className="auth-form">
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            type="email"
            name="email"
            id="email"
            autoComplete="email"
            placeholder="you@company.com"
            maxLength={254}
            required
            aria-invalid={!!state.fieldErrors?.email}
            aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          />
          {state.fieldErrors?.email && (
            <p className="field-error" id="email-error">
              {state.fieldErrors.email[0]}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            name="password"
            id="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={8}
            maxLength={128}
            required
            aria-invalid={!!state.fieldErrors?.password}
            aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
          />
          {state.fieldErrors?.password && (
            <p className="field-error" id="password-error">
              {state.fieldErrors.password[0]}
            </p>
          )}
        </div>
        {state.message && (
          <p className="form-message" role="status">
            {state.message}
          </p>
        )}
        <button className="button primary" disabled={!configured || pending}>
          {pending ? <LoaderCircle className="spin" size={16} /> : null}
          {mode === "signup" ? "Create account" : "Sign in"}
          <ArrowRight size={16} />
        </button>
        <p className="auth-privacy">Your campaigns are private to your account.</p>
      </form>
    </>
  );
}
