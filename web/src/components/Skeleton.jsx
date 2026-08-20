/**
 * Placeholder cards for while a search is out. The API answers in one shot
 * after walking the pager, so there is no progress to show — this shows the
 * shape of the answer instead.
 */
export function SkeletonList({ count = 3 }) {
  return (
    <ul className="skeleton-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="glass-panel skeleton-card">
          <span className="skeleton title" />
          <span className="skeleton line" />
          <span className="skeleton line short" />
          <span className="skeleton-row">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The detail pop-up is one page load, so this stands in for that one card. */
export function SkeletonPreview() {
  return (
    <div className="preview" aria-hidden="true">
      <span className="skeleton line" style={{ width: '60%' }} />
      <span className="skeleton line" style={{ width: '45%' }} />
      <span className="skeleton line" style={{ width: '70%' }} />
      <span className="skeleton block" />
    </div>
  );
}
