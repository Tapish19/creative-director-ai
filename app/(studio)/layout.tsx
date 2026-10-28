import Link from "next/link";
import { Aperture, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Account } from "@/components/account";

export const dynamic = "force-dynamic";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Aperture size={25} />
          </span>
          <span>
            creative director<span className="brand-ai">AI STUDIO</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-icon">C</span>Creative workspace
          <span className="workspace-tag">01</span>
        </div>
        <p className="nav-eyebrow">WORKSPACE</p>
        <Navigation />
        <div className="sidebar-note">
          <span className="mini-spark">✳</span>
          <h3>
            Your vision.
            <br />A little more motion.
          </h3>
          <p>One brief. A complete creative workflow. You make the final call.</p>
          <Link href="/campaigns/new">
            Start with an idea <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <Account />
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <span className="topbar-title">
            Creative workspace <span>/</span> Studio
          </span>
          <span className="privacy-label">
            <ShieldCheck size={15} /> Private by design
          </span>
        </header>
        <main id="main" className="page-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>Creative Director AI</span>
          <span>Made for ideas worth watching.</span>
        </footer>
      </div>
    </div>
  );
}
