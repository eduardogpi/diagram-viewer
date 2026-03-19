export type DiagramViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type DiagramPreferences = {
  minimap: boolean;
  scopeDepth: number;
  layoutDirection: "TB" | "LR";
  groupingMode: "domain" | "schema" | "prefix";
  selectedScopeIds: string[];
  selectedTableIds: string[];
  searchQuery: string;
  viewport: DiagramViewport | null;
};

const defaultPreferences: DiagramPreferences = {
  minimap: true,
  scopeDepth: 2,
  layoutDirection: "TB",
  groupingMode: "domain",
  selectedScopeIds: [],
  selectedTableIds: [],
  searchQuery: "",
  viewport: null,
};

export function parseDiagramPreferences(value: string | null | undefined): DiagramPreferences {
  if (!value) {
    return defaultPreferences;
  }

  try {
    const parsed = JSON.parse(value) as Partial<DiagramPreferences>;
    return {
      minimap: typeof parsed.minimap === "boolean" ? parsed.minimap : defaultPreferences.minimap,
      scopeDepth:
        typeof parsed.scopeDepth === "number" && parsed.scopeDepth > 0 && parsed.scopeDepth <= 5
          ? parsed.scopeDepth
          : defaultPreferences.scopeDepth,
      layoutDirection: parsed.layoutDirection === "LR" ? "LR" : "TB",
      groupingMode:
        parsed.groupingMode === "schema" || parsed.groupingMode === "prefix" ? parsed.groupingMode : "domain",
      selectedScopeIds: Array.isArray(parsed.selectedScopeIds)
        ? parsed.selectedScopeIds.filter((item): item is string => typeof item === "string")
        : [],
      selectedTableIds: Array.isArray(parsed.selectedTableIds)
        ? parsed.selectedTableIds.filter((item): item is string => typeof item === "string")
        : [],
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
      viewport:
        parsed.viewport &&
        typeof parsed.viewport.x === "number" &&
        typeof parsed.viewport.y === "number" &&
        typeof parsed.viewport.zoom === "number"
          ? parsed.viewport
          : null,
    };
  } catch {
    return defaultPreferences;
  }
}

export function serializeDiagramPreferences(preferences: Partial<DiagramPreferences>) {
  return JSON.stringify({
    minimap: preferences.minimap ?? defaultPreferences.minimap,
    scopeDepth: preferences.scopeDepth ?? defaultPreferences.scopeDepth,
    layoutDirection: preferences.layoutDirection ?? defaultPreferences.layoutDirection,
    groupingMode: preferences.groupingMode ?? defaultPreferences.groupingMode,
    selectedScopeIds: preferences.selectedScopeIds ?? defaultPreferences.selectedScopeIds,
    selectedTableIds: preferences.selectedTableIds ?? defaultPreferences.selectedTableIds,
    searchQuery: preferences.searchQuery ?? defaultPreferences.searchQuery,
    viewport: preferences.viewport ?? defaultPreferences.viewport,
  } satisfies DiagramPreferences);
}

export type DiagramLayoutSnapshot = {
  id: string;
  name: string;
  nodes: Array<{ id: string; position: { x: number; y: number } }>;
  edges: string[];
  settings: DiagramPreferences;
  createdAt: string;
  createdBy: string;
};

export function parseLayoutSettings(value: string | null | undefined) {
  return parseDiagramPreferences(value);
}

export function serializeLayoutSettings(value: Partial<DiagramPreferences>) {
  return serializeDiagramPreferences(value);
}
