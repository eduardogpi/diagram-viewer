import type { IntrospectionResult } from "@/lib/db/drivers/types";

/**
 * Fixture de catálogo (loja online) usada por smoke tests e testes de integração.
 * Reproduz o formato normalizado que os drivers devolvem de `introspect()`.
 */
export const lojaSchemaFixture: IntrospectionResult = {
  tables: [
    { tableName: "clientes", tableSchema: "loja" },
    { tableName: "pedidos", tableSchema: "loja" },
    { tableName: "pedido_itens", tableSchema: "loja" },
    { tableName: "produtos", tableSchema: "loja" },
  ],
  columns: [
    { tableName: "clientes", columnName: "id", columnType: "int", isNullable: false, isPrimary: true },
    { tableName: "clientes", columnName: "nome", columnType: "varchar(120)", isNullable: false, isPrimary: false },
    { tableName: "clientes", columnName: "email", columnType: "varchar(180)", isNullable: true, isPrimary: false },
    { tableName: "pedidos", columnName: "id", columnType: "int", isNullable: false, isPrimary: true },
    { tableName: "pedidos", columnName: "cliente_id", columnType: "int", isNullable: false, isPrimary: false },
    { tableName: "pedidos", columnName: "total", columnType: "numeric(10,2)", isNullable: false, isPrimary: false },
    { tableName: "pedido_itens", columnName: "pedido_id", columnType: "int", isNullable: false, isPrimary: true },
    { tableName: "pedido_itens", columnName: "produto_id", columnType: "int", isNullable: false, isPrimary: true },
    { tableName: "pedido_itens", columnName: "quantidade", columnType: "int", isNullable: false, isPrimary: false },
    { tableName: "produtos", columnName: "id", columnType: "int", isNullable: false, isPrimary: true },
    { tableName: "produtos", columnName: "nome", columnType: "varchar(120)", isNullable: false, isPrimary: false },
  ],
  foreignKeys: [
    {
      constraintName: "fk_pedidos_cliente",
      tableName: "pedidos",
      columnName: "cliente_id",
      referencedTable: "clientes",
      referencedColumn: "id",
      updateRule: "CASCADE",
      deleteRule: "RESTRICT",
    },
    {
      constraintName: "fk_itens_pedido",
      tableName: "pedido_itens",
      columnName: "pedido_id",
      referencedTable: "pedidos",
      referencedColumn: "id",
      updateRule: "CASCADE",
      deleteRule: "CASCADE",
    },
    {
      constraintName: "fk_itens_produto",
      tableName: "pedido_itens",
      columnName: "produto_id",
      referencedTable: "produtos",
      referencedColumn: "id",
      updateRule: "CASCADE",
      deleteRule: "RESTRICT",
    },
  ],
};
