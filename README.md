This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Servidor MCP (AI Modeling)

O módulo **Modelagem IA** do workbench pode ser dirigido por agentes externos (Claude Code, Codex, Devin etc.) via MCP. As sessões, turnos e diagramas são os mesmos da interface — com a aba "Modelagem IA" aberta, as mudanças feitas pelo agente aparecem automaticamente (polling de ~2,5s).

Há dois transportes:

- **stdio** — local, um processo por agente (Claude Code, Codex CLI, Windsurf).
- **HTTP Streamable** — remoto, com Bearer token. Cada cliente MCP recebe um `mcp-session-id` próprio; conexão/sessão sticky não vazam entre agentes.

### Rodar standalone

```bash
npm run mcp          # stdio
npm run mcp:http     # HTTP Streamable (requer MCP_HTTP_TOKEN)
```

### Configurar no Claude Code (stdio)

```json
// ~/.claude.json
{
  "mcpServers": {
    "ai-modeling": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/home/eduardo/projetos/meu-diagram-viewer/workbench-web"
    }
  }
}
```

Para Codex CLI e Windsurf, a configuração equivalente fica em `~/.codex/config.toml` e `.windsurf/mcp_config.json`.

### Configurar um agente remoto (HTTP)

```bash
MCP_HTTP_TOKEN=um-segredo-longo npm run mcp:http
# escuta 127.0.0.1:3847/mcp por padrão
```

No cliente (Devin, Codex remoto etc.), aponte para `http://<host>:3847/mcp` com header `Authorization: Bearer um-segredo-longo`.

### Variáveis de ambiente (opcionais)

- `MCP_USER_ID` — dono das conexões. Omitido = dono da conexão atualizada mais recentemente.
- `MCP_CONNECTION_ID` — conexão ativa inicial.
- `MCP_ALLOWED_CONNECTIONS` — allowlist por nome/id separada por vírgula (ex: `loja-dev,loja-homolog`); conexões fora da lista ficam invisíveis para o agente.
- `MCP_ALLOWED_ENVIRONMENTS` — filtra conexões pelas tags `dev` / `homolog` / `prod` / `staging` / `local` / `test`.
- `MCP_REQUIRE_ENV_TAG=1` — esconde conexões sem tag de ambiente quando a allowlist de ambientes está ativa.
- `MCP_TRANSPORT=http` — equivalente a `npm run mcp:http`.
- `MCP_HTTP_TOKEN` — Bearer obrigatório no transporte HTTP (vários tokens separados por vírgula).
- `MCP_HTTP_HOST` / `MCP_HTTP_PORT` — bind do HTTP (padrão `127.0.0.1:3847`).
- `MCP_HTTP_ALLOWED_HOSTS` — hostnames extras para proteção contra DNS rebinding.

### Quem faz a análise: o agente ou a LLM da sessão

Dois caminhos para alterar o modelo:

- **`modeling_apply_ops` (padrão)** — o agente (Claude Code, Codex...) faz a análise do pedido e envia as operações estruturadas prontas. A sessão **só persiste** o resultado: turno, diagrama, checkpoint e memória. Não gasta cota de nenhuma LLM configurada no workbench.
- **`modeling_send_message`** — envia texto para a LLM configurada na sessão (Gemini/OpenRouter/Nvidia), que analisa e gera as operações. Use só quando o usuário pedir explicitamente esse modelo.

### Tools expostas

- `list_connections` / `use_connection` — ver e fixar a conexão de trabalho (respeita allowlist e ambiente)
- `modeling_list_sessions` / `modeling_create_session` / `use_session` / `modeling_delete_session`
- `modeling_get_session` / `modeling_get_diagram` — histórico de turnos e diagrama completo
- `modeling_apply_ops` — aplica operações estruturadas (`createTable`, `addColumn`, `addForeignKey`...) analisadas pelo próprio agente, com diff de tabelas na resposta
- `modeling_send_message` — instrução em linguagem natural analisada pela LLM da sessão
- `modeling_revert` — volta o diagrama para o estado de um turno anterior
- `modeling_export_sql` — gera o DDL (MySQL/Postgres); `saveAsPackage=true` também grava um package de migrations
- `modeling_set_memory` — liga/desliga a memória do projeto e aponta o `project_id` do CodeGraph
- `modeling_status` — provedores de LLM, conexão/sessão ativas, allowlist e ambiente

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
