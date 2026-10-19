import type { GraphData } from "../backlinks/vaultIndex";
import { normalize } from "../search/searchIndex";

export interface GraphFilter {
  query: string;
  tag: string;
  folder: string;
  showOrphans: boolean;
  showUnresolved: boolean;
}

/** Apply graph-view filters. Edges are kept only when both endpoints survive. */
export function filterGraph(data: GraphData, f: GraphFilter): GraphData {
  const q = normalize(f.query.trim());
  let nodes = data.nodes.filter((n) => {
    if (n.unresolved) return f.showUnresolved && !f.tag && !f.folder;
    if (q && !normalize(n.label).includes(q)) return false;
    if (f.tag && !n.tags.some((t) => t === f.tag || t.startsWith(f.tag + "/"))) return false;
    if (f.folder && n.folder !== f.folder && !n.folder.startsWith(f.folder + "/")) return false;
    return true;
  });
  const keep = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  if (!f.showOrphans) {
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    nodes = nodes.filter((n) => linked.has(n.id));
  }
  return { nodes, edges };
}
