import { describe, expect, it } from "vitest";

import {
  buildMigrationFiles,
  detectMigrationProvider,
  packageChecksum,
  parseMigrations,
} from "@/lib/services/migration-parser";
import type { MigrationFileInput } from "@/lib/types/migrations";

const V1: MigrationFileInput = {
  name: "V1__init_schema.sql",
  content: `
CREATE TABLE owners (
  id BIGINT NOT NULL AUTO_INCREMENT,
  first_name VARCHAR(30) NOT NULL,
  last_name VARCHAR(30) NOT NULL,
  address VARCHAR(255),
  city VARCHAR(80),
  telephone VARCHAR(20),
  PRIMARY KEY (id)
);

CREATE TABLE pets (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(30) NOT NULL,
  birth_date DATE,
  type_id BIGINT NOT NULL,
  owner_id BIGINT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_pet_owner FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE types (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE pets ADD CONSTRAINT fk_pet_type FOREIGN KEY (type_id) REFERENCES types (id);
`,
};

const V2: MigrationFileInput = {
  name: "V2__add_visits.sql",
  content: `
CREATE TABLE visits (
  id BIGINT NOT NULL AUTO_INCREMENT,
  pet_id BIGINT NOT NULL,
  visit_date DATE NOT NULL,
  description VARCHAR(255),
  PRIMARY KEY (id),
  CONSTRAINT fk_visit_pet FOREIGN KEY (pet_id) REFERENCES pets (id) ON DELETE CASCADE
);

ALTER TABLE owners ADD COLUMN email VARCHAR(255);
`,
};

const V3: MigrationFileInput = {
  name: "V3__rename_and_drop.sql",
  content: `
ALTER TABLE owners RENAME COLUMN first_name TO given_name;

ALTER TABLE pets DROP COLUMN birth_date;

DROP TABLE types;

ALTER TABLE pets DROP FOREIGN KEY fk_pet_type;
`,
};

const files = [V1, V2, V3];

describe("migration-parser / ordering", () => {
  it("ordena migrations Flyway por versão", () => {
    const built = buildMigrationFiles([V3, V1, V2]);
    expect(built.map((f) => f.order)).toEqual([1, 2, 3]);
    expect(built[0].name).toBe("V1__init_schema.sql");
    expect(built[2].name).toBe("V3__rename_and_drop.sql");
  });

  it("detecta provider flyway quando há arquivos V__", () => {
    expect(detectMigrationProvider(files)).toBe("flyway");
  });

  it("detecta provider sql quando não há padrão Flyway", () => {
    expect(detectMigrationProvider([{ name: "001_init.sql", content: "CREATE TABLE a (id INT);" }])).toBe("sql");
  });

  it("calcula checksum determinístico do package", () => {
    const built = buildMigrationFiles(files);
    const c1 = packageChecksum(built);
    const c2 = packageChecksum(buildMigrationFiles(files));
    expect(c1).toBe(c2);
    expect(c1).toHaveLength(16);
  });
});

describe("migration-parser / parseMigrations", () => {
  const result = parseMigrations(files);

  it("produz um snapshot por migration", () => {
    expect(result.snapshots).toHaveLength(3);
    expect(result.fileCount).toBe(3);
  });

  it("snapshot V1 cria owners, pets e types", () => {
    const snap1 = result.snapshots[0];
    const tableIds = snap1.diagram.nodes.map((n) => n.id);
    expect(tableIds).toContain("owners");
    expect(tableIds).toContain("pets");
    expect(tableIds).toContain("types");

    const owners = snap1.diagram.nodes.find((n) => n.id === "owners")!;
    const idCol = owners.columns.find((c) => c.name === "id");
    expect(idCol?.isPrimary).toBe(true);
    expect(idCol?.isNullable).toBe(false);

    const firstName = owners.columns.find((c) => c.name === "first_name");
    expect(firstName?.isNullable).toBe(false);

    const address = owners.columns.find((c) => c.name === "address");
    expect(address?.isNullable).toBe(true);
  });

  it("detecta FK inline no CREATE TABLE e FK via ALTER TABLE", () => {
    const snap1 = result.snapshots[0];
    const fkEdges = snap1.diagram.edges.map((e) => e.constraint);
    expect(fkEdges).toContain("fk_pet_owner");
    expect(fkEdges).toContain("fk_pet_type");

    const petOwner = snap1.diagram.edges.find((e) => e.constraint === "fk_pet_owner");
    expect(petOwner?.source).toBe("pets");
    expect(petOwner?.target).toBe("owners");
    expect(petOwner?.onDelete).toBe("CASCADE");
    expect(petOwner?.onUpdate).toBe("NO ACTION");
  });

  it("snapshot V2 adiciona visits e coluna email em owners", () => {
    const snap2 = result.snapshots[1];
    expect(snap2.diagram.nodes.map((n) => n.id)).toContain("visits");

    const owners = snap2.diagram.nodes.find((n) => n.id === "owners")!;
    expect(owners.columns.map((c) => c.name)).toContain("email");

    const visitEdge = snap2.diagram.edges.find((e) => e.constraint === "fk_visit_pet");
    expect(visitEdge?.source).toBe("visits");
    expect(visitEdge?.target).toBe("pets");
  });

  it("snapshot V3 renomeia coluna, dropa coluna, dropa tabela e remove FK", () => {
    const snap3 = result.snapshots[2];
    const tableIds = snap3.diagram.nodes.map((n) => n.id);
    expect(tableIds).not.toContain("types");

    const owners = snap3.diagram.nodes.find((n) => n.id === "owners")!;
    expect(owners.columns.map((c) => c.name)).toContain("given_name");
    expect(owners.columns.map((c) => c.name)).not.toContain("first_name");

    const pets = snap3.diagram.nodes.find((n) => n.id === "pets")!;
    expect(pets.columns.map((c) => c.name)).not.toContain("birth_date");

    const fkConstraints = snap3.diagram.edges.map((e) => e.constraint);
    expect(fkConstraints).not.toContain("fk_pet_type");
    expect(fkConstraints).toContain("fk_pet_owner");
  });

  it("diagrama final reflete estado acumulado após todas as migrations", () => {
    const final = result.finalDiagram;
    const tableIds = final.nodes.map((n) => n.id);
    expect(tableIds).toContain("owners");
    expect(tableIds).toContain("pets");
    expect(tableIds).toContain("visits");
    expect(tableIds).not.toContain("types");
  });

  it("deriva scopes por prefixo de tabela", () => {
    const final = result.finalDiagram;
    const scopes = final.scopes.map((s) => s.id);
    expect(scopes).toContain("owners");
    expect(scopes).toContain("pets");
    expect(scopes).toContain("visits");
  });
});

describe("migration-parser / tolerância", () => {
  it("registra warning para statement não suportado sem quebrar o snapshot", () => {
    const result = parseMigrations([
      {
        name: "V1__weird.sql",
        content: `
CREATE TABLE foo (id INT NOT NULL PRIMARY KEY);
ALTER TABLE foo FROBNICATE id;
`,
      },
    ]);
    expect(result.snapshots).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].statement).toContain("FROBNICATE");
    expect(result.finalDiagram.nodes.map((n) => n.id)).toContain("foo");
  });

  it("suporta CREATE TABLE IF NOT EXISTS", () => {
    const result = parseMigrations([
      { name: "V1.sql", content: "CREATE TABLE IF NOT EXISTS bar (id INT NOT NULL PRIMARY KEY);" },
    ]);
    expect(result.finalDiagram.nodes.map((n) => n.id)).toContain("bar");
  });

  it("suporta identificadores com backticks (MySQL)", () => {
    const result = parseMigrations([
      {
        name: "V1.sql",
        content: "CREATE TABLE `order` (`id` INT NOT NULL, `name` VARCHAR(50), PRIMARY KEY (`id`));",
      },
    ]);
    const node = result.finalDiagram.nodes.find((n) => n.id === "order");
    expect(node).toBeDefined();
    expect(node?.columns.find((c) => c.name === "id")?.isPrimary).toBe(true);
  });

  it("suporta RENAME TABLE", () => {
    const result = parseMigrations([
      { name: "V1.sql", content: "CREATE TABLE old (id INT NOT NULL PRIMARY KEY);" },
      { name: "V2.sql", content: "RENAME TABLE old TO renewed;" },
    ]);
    expect(result.snapshots[1].diagram.nodes.map((n) => n.id)).toContain("renewed");
    expect(result.snapshots[1].diagram.nodes.map((n) => n.id)).not.toContain("old");
  });

  it("suporta schema qualificado (schema.table)", () => {
    const result = parseMigrations([
      { name: "V1.sql", content: "CREATE TABLE clinic.patients (id INT NOT NULL PRIMARY KEY);" },
    ]);
    const node = result.finalDiagram.nodes.find((n) => n.id === "patients");
    expect(node?.schema).toBe("clinic");
  });
});

describe("migration-parser / módulos e paths", () => {
  const coreV1: MigrationFileInput = {
    name: "V1__core_init.sql",
    content: "CREATE TABLE core_users (id INT NOT NULL PRIMARY KEY);",
    path: "resources/db/migration/core/V1__core_init.sql",
  };
  const coreV2: MigrationFileInput = {
    name: "V2__core_add_email.sql",
    content: "ALTER TABLE core_users ADD COLUMN email VARCHAR(255);",
    path: "resources/db/migration/core/V2__core_add_email.sql",
  };
  const billingV1: MigrationFileInput = {
    name: "V1__billing_init.sql",
    content: "CREATE TABLE invoices (id INT NOT NULL PRIMARY KEY);",
    path: "resources/db/migration/billing/V1__billing_init.sql",
  };

  it("ordena por módulo (pasta) e depois por versão Flyway dentro do módulo", () => {
    const built = buildMigrationFiles([billingV1, coreV2, coreV1]);
    expect(built.map((f) => f.name)).toEqual([
      "resources/db/migration/billing/V1__billing_init.sql",
      "resources/db/migration/core/V1__core_init.sql",
      "resources/db/migration/core/V2__core_add_email.sql",
    ]);
    expect(built.map((f) => f.order)).toEqual([1, 2, 3]);
  });

  it("detecta provider flyway mesmo quando o nome base está dentro de um path", () => {
    expect(detectMigrationProvider([coreV1, coreV2, billingV1])).toBe("flyway");
  });

  it("preserva o caminho relativo no migrationName dos snapshots", () => {
    const result = parseMigrations([coreV1, coreV2]);
    expect(result.snapshots[0].migrationName).toBe("resources/db/migration/core/V1__core_init.sql");
    expect(result.snapshots[1].migrationName).toBe("resources/db/migration/core/V2__core_add_email.sql");
  });

  it("mantém compatibilidade quando path não é fornecido (usa name)", () => {
    const built = buildMigrationFiles([
      { name: "V1__a.sql", content: "CREATE TABLE a (id INT NOT NULL PRIMARY KEY);" },
      { name: "V2__b.sql", content: "CREATE TABLE b (id INT NOT NULL PRIMARY KEY);" },
    ]);
    expect(built.map((f) => f.name)).toEqual(["V1__a.sql", "V2__b.sql"]);
  });

  it("arquivos sem versão Flyway são ordenados por módulo e depois por nome", () => {
    const built = buildMigrationFiles([
      { name: "002_b.sql", content: "SELECT 1;", path: "mod_b/002_b.sql" },
      { name: "001_a.sql", content: "SELECT 1;", path: "mod_a/001_a.sql" },
      { name: "001_b.sql", content: "SELECT 1;", path: "mod_b/001_b.sql" },
    ]);
    expect(built.map((f) => f.name)).toEqual([
      "mod_a/001_a.sql",
      "mod_b/001_b.sql",
      "mod_b/002_b.sql",
    ]);
  });
});

describe("migration-parser / múltiplos projetos no mesmo pacote", () => {
  const doisProjetos = [
    {
      name: "V1__init.sql",
      path: "projeto-a/V1__init.sql",
      content: `CREATE TABLE users (id INT NOT NULL PRIMARY KEY, email VARCHAR(120));
        CREATE TABLE pedidos (id INT NOT NULL PRIMARY KEY, user_id INT REFERENCES users(id));`,
    },
    {
      name: "V1__init.sql",
      path: "projeto-b/V1__init.sql",
      content: `CREATE TABLE users (id INT NOT NULL PRIMARY KEY, cpf VARCHAR(11));
        CREATE TABLE faturas (id INT NOT NULL PRIMARY KEY, user_id INT REFERENCES users(id));`,
    },
  ];

  it("não funde tabelas homônimas de módulos diferentes", () => {
    const { finalDiagram } = parseMigrations(doisProjetos);
    const users = finalDiagram.nodes.filter((n) => n.label === "users");
    expect(users).toHaveLength(2);
    expect(users.map((n) => n.id).sort()).toEqual(["projeto-a.users", "projeto-b.users"]);

    // Cada uma mantém só as suas colunas — o bug antigo mesclava email + cpf numa tabela só.
    const colunas = (id: string) => finalDiagram.nodes.find((n) => n.id === id)!.columns.map((c) => c.name);
    expect(colunas("projeto-a.users")).toEqual(["id", "email"]);
    expect(colunas("projeto-b.users")).toEqual(["id", "cpf"]);
  });

  it("resolve a FK para a tabela do próprio módulo", () => {
    const { finalDiagram } = parseMigrations(doisProjetos);
    const dePedidos = finalDiagram.edges.find((e) => e.source === "pedidos");
    const deFaturas = finalDiagram.edges.find((e) => e.source === "faturas");
    expect(dePedidos?.target).toBe("projeto-a.users");
    expect(deFaturas?.target).toBe("projeto-b.users");
  });

  it("aponta references da coluna para o id do nó, não para o nome cru", () => {
    const { finalDiagram } = parseMigrations(doisProjetos);
    const fk = finalDiagram.nodes.find((n) => n.id === "faturas")!.columns.find((c) => c.name === "user_id");
    expect(fk?.references).toEqual({ table: "projeto-b.users", column: "id" });
  });

  it("separa os dois projetos em escopos distintos", () => {
    const { finalDiagram } = parseMigrations(doisProjetos);
    expect(finalDiagram.scopes.map((s) => s.id).sort()).toEqual(["projeto-a", "projeto-b"]);
    expect(finalDiagram.scopes.every((s) => s.tables === 2)).toBe(true);
  });

  it("mantém ids sem prefixo quando o nome não é ambíguo", () => {
    const { finalDiagram } = parseMigrations(doisProjetos);
    // "pedidos" e "faturas" existem em um módulo só — seguem com o nome puro, como antes.
    expect(finalDiagram.nodes.map((n) => n.id)).toContain("pedidos");
    expect(finalDiagram.nodes.map((n) => n.id)).toContain("faturas");
  });

  it("aplica ALTER TABLE só na tabela do módulo do arquivo", () => {
    const { finalDiagram } = parseMigrations([
      ...doisProjetos,
      {
        name: "V2__add.sql",
        path: "projeto-b/V2__add.sql",
        content: "ALTER TABLE users ADD COLUMN telefone VARCHAR(20);",
      },
    ]);
    const colunas = (id: string) => finalDiagram.nodes.find((n) => n.id === id)!.columns.map((c) => c.name);
    expect(colunas("projeto-b.users")).toContain("telefone");
    expect(colunas("projeto-a.users")).not.toContain("telefone");
  });

  it("DROP TABLE em um módulo preserva a homônima do outro", () => {
    const { finalDiagram } = parseMigrations([
      ...doisProjetos,
      { name: "V2__drop.sql", path: "projeto-a/V2__drop.sql", content: "DROP TABLE users;" },
    ]);
    const users = finalDiagram.nodes.filter((n) => n.label === "users");
    expect(users).toHaveLength(1);
    expect(users[0].scope).toBe("projeto-b");
  });

  it("desempata quando dois módulos terminam com o mesmo segmento", () => {
    const { finalDiagram } = parseMigrations([
      { name: "V1.sql", path: "a/db/V1.sql", content: "CREATE TABLE users (id INT NOT NULL PRIMARY KEY);" },
      { name: "V1.sql", path: "b/db/V1.sql", content: "CREATE TABLE users (id INT NOT NULL PRIMARY KEY);" },
    ]);
    expect(finalDiagram.nodes).toHaveLength(2);
    expect(new Set(finalDiagram.nodes.map((n) => n.id)).size).toBe(2);
  });
});

describe("migration-parser / DDL Oracle e multi-linha", () => {
  it("aplica ALTER TABLE multi-linha (ADD em bloco e FK quebrada em várias linhas)", () => {
    const result = parseMigrations([
      {
        name: "V1__init.sql",
        content:
          "CREATE TABLE pais (id NUMBER(19,0) NOT NULL PRIMARY KEY);\nCREATE TABLE filho (id NUMBER(19,0) NOT NULL PRIMARY KEY);",
      },
      {
        name: "V2__add.sql",
        content: `ALTER TABLE filho ADD (
  pais_id NUMBER(19, 0),
  nome VARCHAR2(30) DEFAULT 'x' NOT NULL
);
ALTER TABLE filho
  ADD CONSTRAINT FK_FILHO_PAIS FOREIGN KEY (pais_id)
  REFERENCES pais (ID);`,
      },
    ]);

    const filho = result.finalDiagram.nodes.find((n) => n.id === "filho")!;
    expect(filho.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["pais_id", "nome"]));
    const nome = filho.columns.find((c) => c.name === "nome")!;
    expect(nome.type).toBe("VARCHAR2(30)");
    expect(nome.isNullable).toBe(false);
    expect(result.finalDiagram.edges.find((e) => e.constraint === "FK_FILHO_PAIS")?.target).toBe("pais");
    expect(result.warnings).toHaveLength(0);
  });

  it("não cria coluna fantasma a partir de ADD CONSTRAINT ... UNIQUE/CHECK", () => {
    const result = parseMigrations([
      { name: "V1.sql", content: "CREATE TABLE t (id INT NOT NULL PRIMARY KEY, cpf VARCHAR(11));" },
      {
        name: "V2.sql",
        content: "ALTER TABLE t ADD CONSTRAINT UK_T_CPF UNIQUE (cpf);\nALTER TABLE t ADD CONSTRAINT CK_T CHECK (cpf <> '');",
      },
    ]);
    const t = result.finalDiagram.nodes.find((n) => n.id === "t")!;
    expect(t.columns.map((c) => c.name)).toEqual(["id", "cpf"]);
    expect(t.columns.some((c) => c.name.toUpperCase() === "CONSTRAINT")).toBe(false);
  });

  it("MODIFY ... NULL não corrompe o tipo da coluna", () => {
    const result = parseMigrations([
      {
        name: "V1.sql",
        content: "CREATE TABLE aluno (id INT NOT NULL PRIMARY KEY, cpf VARCHAR2(11) NOT NULL);",
      },
      { name: "V2.sql", content: "ALTER TABLE aluno MODIFY cpf NULL;" },
    ]);
    const cpf = result.finalDiagram.nodes
      .find((n) => n.id === "aluno")!
      .columns.find((c) => c.name === "cpf")!;
    expect(cpf.type).toBe("VARCHAR2(11)");
    expect(cpf.isNullable).toBe(true);
  });

  it("silencia DML, sequences, triggers e blocos PL/SQL (não viram warning)", () => {
    const result = parseMigrations([
      {
        name: "V1.sql",
        content: `CREATE TABLE log_t (id INT NOT NULL PRIMARY KEY);
CREATE SEQUENCE log_sq START WITH 1 INCREMENT BY 1 NOMAXVALUE NOCACHE ORDER;
INSERT INTO log_t (id) VALUES (1);
UPDATE log_t SET id = 2;
CREATE OR REPLACE TRIGGER log_tg BEFORE INSERT ON log_t FOR EACH ROW BEGIN :NEW.id := 1; END;
/
COMMIT;`,
      },
    ]);
    expect(result.finalDiagram.nodes.map((n) => n.id)).toContain("log_t");
    expect(result.warnings).toHaveLength(0);
    expect(result.snapshots[0].stats.ignoredStatements).toBeGreaterThan(0);
  });
});

describe("migration-parser / DDL Oracle exportado (aspas + schema)", () => {
  const exportCompleto = `-- Gerado por DBMS_METADATA
CREATE TABLE "NEXO"."ALUNOS"
   (	"ID" NUMBER(19,0) NOT NULL ENABLE,
	"NOME" VARCHAR2(150) NOT NULL ENABLE,
	"DATA NASCIMENTO" DATE,
	 CONSTRAINT "PK_NEXO_ALUNOS" PRIMARY KEY ("ID")
  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS
  TABLESPACE "NEXO_DATA"  ENABLE
   ) SEGMENT CREATION IMMEDIATE
  PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255
 NOCOMPRESS LOGGING
  TABLESPACE "NEXO_DATA" ;

CREATE TABLE "NEXO"."TURMAS"
   (	"ID" NUMBER(19,0) NOT NULL ENABLE,
	"ALUNO_ID" NUMBER(19,0),
	 CONSTRAINT "PK_NEXO_TURMAS" PRIMARY KEY ("ID")
   ) SEGMENT CREATION IMMEDIATE
  PCTFREE 10 TABLESPACE "NEXO_DATA" ;

ALTER TABLE "NEXO"."TURMAS" ADD CONSTRAINT "FK_TURMA_ALUNO" FOREIGN KEY ("ALUNO_ID")
	  REFERENCES "NEXO"."ALUNOS" ("ID") ENABLE;
/
`;

  it("reconhece CREATE TABLE com nome qualificado e entre aspas", () => {
    const result = parseMigrations([{ name: "V1__x.sql", content: exportCompleto }]);
    expect(result.warnings).toHaveLength(0);

    const ids = result.finalDiagram.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["ALUNOS", "TURMAS"]));

    const alunos = result.finalDiagram.nodes.find((n) => n.id === "ALUNOS")!;
    expect(alunos.schema).toBe("NEXO");
    expect(alunos.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["ID", "NOME", "DATA NASCIMENTO"])
    );
    expect(alunos.columns.find((c) => c.name === "NOME")?.isNullable).toBe(false);
    // Coluna com espaço no nome entre aspas não pode quebrar o parser.
    expect(alunos.columns.find((c) => c.name === "DATA NASCIMENTO")?.type).toBe("DATE");
  });

  it("reconhece FK declarada em ALTER TABLE com schema entre aspas", () => {
    const result = parseMigrations([{ name: "V1__x.sql", content: exportCompleto }]);
    const fk = result.finalDiagram.edges.find((e) => e.constraint === "FK_TURMA_ALUNO");
    expect(fk).toBeDefined();
    expect(fk?.source).toBe("TURMAS");
    expect(fk?.target).toBe("ALUNOS");
  });

  it("aceita schema sem aspas com tabela entre aspas e vice-versa", () => {
    const variantes = [
      `CREATE TABLE NEXO."ALUNOS" ( ID NUMBER(19,0) NOT NULL );`,
      `CREATE TABLE "NEXO".ALUNOS ( ID NUMBER(19,0) NOT NULL );`,
      `CREATE TABLE "NEXO"."ALUNOS" ( ID NUMBER(19,0) NOT NULL );`,
    ];
    for (const content of variantes) {
      const result = parseMigrations([{ name: "V1__x.sql", content }]);
      expect(result.warnings).toHaveLength(0);
      expect(result.finalDiagram.nodes.map((n) => n.id)).toContain("ALUNOS");
    }
  });

  it("reconhece DROP/ALTER/RENAME em tabela qualificada e com aspas", () => {
    const result = parseMigrations([
      { name: "V1__x.sql", content: `CREATE TABLE "NEXO"."ALUNOS" ( "ID" NUMBER(19,0) NOT NULL, "CPF" VARCHAR2(11) );` },
      { name: "V2__x.sql", content: `ALTER TABLE "NEXO"."ALUNOS" ADD "EMAIL" VARCHAR2(120);` },
      { name: "V3__x.sql", content: `ALTER TABLE "NEXO"."ALUNOS" RENAME COLUMN "CPF" TO "DOCUMENTO";` },
      { name: "V4__x.sql", content: `RENAME TABLE "NEXO"."ALUNOS" TO "NEXO"."DISCENTES";` },
      { name: "V5__x.sql", content: `DROP TABLE "NEXO"."DISCENTES";` },
    ]);
    expect(result.warnings).toHaveLength(0);

    const snap2 = result.snapshots[1].diagram.nodes.find((n) => n.id === "ALUNOS")!;
    expect(snap2.columns.map((c) => c.name)).toContain("EMAIL");

    const snap3 = result.snapshots[2].diagram.nodes.find((n) => n.id === "ALUNOS")!;
    expect(snap3.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["DOCUMENTO"]));
    expect(snap3.columns.map((c) => c.name)).not.toContain("CPF");

    expect(result.snapshots[3].diagram.nodes.map((n) => n.id)).toEqual(["DISCENTES"]);
    expect(result.snapshots[4].diagram.nodes).toHaveLength(0);
  });
});

describe("migration-parser / estatísticas por snapshot", () => {
  it("calcula delta de tabelas, colunas e FKs por snapshot", () => {
    const result = parseMigrations([
      {
        name: "V1.sql",
        content:
          "CREATE TABLE a (id INT NOT NULL PRIMARY KEY);\nCREATE TABLE b (id INT NOT NULL PRIMARY KEY, a_id INT REFERENCES a(id));",
      },
      { name: "V2.sql", content: "ALTER TABLE a ADD COLUMN nome VARCHAR(10);\nCREATE TABLE c (id INT NOT NULL PRIMARY KEY);" },
      { name: "V3.sql", content: "DROP TABLE b;" },
    ]);

    const [s1, s2, s3] = result.snapshots;
    expect(s1.stats.tables).toBe(2);
    expect(s1.stats.columns).toBe(3);
    expect(s1.stats.edges).toBe(1);
    expect([...s1.stats.addedTables].sort()).toEqual(["a", "b"]);

    expect(s2.stats.tables).toBe(3);
    expect(s2.stats.addedTables).toEqual(["c"]);
    expect(s2.stats.alteredTables).toEqual(["a"]);

    expect(s3.stats.tables).toBe(2);
    expect(s3.stats.removedTables).toEqual(["b"]);
  });
});

describe("migration-parser / qualidade Flyway-Oracle", () => {
  const parse = (content: string) => parseMigrations([{ name: "V1__x.sql", content }]);

  it("não gera warning para corpo de trigger PL/SQL com IF/END IF aninhados", () => {
    const result = parse(`
CREATE TABLE t (id NUMBER NOT NULL, criado TIMESTAMP);
CREATE OR REPLACE TRIGGER trg_t BEFORE INSERT ON t FOR EACH ROW
BEGIN
  IF :NEW.criado IS NULL THEN
    :NEW.criado := SYSTIMESTAMP;
  END IF;
  IF :NEW.id IS NULL THEN :NEW.id := 1; END IF;
END;
/
CREATE TABLE depois (id NUMBER);
`);
    expect(result.warnings).toEqual([]);
    expect(result.finalDiagram.nodes.map((n) => n.id).sort()).toEqual(["depois", "t"]);
  });

  it("trigger sem '/' ainda termina no END; e não engole o statement seguinte", () => {
    const result = parse(`
CREATE TRIGGER trg AFTER INSERT ON t FOR EACH ROW BEGIN INSERT INTO log VALUES (1); END;
CREATE TABLE seguinte (id INT);
`);
    expect(result.warnings).toEqual([]);
    expect(result.finalDiagram.nodes.map((n) => n.id)).toEqual(["seguinte"]);
  });

  it("protege ';' dentro de corpo $$ ... $$ (Postgres)", () => {
    const result = parse(`
CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN NEW.x := 1; RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TABLE a (id INT);
`);
    expect(result.warnings).toEqual([]);
    expect(result.finalDiagram.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("CREATE TABLE AS SELECT * copia as colunas da origem (sem PK/FK)", () => {
    const result = parse(`
CREATE TABLE origem (id NUMBER NOT NULL PRIMARY KEY, nome VARCHAR2(50));
CREATE TABLE origem_bkp_20250101 AS SELECT * FROM origem;
`);
    expect(result.warnings).toEqual([]);
    const bkp = result.finalDiagram.nodes.find((n) => n.id === "origem_bkp_20250101");
    expect(bkp?.columns.map((c) => c.name)).toEqual(["id", "nome"]);
    expect(bkp?.columns.some((c) => c.isPrimary)).toBe(false);
  });

  it("ALTER TABLE ... DROP ( a, b ) remove várias colunas (Oracle)", () => {
    const result = parse(`
CREATE TABLE t (id INT, a INT, b INT, c INT);
ALTER TABLE t DROP ( a, b );
`);
    expect(result.warnings).toEqual([]);
    expect(result.finalDiagram.nodes[0].columns.map((c) => c.name)).toEqual(["id", "c"]);
  });

  it("MODIFY ( ... ) em bloco atualiza tipo e nulidade de cada coluna", () => {
    const result = parse(`
CREATE TABLE t (a VARCHAR2(10), b NUMBER);
ALTER TABLE t MODIFY ( a VARCHAR2(100) NOT NULL, b NUMBER(10,2) );
`);
    const [a, b] = result.finalDiagram.nodes[0].columns;
    expect(a).toMatchObject({ type: "VARCHAR2(100)", isNullable: false });
    expect(b.type).toBe("NUMBER(10,2)");
  });

  it("reconhece PRIMARY KEY nomeada (CREATE e ALTER ADD CONSTRAINT)", () => {
    const result = parse(`
CREATE TABLE a (id INT NOT NULL, CONSTRAINT pk_a PRIMARY KEY (id));
CREATE TABLE b (x INT NOT NULL, y INT NOT NULL);
ALTER TABLE b ADD CONSTRAINT pk_b PRIMARY KEY (x, y);
`);
    const pk = (id: string) =>
      result.finalDiagram.nodes.find((n) => n.id === id)!.columns.filter((c) => c.isPrimary).map((c) => c.name);
    expect(pk("a")).toEqual(["id"]);
    expect(pk("b")).toEqual(["x", "y"]);
  });

  it("ADD ( CONSTRAINT fk ... ) em bloco não cria coluna chamada CONSTRAINT", () => {
    const result = parse(`
CREATE TABLE pai (id INT PRIMARY KEY);
CREATE TABLE filho (id INT, pai_id INT);
ALTER TABLE filho ADD ( CONSTRAINT fk_f FOREIGN KEY (pai_id) REFERENCES pai (id) );
`);
    const filho = result.finalDiagram.nodes.find((n) => n.id === "filho")!;
    expect(filho.columns.map((c) => c.name)).toEqual(["id", "pai_id"]);
    expect(result.finalDiagram.edges).toHaveLength(1);
  });

  it("cláusulas depois do corpo do CREATE TABLE não viram colunas", () => {
    const result = parse(`
CREATE TABLE t (id INT, nome VARCHAR(10)) TABLESPACE users STORAGE (INITIAL 64K);
`);
    expect(result.warnings).toEqual([]);
    expect(result.finalDiagram.nodes[0].columns.map((c) => c.name)).toEqual(["id", "nome"]);
  });

  it("ordena versões Flyway com 4+ partes numericamente", () => {
    const result = parseMigrations([
      { name: "V1.2.10.1__b.sql", content: "CREATE TABLE b (id INT);" },
      { name: "V1.2.9.5__a.sql", content: "CREATE TABLE a (id INT);" },
      { name: "V1.2.10.0__c.sql", content: "CREATE TABLE c (id INT);" },
    ]);
    expect(result.snapshots.map((s) => s.migrationName)).toEqual([
      "V1.2.9.5__a.sql",
      "V1.2.10.0__c.sql",
      "V1.2.10.1__b.sql",
    ]);
  });
});

