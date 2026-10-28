import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/campaign-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/env";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "New campaign" };

export default async function NewCampaign({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string }>;
}) {
  const configured = !!getSupabaseConfig();
  if (configured) await requireUser();
  const params = await searchParams;
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        All campaigns
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE CREATIVE DIRECTION</div>
          <h1>
            Start with a good brief<span className="accent-dot">.</span>
          </h1>
          <p>Tell us what you’re making. Give your story a direction.</p>
        </div>
        <span className="draft-chip">NEW CAMPAIGN</span>
      </div>
      {!configured && <SetupNotice />}
      <CampaignForm canSave={configured} useSample={params.sample === "myhotelline"} />
    </>
  );
}
