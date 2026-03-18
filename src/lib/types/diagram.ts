export type DiagramColumnDTO = {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  references?: { table: string; column: string };
};

export type DiagramNodeDTO = {
  id: string;
  label: string;
  schema: string;
  scope: string;
  columns: DiagramColumnDTO[];
};

export type DiagramEdgeDTO = {
  id: string;
  source: string;
  target: string;
  scope: string;
  constraint: string;
  columns: { source: string; target: string }[];
};

export type DiagramScopeDTO = {
  id: string;
  label: string;
  description: string;
  tables: number;
};

export type DiagramResponse = {
  nodes: DiagramNodeDTO[];
  edges: DiagramEdgeDTO[];
  scopes: DiagramScopeDTO[];
};
