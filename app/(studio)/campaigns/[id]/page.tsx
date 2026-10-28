import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Clock3, Pencil, Sparkles, Target, Users } from "lucide-react";
import { getProject } from "@/lib/projects/repository";
import { StatusBadge } from "@/components/status-badge";
import { Pipeline } from "@/components/pipeline";
import { DeleteCampaign } from "@/components/delete-campaign";
import { randomUUID } from "node:crypto";
import { listGenerations, getActiveGeneration } from "@/lib/generations/repository";
import { GenerateButton } from "@/components/generate-button";

export const metadata = { title: "Campaign workspace" };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  const [generations, activeVersion] = await Promise.all([
    listGenerations(id),
    getActiveGeneration(id),
  ]);
  const latest = generations[0];
  const running = !!activeVersion;
  const { saved } = await searchParams;
  return (
    <>
      <Link href="/" className="back-link">
        <ArrowLeft size={15} />
        All campaigns
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAMPAIGN WORKSPACE</div>
          <h1 className="campaign-page-title">{project.name}</h1>
          <p>
            {project.product_name} <span className="text-separator">/</span> {project.duration}
            -second vertical social ad
          </p>
        </div>
        <StatusBadge status={project.status} />
      </div>
      {saved === "1" && (
        <div className="success-notice" role="status">
          Your campaign brief has been saved.
        </div>
      )}
      <div className="campaign-detail-layout">
        <div>
          <section className="panel summary-panel">
            <div className="panel-heading">
              <div>
                <span className="section-number">01</span>
                <h2>The brief</h2>
              </div>
              {project.status === "draft" && (
                <Link href={`/campaigns/${id}/edit`} className="text-link">
                  <Pencil size={14} />
                  Edit brief
                </Link>
              )}
            </div>
            <p className="brief-description">{project.description}</p>
            <dl className="brief-facts">
              <div>
                <dt>
                  <Users size={15} />
                  Audience
                </dt>
                <dd>{project.target_audience}</dd>
              </div>
              <div>
                <dt>
                  <Sparkles size={15} />
                  Tone
                </dt>
                <dd>{project.tone}</dd>
              </div>
              <div>
                <dt>
                  <Target size={15} />
                  Goal
                </dt>
                <dd>{project.goal}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 size={15} />
                  Duration
                </dt>
                <dd>{project.duration} seconds</dd>
              </div>
              {project.website_url && (
                <div className="full">
                  <dt>Website reference</dt>
                  <dd>
                    <a
                      href={project.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link"
                    >
                      {project.website_url}
                      <ArrowUpRight size={14} />
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>
          {!latest && <Pipeline />}
          {project.status === "draft" && (
            <div className="danger-zone">
              <DeleteCampaign id={id} />
            </div>
          )}
        </div>
        <aside className="panel next-step-panel">
          <span className="eyebrow">UP NEXT</span>
          <div className="next-step-icon">
            <Sparkles size={25} />
          </div>
          <h2>{latest ? "Follow your creative." : "A brief with potential."}</h2>
          <p>
            The planner establishes your direction. The script writer turns it into a complete
            script, narration, captions and a scene-by-scene storyboard.
          </p>
          {running ? (
            <Link
              className="button primary"
              href={`/campaigns/${id}/generations/${activeVersion!.id}`}
            >
              View generation progress
            </Link>
          ) : (
            <GenerateButton
              projectId={id}
              requestKey={randomUUID()}
              label={latest ? "Generate a new version" : "Generate storyboard"}
            />
          )}
          <p className="phase-note">
            Generate a script, illustrated scenes, spoken narration, a finished MP4 and an AI
            quality review. Review and approve the version you want to use. Your creative continues
            processing in the background.
          </p>
          <div className="version-empty">
            <h3>Recent versions</h3>
            {generations.length ? (
              <nav aria-label="Generation versions">
                {generations.map((generation) => (
                  <Link
                    className="version-link"
                    key={generation.id}
                    href={`/campaigns/${id}/generations/${generation.id}`}
                  >
                    <span>Version {generation.version}</span>
                    <small>
                      {generation.overall_score !== null
                        ? `Score ${Number(generation.overall_score).toFixed(1)} · `
                        : ""}
                      {generation.status.replaceAll("_", " ")}
                    </small>
                  </Link>
                ))}
              </nav>
            ) : (
              <p>Versions will appear after your first generation.</p>
            )}
            {generations.length === 50 && <p>Showing the latest 50 versions.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
