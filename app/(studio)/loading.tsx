export default function Loading() {
  return (
    <div className="loading-view" role="status">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="skeleton skeleton-hero" />
      <span className="sr-only">Loading your workspace…</span>
    </div>
  );
}
