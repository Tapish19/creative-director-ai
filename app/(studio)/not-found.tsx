import Link from "next/link";

export default function CampaignNotFound() {
  return (
    <section className="not-found">
      <div className="eyebrow">NOT FOUND</div>
      <h1>This direction leads nowhere.</h1>
      <p>The page may have moved, or this campaign isn’t in your workspace.</p>
      <Link href="/" className="button primary">
        Back to campaigns
      </Link>
    </section>
  );
}
