import Link from "next/link";
import { KeyRound, ArrowRight } from "lucide-react";

export function SetupNotice() {
  return (
    <div className="setup-notice" role="status">
      <KeyRound size={19} />
      <div>
        <strong>Connect your workspace</strong>
        <p>
          Supabase credentials are needed to sign in and save campaigns. Nothing is being simulated.
        </p>
      </div>
      <Link href="/settings">
        Setup details <ArrowRight size={15} />
      </Link>
    </div>
  );
}
