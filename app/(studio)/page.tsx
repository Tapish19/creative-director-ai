import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Clapperboard,
  Plus,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { getSupabaseConfig } from "@/lib/env";
import { listProjects, PAGE_SIZE } from "@/lib/projects/repository";
import { CampaignCard } from "@/components/campaign-card";
import { SetupNotice } from "@/components/setup-notice";
import type { ProjectStatus } from "@/types/campaign";

export const dynamic = "force-dynamic";

type Params = {
  q?: string | string[];
  status?: string | string[];
  page?: string | string[];
  deleted?: string | string[];
};
const filters: Array<{ label: string; value: ProjectStatus | "" }> = [
  { label: "All campaigns", value: "" },
  { label: "Drafts", value: "draft" },
  { label: "In progress", value: "generating" },
  { label: "Script ready", value: "script_ready" },
  { label: "Images ready", value: "images_ready" },
  { label: "Images & voice ready", value: "media_ready" },
  { label: "Video ready", value: "video_ready" },
  { label: "Needs revision", value: "needs_revision" },
  { label: "Review needs attention", value: "review_failed" },
  { label: "Partial generation", value: "partial" },
  { label: "Needs approval", value: "awaiting_approval" },
  { label: "Approved", value: "approved" },
  { label: "Queued", value: "queued" },
  { label: "Needs attention", value: "failed" },
];

export default async function Dashboard({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const configured = !!getSupabaseConfig();
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const parsedPage = Number(typeof params.page === "string" ? params.page : 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;
  const status = filters.find((filter) => filter.value === params.status)?.value || undefined;
  const { projects, count } = configured
    ? await listProjects({ search, page, status })
    : { projects: [], count: 0 };
  const pageHref = (number: number) =>
    `/?${new URLSearchParams({ q: search, status: status ?? "", page: String(number) })}`;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR CREATIVE STUDIO</div>
          <h1>
            Good ideas start here<span className="accent-dot">.</span>
          </h1>
          <p>Turn your next big idea into a video worth watching.</p>
        </div>
        <Link className="button primary" href="/campaigns/new">
          <Plus size={17} />
          New campaign
        </Link>
      </div>
      {!configured && <SetupNotice />}
      {configured && params.deleted === "1" && (
        <p className="success-notice" role="status">
          Campaign deleted.
        </p>
      )}
      <section className="studio-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-kicker">
            <Sparkles size={14} /> FROM BRIEF TO THE BIG PICTURE
          </span>
          <h2 id="hero-title">
            A creative team.
            <br />
            Inside your workflow.
          </h2>
          <p>
            Plan the story. Build the scenes. Review every detail.
            <br className="desktop-break" /> Bring your vision to life, with the final say always
            yours.
          </p>
          <Link href="/campaigns/new?sample=myhotelline" className="button light">
            Try the MyHotelLine brief <ArrowUpRight size={17} />
          </Link>
          <span className="hero-footnote">15-second social ad · A ready-to-edit sample brief</span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-label">
            <span /> A LITTLE CREATIVE DIRECTION
          </div>
          <div className="story-frame frame-back">
            <span>01 / THE HOOK</span>
            <div className="art-shape shape-one" />
          </div>
          <div className="story-frame frame-front">
            <div className="frame-top">
              <Clapperboard size={18} />
              <span>YOUR NEXT BIG IDEA</span>
            </div>
            <div className="art-asterisk">✳</div>
            <div className="frame-bottom">
              Make
              <br />
              them look.<span>15—30s</span>
            </div>
          </div>
          <div className="art-caption">
            <WandSparkles size={15} />A brief. A story. A little magic.
          </div>
        </div>
      </section>
      <section className="campaign-section" aria-labelledby="campaigns-title">
        <div className="section-heading">
          <div className="section-title">
            <h2 id="campaigns-title">Your campaigns</h2>
            {configured && <span className="count-badge">{count}</span>}
          </div>
          <span className="muted small">A home for every creative direction</span>
        </div>
        <form className="campaign-toolbar" action="/" method="get">
          <div className="search-field">
            <Search size={17} />
            <input
              type="search"
              name="q"
              placeholder="Search campaign names…"
              aria-label="Search campaign names"
              defaultValue={search}
              maxLength={120}
            />
          </div>
          <label className="filter-field">
            <span className="sr-only">Campaign status</span>
            <select name="status" defaultValue={status ?? ""}>
              {filters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary small-button" type="submit">
            Filter
          </button>
        </form>
        {projects.length > 0 ? (
          <div className="campaign-grid">
            {projects.map((project) => (
              <CampaignCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <Clapperboard size={27} />
              <span>✦</span>
            </div>
            <h3>
              {search || status
                ? "No campaigns match these filters"
                : "Your first story is waiting"}
            </h3>
            <p>
              {search || status
                ? "Try a different name or status to find your campaign."
                : "Start with a product and a point of view. Give your next campaign a place to take shape."}
            </p>
            {search || status ? (
              <Link href="/" className="text-link">
                Clear filters <ArrowRight size={15} />
              </Link>
            ) : (
              <Link href="/campaigns/new" className="text-link">
                Create your first campaign <ArrowRight size={16} />
              </Link>
            )}
          </div>
        )}
        {configured && (page > 1 || count > PAGE_SIZE) && (
          <nav className="pagination" aria-label="Campaign pages">
            {page > 1 ? (
              <Link className="button secondary small-button" href={pageHref(page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {page} · {count} matching campaigns
            </span>
            {page * PAGE_SIZE < count ? (
              <Link className="button secondary small-button" href={pageHref(page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
      <div className="workflow-strip">
        <span>THOUGHTFUL AT EVERY STEP</span>
        <p>
          Brief <ArrowRight /> Plan <ArrowRight /> Create <ArrowRight /> Review <ArrowRight /> Your
          approval
        </p>
        <span className="workflow-note">Built around your final say.</span>
      </div>
    </>
  );
}
