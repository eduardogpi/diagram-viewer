"use client";

import cytoscape, { type Core, type LayoutOptions } from "cytoscape";
import dagre from "cytoscape-dagre";
import { Check, Copy, Download, Focus, KeyRound, Route, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildCytoscapeElements,
  findShortestJoinPath,
  type CyDiffStatus,
  type CyRelationshipInput,
  type CyScopeInput,
  type CyTableNodeInput,
  type CytoscapeLayoutMode,
  type CytoscapeSizingMode,
} from "@/lib/cytoscape-graph";

let dagreRegistered = false;
function ensureCytoscapeExtensions() {
  if (!dagreRegistered && typeof window !== "undefined") {
    cytoscape.use(dagre);
    dagreRegistered = true;
  }
}

type Props = {
  nodes: CyTableNodeInput[];
  edges: CyRelationshipInput[];
  scopes: CyScopeInput[];
  diffMap?: Map<string, CyDiffStatus>;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onSelectEdge?: (edgeId: string | null) => void;
};

function buildLayoutConfig(
  mode: CytoscapeLayoutMode,
  rootNodeId?: string | null
): LayoutOptions {
  switch (mode) {
    case "dagre-tb":
      return {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 60,
        rankSep: 95,
        edgeSep: 30,
        animate: true,
        animationDuration: 280,
        fit: true,
        padding: 40,
      } as LayoutOptions;
    case "dagre-lr":
      return {
        name: "dagre",
        rankDir: "LR",
        nodeSep: 55,
        rankSep: 120,
        edgeSep: 30,
        animate: true,
        animationDuration: 280,
        fit: true,
        padding: 40,
      } as LayoutOptions;
    case "concentric":
      return {
        name: "concentric",
        concentric: (node: { data: (k: string) => number }) => node.data("degree") ?? 0,
        levelWidth: () => 2,
        minNodeSpacing: 55,
        animate: true,
        animationDuration: 280,
        fit: true,
        padding: 45,
      } as LayoutOptions;
    case "breadthfirst":
      return {
        name: "breadthfirst",
        directed: true,
        roots: rootNodeId ? [rootNodeId] : undefined,
        spacingFactor: 1.35,
        animate: true,
        animationDuration: 280,
        fit: true,
        padding: 45,
      };
    case "cose":
    default:
      return {
        name: "cose",
        idealEdgeLength: () => 140,
        nodeOverlap: 24,
        nodeRepulsion: () => 9000,
        nestingFactor: 1.2,
        gravity: 0.7,
        numIter: 800,
        animate: false,
        fit: true,
        padding: 45,
      };
  }
}

export default function CytoscapeDiagram({
  nodes,
  edges,
  scopes,
  diffMap,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const [layoutMode, setLayoutMode] = useState<CytoscapeLayoutMode>("dagre-tb");
  const [sizingMode, setSizingMode] = useState<CytoscapeSizingMode>("degree");
  const [showKeyColumns, setShowKeyColumns] = useState(true);
  const [hopDepth, setHopDepth] = useState<1 | 2>(1);

  const [pathfinderOpen, setPathfinderOpen] = useState(false);
  const [pathStartId, setPathStartId] = useState<string>("");
  const [pathEndId, setPathEndId] = useState<string>("");
  const [copiedSql, setCopiedSql] = useState(false);
  /** Tabela sob o mouse (posição já em coordenadas do container) — mostra a documentação. */
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);

  const useCompoundScopes = layoutMode === "cose" || layoutMode === "dagre-tb" || layoutMode === "dagre-lr";

  const elements = useMemo(
    () =>
      buildCytoscapeElements({
        nodes,
        edges,
        scopes,
        diffMap,
        sizingMode,
        showKeyColumns,
        useCompoundScopes,
      }),
    [nodes, edges, scopes, diffMap, sizingMode, showKeyColumns, useCompoundScopes]
  );

  const joinPath = useMemo(() => {
    if (!pathfinderOpen || !pathStartId || !pathEndId) return null;
    return findShortestJoinPath(nodes, edges, pathStartId, pathEndId);
  }, [pathfinderOpen, pathStartId, pathEndId, nodes, edges]);

  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const pathfinderOpenRef = useRef(pathfinderOpen);
  const pathStartIdRef = useRef(pathStartId);
  const pathEndIdRef = useRef(pathEndId);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
    onSelectEdgeRef.current = onSelectEdge;
    pathfinderOpenRef.current = pathfinderOpen;
    pathStartIdRef.current = pathStartId;
    pathEndIdRef.current = pathEndId;
  }, [onSelectNode, onSelectEdge, pathfinderOpen, pathStartId, pathEndId]);

  // Inicializa a instância do Cytoscape
  useEffect(() => {
    ensureCytoscapeExtensions();
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      minZoom: 0.15,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: "node.cy-scope",
          style: {
            shape: "round-rectangle",
            "background-color": "data(scopeFill)",
            "background-opacity": 0.65,
            "border-color": "data(scopeBorder)",
            "border-width": 2,
            "border-style": "dashed",
            label: "data(label)",
            color: "data(scopeColor)",
            "font-size": 11,
            "font-weight": "bold",
            "text-transform": "uppercase",
            "text-valign": "top",
            "text-halign": "center",
            "text-margin-y": -8,
            padding: "24px",
          },
        },
        {
          selector: "node.cy-table",
          style: {
            shape: "round-rectangle",
            width: "data(nodeWidth)",
            height: "data(nodeHeight)",
            "background-color": "data(bgColor)",
            "border-color": "data(borderColor)",
            "border-width": 2,
            label: "data(label)",
            color: "#e2e8f0",
            "font-family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            "font-size": 10,
            "text-wrap": "wrap",
            "text-max-width": "220px",
            "text-valign": "center",
            "text-halign": "center",
            "line-height": 1.35,
            "transition-property": "opacity, border-width, border-color, background-color",
            "transition-duration": 180,
          },
        },
        {
          selector: "node.cy-hub",
          style: {
            "border-width": 3,
          },
        },
        {
          selector: "node.diff-removed",
          style: {
            "border-style": "dashed",
            opacity: 0.7,
          },
        },
        {
          selector: "edge.cy-edge",
          style: {
            "curve-style": "bezier",
            width: 1.8,
            "line-color": "#0891b2",
            "target-arrow-color": "#0891b2",
            "target-arrow-shape": "triangle",
            "arrow-scale": 1.1,
            label: "data(edgeLabel)",
            color: "#94a3b8",
            "font-size": 9,
            "text-rotation": "autorotate",
            "text-margin-y": -7,
            "text-background-color": "#020617",
            "text-background-opacity": 0.85,
            "text-background-padding": "2px",
            "transition-property": "opacity, width, line-color, target-arrow-color",
            "transition-duration": 180,
          },
        },
        {
          selector: "edge.cy-edge-cross",
          style: {
            "line-style": "dashed",
            "line-color": "#a78bfa",
            "target-arrow-color": "#a78bfa",
          },
        },
        {
          selector: ".cy-highlighted-node",
          style: {
            "border-color": "#22d3ee",
            "border-width": 3.5,
            "z-index": 999,
          },
        },
        {
          selector: ".cy-highlighted-edge",
          style: {
            "line-color": "#22d3ee",
            "target-arrow-color": "#22d3ee",
            width: 3.2,
            "z-index": 999,
          },
        },
        {
          selector: ".cy-path-node",
          style: {
            "border-color": "#facc15",
            "border-width": 4,
            "background-color": "#422006",
            "z-index": 1000,
          },
        },
        {
          selector: ".cy-path-edge",
          style: {
            "line-color": "#facc15",
            "target-arrow-color": "#facc15",
            width: 3.6,
            "line-style": "solid",
            "z-index": 1000,
          },
        },
        {
          selector: ".cy-dimmed",
          style: {
            opacity: 0.16,
          },
        },
      ],
    });

    cy.on("tap", "node.cy-table", (evt) => {
      const nodeId = evt.target.id();
      if (pathfinderOpenRef.current) {
        if (!pathStartIdRef.current || (pathStartIdRef.current && pathEndIdRef.current)) {
          setPathStartId(nodeId);
          setPathEndId("");
        } else if (pathStartIdRef.current !== nodeId) {
          setPathEndId(nodeId);
        }
        return;
      }
      onSelectEdgeRef.current?.(null);
      onSelectNodeRef.current?.(nodeId);
    });

    cy.on("mouseover", "node.cy-table", (evt) => {
      const pos = evt.renderedPosition ?? evt.target.renderedPosition();
      setHovered({ id: evt.target.id(), x: pos.x, y: pos.y });
    });
    cy.on("mouseout", "node.cy-table", () => setHovered(null));
    cy.on("viewport", () => setHovered(null));

    cy.on("tap", "edge.cy-edge", (evt) => {
      if (pathfinderOpenRef.current) return;
      const edgeId = evt.target.id();
      onSelectNodeRef.current?.(null);
      onSelectEdgeRef.current?.(edgeId);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy || (evt.target.isNode?.() && evt.target.data("isScope"))) {
        onSelectNodeRef.current?.(null);
        onSelectEdgeRef.current?.(null);
      }
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Atualiza elementos e roda o layout escolhido
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    const layout = cy.layout(buildLayoutConfig(layoutMode, selectedNodeId));
    layout.run();
  }, [elements, layoutMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aplica destaque de seleção (vizinhança em 1 ou 2 saltos) ou destaque de Caminho JOIN (Pathfinder)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.batch(() => {
      cy.elements().removeClass("cy-highlighted-node cy-highlighted-edge cy-path-node cy-path-edge cy-dimmed");

      if (pathfinderOpen && joinPath?.found) {
        const pathNodeSet = new Set(joinPath.nodeIds);
        const pathEdgeSet = new Set(joinPath.edgeIds);

        cy.nodes(".cy-table").forEach((n) => {
          if (pathNodeSet.has(n.id())) {
            n.addClass("cy-path-node");
          } else {
            n.addClass("cy-dimmed");
          }
        });
        cy.edges(".cy-edge").forEach((e) => {
          if (pathEdgeSet.has(e.id())) {
            e.addClass("cy-path-edge");
          } else {
            e.addClass("cy-dimmed");
          }
        });
        return;
      }

      if (selectedEdgeId) {
        const edge = cy.getElementById(selectedEdgeId);
        if (edge && edge.nonempty()) {
          const connectedNodes = edge.connectedNodes();
          cy.nodes(".cy-table").addClass("cy-dimmed");
          cy.edges(".cy-edge").addClass("cy-dimmed");
          connectedNodes.removeClass("cy-dimmed").addClass("cy-highlighted-node");
          edge.removeClass("cy-dimmed").addClass("cy-highlighted-edge");
        }
        return;
      }

      if (selectedNodeId) {
        const root = cy.getElementById(selectedNodeId);
        if (root && root.nonempty()) {
          let neighborhood = root.closedNeighborhood();
          if (hopDepth === 2) {
            neighborhood = neighborhood.union(neighborhood.nodes().closedNeighborhood());
          }
          cy.nodes(".cy-table").addClass("cy-dimmed");
          cy.edges(".cy-edge").addClass("cy-dimmed");
          neighborhood.nodes(".cy-table").removeClass("cy-dimmed").addClass("cy-highlighted-node");
          neighborhood.edges(".cy-edge").removeClass("cy-dimmed").addClass("cy-highlighted-edge");
        }
      }
    });
  }, [selectedNodeId, selectedEdgeId, hopDepth, pathfinderOpen, joinPath, elements]);

  const handleFit = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ fit: { eles: cy.elements(), padding: 45 }, duration: 250 });
  }, []);

  const handleExportPng = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const dataUrl = cy.png({ full: true, scale: 2, bg: "#020617" });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `schema-graph-${layoutMode}.png`;
    link.click();
  }, [layoutMode]);

  return (
    <div className="relative h-full w-full select-none bg-slate-950">
      {/* Barra de controles do Grafo Cytoscape */}
      <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/90 p-1.5 text-xs text-slate-200 shadow-xl backdrop-blur-md">
        <label className="flex items-center gap-1 px-1.5 text-[11px] text-slate-400">
          <span>Layout:</span>
          <select
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value as CytoscapeLayoutMode)}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-medium text-slate-200 focus:border-cyan-400 focus:outline-none"
          >
            <option value="dagre-tb">Hierárquico (Vertical)</option>
            <option value="dagre-lr">Hierárquico (Horizontal)</option>
            <option value="cose">Força / Clusters (CoSE)</option>
            <option value="concentric">Centralidade (Hubs no centro)</option>
            <option value="breadthfirst">Árvore de Dependências</option>
          </select>
        </label>

        <label className="flex items-center gap-1 px-1.5 text-[11px] text-slate-400">
          <span>Escala:</span>
          <select
            value={sizingMode}
            onChange={(e) => setSizingMode(e.target.value as CytoscapeSizingMode)}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-medium text-slate-200 focus:border-cyan-400 focus:outline-none"
          >
            <option value="degree">Por Conexões (FKs)</option>
            <option value="columns">Por Nº de Colunas</option>
            <option value="uniform">Uniforme</option>
          </select>
        </label>

        <label className="flex items-center gap-1 px-1.5 text-[11px] text-slate-400" title="Alcance de vizinhos ao clicar numa tabela">
          <span>Vizinhos:</span>
          <select
            value={hopDepth}
            onChange={(e) => setHopDepth(Number(e.target.value) as 1 | 2)}
            className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] font-medium text-slate-200 focus:border-cyan-400 focus:outline-none"
          >
            <option value={1}>1 salto</option>
            <option value={2}>2 saltos</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => setShowKeyColumns((v) => !v)}
          title="Mostrar ou ocultar chaves (PK/FK/UQ) dentro de cada nó"
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
            showKeyColumns
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
              : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
          }`}
        >
          <KeyRound className="h-3 w-3" />
          Chaves
        </button>

        <button
          type="button"
          onClick={() => {
            setPathfinderOpen((v) => {
              const next = !v;
              if (next && !pathStartId && selectedNodeId) {
                setPathStartId(selectedNodeId);
              }
              return next;
            });
          }}
          title="Descobrir menor caminho de JOINs entre duas tabelas (Pathfinder)"
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
            pathfinderOpen
              ? "border-amber-400/70 bg-amber-500/20 text-amber-200"
              : "border-slate-700 bg-slate-950 text-slate-300 hover:border-amber-400/60 hover:text-amber-200"
          }`}
        >
          <Route className="h-3 w-3" />
          Caminho JOIN (A → B)
        </button>

        <button
          type="button"
          onClick={handleFit}
          title="Centralizar e enquadrar todo o grafo"
          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 transition hover:border-cyan-400 hover:text-cyan-200"
        >
          <Focus className="h-3 w-3" />
          Enquadrar
        </button>

        <button
          type="button"
          onClick={handleExportPng}
          title="Baixar imagem PNG de alta resolução do grafo"
          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 transition hover:border-cyan-400 hover:text-cyan-200"
        >
          <Download className="h-3 w-3" />
          PNG
        </button>
      </div>

      {/* Painel Pathfinder (Caminho de JOIN A → B) */}
      {pathfinderOpen ? (
        <div className="absolute bottom-3 left-3 z-20 w-[380px] max-w-[calc(100%-1.5rem)] rounded-2xl border border-amber-500/40 bg-slate-950/95 p-3.5 text-xs text-slate-200 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-amber-300">
              <Route className="h-3.5 w-3.5" />
              Caminho de JOIN (A → B)
            </p>
            <button
              type="button"
              onClick={() => setPathfinderOpen(false)}
              className="rounded-lg border border-slate-800 p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Clique em duas tabelas no grafo ou escolha abaixo para achar a cadeia mínima de chaves estrangeiras:
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-400">
              Tabela Origem (A)
              <select
                value={pathStartId}
                onChange={(e) => setPathStartId(e.target.value)}
                className="mt-0.5 block w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              >
                <option value="">Selecione...</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] text-slate-400">
              Tabela Destino (B)
              <select
                value={pathEndId}
                onChange={(e) => setPathEndId(e.target.value)}
                className="mt-0.5 block w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              >
                <option value="">Selecione...</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {joinPath ? (
            joinPath.found ? (
              <div className="mt-2.5 space-y-2">
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-amber-200">
                  {joinPath.nodeIds.map((id, idx) => {
                    const label = nodes.find((n) => n.id === id)?.label ?? id;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 font-mono">
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5">{label}</span>
                        {idx < joinPath.nodeIds.length - 1 ? <span>→</span> : null}
                      </span>
                    );
                  })}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      SQL sugerido ({joinPath.steps.length} JOIN{joinPath.steps.length === 1 ? "" : "s"})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(joinPath.sql).then(() => {
                          setCopiedSql(true);
                          setTimeout(() => setCopiedSql(false), 1800);
                        });
                      }}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-slate-800"
                    >
                      {copiedSql ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copiedSql ? "Copiado" : "Copiar SQL"}
                    </button>
                  </div>
                  <pre className="mt-1 max-h-28 overflow-x-auto font-mono text-[11px] text-slate-200">
                    {joinPath.sql}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
                Nenhum caminho de FKs conecta essas duas tabelas no estado atual.
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {/* Container de renderização Canvas do Cytoscape */}
      <div ref={containerRef} className="h-full w-full" />

      {(() => {
        if (!hovered) return null;
        const node = nodes.find((n) => n.id === hovered.id);
        const documented = node?.columns.filter((c) => c.comment?.trim()) ?? [];
        if (!node || (!node.comment?.trim() && documented.length === 0)) return null;
        return (
          <div
            className="pointer-events-none absolute z-30 max-w-[320px] rounded-xl border border-slate-700 bg-slate-900/95 p-2.5 text-xs text-slate-200 shadow-2xl"
            style={{ left: hovered.x + 16, top: hovered.y + 16 }}
          >
            <p className="font-semibold text-white">{node.label}</p>
            {node.comment?.trim() ? (
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-300">{node.comment}</p>
            ) : null}
            {documented.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5 border-t border-slate-800 pt-1.5">
                {documented.slice(0, 8).map((c) => (
                  <li key={c.name}>
                    <span className="font-mono text-slate-100">{c.name}</span>
                    <span className="text-slate-400"> — {c.comment}</span>
                  </li>
                ))}
                {documented.length > 8 ? (
                  <li className="text-slate-500">+{documented.length - 8} coluna(s) documentada(s)</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        );
      })()}
    </div>
  );
}
