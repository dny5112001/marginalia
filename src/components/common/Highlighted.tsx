/** Render text with highlighted [start, end) ranges. */
export function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([s, e], i) => {
    if (s < last) return;
    if (s > last) parts.push(text.slice(last, s));
    parts.push(<mark key={i}>{text.slice(s, e)}</mark>);
    last = e;
  });
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Highlight individual character indices (fuzzy matches). */
export function HighlightedChars({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const out: React.ReactNode[] = [];
  let buf = "";
  let inMark = false;
  const flush = (k: number) => {
    if (!buf) return;
    out.push(inMark ? <mark key={k}>{buf}</mark> : buf);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== inMark) {
      flush(i);
      inMark = m;
    }
    buf += text[i];
  }
  flush(text.length);
  return <>{out}</>;
}
