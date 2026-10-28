import Link from "next/link";
import { ArrowUpRight, Clock3, Film, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { Project } from "@/types/campaign";

export function CampaignCard({ project }: { project: Project }) {
  return (
    <Link className="campaign-card" href={`/campaigns/${project.id}`}>
      <div className="campaign-cover">
        <div className="cover-lines" />
        <span className="cover-initial">{project.product_name.slice(0, 1).toUpperCase()}</span>
        <span className="cover-format">
          <Film size={13} />
          {project.duration}s · Vertical video
        </span>
        <span className="card-open">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <div className="campaign-card-body">
        <div className="card-meta">
          <span>{project.product_name}</span>
          <StatusBadge status={project.status} />
        </div>
        <h3>{project.name}</h3>
        <p>{project.description}</p>
        <div className="card-footer">
          <span>
            <Users size={14} />
            {project.target_audience}
          </span>
          <span>
            <Clock3 size={13} />
            {new Date(project.created_at).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </span>
        </div>
      </div>
    </Link>
  );
}
