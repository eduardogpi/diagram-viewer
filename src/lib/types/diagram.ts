export type DiagramColumnDTO = {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  references?: { table: string; column: string };
  /** Metadados da constraint de foreign key */
  fkMetadata?: {
    constraintName: string;
    onDelete: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
    onUpdate: "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" | "NO ACTION";
  };
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
  /** Tipo de cardinalidade: 1:1, 1:N, N:1 */
  cardinality?: "1:1" | "1:N" | "N:1";
  /** Regras de delete e update da FK */
  onDelete?: string;
  onUpdate?: string;
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
