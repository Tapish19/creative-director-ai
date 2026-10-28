import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="not-found">
      <div className="eyebrow">NOT FOUND</div>
      <h1>This direction leads nowhere.</h1>
      <p>The page may have moved, or this campaign isn’t in your workspace.</p>
      <Link href="/" className="button primary">
        Back to campaigns
      </Link>
    </main>
  );
}
