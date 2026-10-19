import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { Maximize, RefreshCw } from "lucide-react";
import { useVault, vaultIndex, followLink } from "../vault/store";
import { useWorkspace } from "../features/workspace/store";
import { useSettings } from "../settings/store";
import type { GraphData } from "../backlinks/vaultIndex";
import { filterGraph, type GraphFilter } from "./filter";

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function style(): cytoscape.StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        "background-color": cssVar("--graph-node"),
        label: "data(label)",
        color: cssVar("--text-muted"),
        "font-size": 10,
        "text-valign": "bottom",
        "text-margin-y": 4,
        width: "mapData(degree, 0, 20, 7, 22)",
        height: "mapData(degree, 0, 20, 7, 22)",
        "min-zoomed-font-size": 7,
        "text-max-width": "120px",
        "text-wrap": "ellipsis",
      },
    },
    { selector: "node.unresolved", style: { "background-color": cssVar("--graph-unresolved"), "background-opacity": 0.6 } },
    { selector: "node.current", style: { "background-color": cssVar("--accent"), color: cssVar("--text") } },
    { selector: "node:selected, node.hover", style: { "background-color": cssVar("--accent"), color: cssVar("--text"), "z-index": 10 } },
    { selector: "node.faded", style: { opacity: 0.25 } },
    { selector: "edge", style: { width: 1, "line-color": cssVar("--graph-edge"), "curve-style": "haystack", opacity: 0.8 } },
    { selector: "edge.hover", style: { "line-color": cssVar("--accent"), width: 1.5 } },
    { selector: "edge.faded", style: { opacity: 0.12 } },
  ];
}

function toElements(data: GraphData, current?: string): ElementDefinition[] {
  return [
    ...data.nodes.map((n) => ({
      data: { id: n.id, label: n.label, degree: n.degree },
      classes: [n.unresolved ? "unresolved" : "", n.id === current ? "current" : ""].join(" "),
    })),
    ...data.edges.map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target } })),
  ];
}

/** Shared Cytoscape canvas. Large graphs skip animation and use a cheaper layout. */
function GraphCanvas({ data, current, onOpen }: { data: GraphData; current?: string; onOpen: (id: string, newTab: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const theme = useSettings((s) => s.settings.theme);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!host.current) return;
    const big = data.nodes.length > 1500;
    const inst = cytoscape({
      container: host.current,
      elements: toElements(data, current),
      style: style(),
      layout: big
        ? { name: "concentric", animate: false, concentric: (n: cytoscape.NodeSingular) => n.degree(false), levelWidth: () => 2 }
        : { name: "cose", animate: false, randomize: true, nodeRepulsion: () => 8000, idealEdgeLength: () => 60, numIter: data.nodes.length > 500 ? 400 : 1000 },
      minZoom: 0.05,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      textureOnViewport: big,
      hideEdgesOnViewport: big,
      pixelRatio: big ? 1 : "auto",
    });
    // Small graphs would otherwise be fitted at a huge zoom level.
    if (inst.zoom() > 1.3) {
      inst.zoom(1.3);
      inst.center();
    }
    inst.on("tap", "node", (e) => {
      const id = e.target.id() as string;
      const oe = e.originalEvent as MouseEvent | undefined;
      onOpenRef.current(id, !!(oe && (oe.metaKey || oe.ctrlKey)));
    });
    inst.on("mouseover", "node", (e) => {
      const n = e.target;
      inst.elements().addClass("faded");
      n.closedNeighborhood().removeClass("faded").addClass("hover");
    });
    inst.on("mouseout", "node", () => inst.elements().removeClass("faded hover"));
    cy.current = inst;
    return () => {
      inst.destroy();
      cy.current = null;
    };
  }, [data, current]);

  useEffect(() => {
    // Re-read CSS variables after a theme change.
    const id = requestAnimationFrame(() => cy.current?.style(style()));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  return (
    <div className="graph-wrap">
      <div ref={host} className="graph-canvas" role="img" aria-label={`Graph of ${data.nodes.length} notes and ${data.edges.length} links`} />
      <div className="graph-controls">
        <button className="icon-btn" title="Fit to screen" aria-label="Fit graph to screen" onClick={() => {
            const c = cy.current;
            if (!c) return;
            c.fit(undefined, 30);
            if (c.zoom() > 1.3) {
              c.zoom(1.3);
              c.center();
            }
          }}>
          <Maximize size={14} />
        </button>
        <button className="icon-btn" title="Re-run layout" aria-label="Re-run layout" onClick={() => cy.current?.layout({ name: "cose", animate: false, randomize: true } as cytoscape.LayoutOptions).run()}>
          <RefreshCw size={14} />
        </button>
      </div>
      {data.nodes.length === 0 && <div className="graph-empty muted">Nothing to show with the current filters.</div>}
    </div>
  );
}

const openNode = (id: string, newTab: boolean) => {
  if (id.startsWith("unresolved:")) {
    const src = useWorkspace.getState().activeTab()?.path ?? "";
    void followLink(id.slice("unresolved:".length), src, { newTab });
  } else useWorkspace.getState().openNote(id, { newTab: newTab || useWorkspace.getState().activeTab()?.kind === "graph" });
};

export function GraphView() {
  const indexVersion = useVault((s) => s.indexVersion);
  const [filter, setFilter] = useState<GraphFilter>({ query: "", tag: "", folder: "", showOrphans: true, showUnresolved: false });
  // Rebuilding the layout on every keystroke is expensive; only rebuild graph data when the index settles.
  const [settledVersion, setSettledVersion] = useState(indexVersion);
  useEffect(() => {
    const t = setTimeout(() => setSettledVersion(indexVersion), 800);
    return () => clearTimeout(t);
  }, [indexVersion]);
  const full = useMemo(() => vaultIndex.graph(filter.showUnresolved), [settledVersion, filter.showUnresolved]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => filterGraph(full, filter), [full, filter]);
  const tags = useMemo(() => [...vaultIndex.tags().keys()], [settledVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const folders = useMemo(() => [...new Set(full.nodes.map((n) => n.folder).filter(Boolean))].sort(), [full]);

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <input className="input" placeholder="Filter by name…" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} aria-label="Filter nodes by name" />
        <select className="input" value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <select className="input" value={filter.folder} onChange={(e) => setFilter({ ...filter, folder: e.target.value })} aria-label="Filter by folder">
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={filter.showOrphans} onChange={(e) => setFilter({ ...filter, showOrphans: e.target.checked })} /> Orphans
        </label>
        <label className="check">
          <input type="checkbox" checked={filter.showUnresolved} onChange={(e) => setFilter({ ...filter, showUnresolved: e.target.checked })} /> Unresolved
        </label>
        <span className="muted small">
          {data.nodes.length} notes · {data.edges.length} links
        </span>
      </div>
      <GraphCanvas data={data} onOpen={openNode} />
    </div>
  );
}

export function LocalGraph({ path }: { path: string }) {
  const indexVersion = useVault((s) => s.indexVersion);
  const [depth, setDepth] = useState(1);
  const [settled, setSettled] = useState(indexVersion);
  useEffect(() => {
    const t = setTimeout(() => setSettled(indexVersion), 800);
    return () => clearTimeout(t);
  }, [indexVersion]);
  const data = useMemo(() => vaultIndex.localGraph(path, depth), [path, depth, settled]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="local-graph">
      <div className="graph-toolbar compact">
        <label className="small muted">
          Depth{" "}
          <select className="input" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Local graph depth">
            {[1, 2, 3].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <span className="muted small">{data.nodes.length} notes</span>
      </div>
      <GraphCanvas data={data} current={path} onOpen={(id, newTab) => (id === path ? undefined : openNode(id, newTab))} />
    </div>
  );
}
