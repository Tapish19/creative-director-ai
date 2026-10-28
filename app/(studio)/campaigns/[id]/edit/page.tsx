import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getProject } from "@/lib/projects/repository";
import { CampaignForm } from "@/components/campaign-form";

export const metadata = { title: "Edit campaign" };

export default async function EditCampaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (project.status !== "draft")
    return (
      <>
        <h1>This brief is locked</h1>
        <p>Generated campaigns retain their original brief for reproducibility.</p>
        <Link className="text-link" href={`/campaigns/${id}`}>
          Back to campaign
        </Link>
      </>
    );
  return (
    <>
      <Link href={`/campaigns/${id}`} className="back-link">
        <ArrowLeft size={15} />
        Back to campaign
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">REFINE YOUR DIRECTION</div>
          <h1>
            A little fine-tuning<span className="accent-dot">.</span>
          </h1>
          <p>Update the details before your story takes shape.</p>
        </div>
      </div>
      <CampaignForm project={project} canSave />
    </>
  );
}
