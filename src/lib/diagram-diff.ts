import type { DiagramResponse } from "@/lib/types/diagram";

export type DiagramDiffStatus = "added" | "altered" | "removed";

function signatureOf(node: {
  id: string;
  label: string;
  columns: Array<{ name: string; type: string; isPrimary: boolean; isForeign: boolean }>;
}): string {
  return [
    node.label,
    node.columns.map((c) => `${c.name}:${c.type}:${c.isPrimary ? "1" : "0"}:${c.isForeign ? "1" : "0"}`).join(","),
  ].join("|");
}

/** Compara duas versões de um DiagramResponse e retorna o status (added/altered/removed) de cada tabela. */
export function computeDiagramDiff(
  previous: DiagramResponse | null,
  current: DiagramResponse
): Map<string, DiagramDiffStatus> {
  const map = new Map<string, DiagramDiffStatus>();
  if (!previous) {
    current.nodes.forEach((node) => map.set(node.id, "added"));
    return map;
  }

  const prevIds = new Set(previous.nodes.map((n) => n.id));
  const prevSignatures = new Map(previous.nodes.map((n) => [n.id, signatureOf(n)]));

  current.nodes.forEach((node) => {
    if (!prevIds.has(node.id)) {
      map.set(node.id, "added");
    } else if (prevSignatures.get(node.id) !== signatureOf(node)) {
      map.set(node.id, "altered");
    }
  });

  prevIds.forEach((id) => {
    if (!current.nodes.some((n) => n.id === id)) {
      map.set(id, "removed");
    }
  });

  return map;
}
