/** Marginalia mark: a page with a margin rule and a linked node. Original artwork. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="6" width="40" height="52" rx="6" fill="var(--logo-page, #2a2f3a)" />
      <path d="M22 6v52" stroke="var(--accent)" strokeWidth="3" />
      <path d="M28 20h14M28 28h16M28 36h10" stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="46" r="8" fill="var(--accent)" />
      <path d="M38 36l6 6" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
