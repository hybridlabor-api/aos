![AOS — BDB Agent OS](assets/header-v4.jpg)

🌐 **Language / Sprache / Idioma**: [ 🇬🇧 English ](README.md) | [ 🇩🇪 Deutsch ](README.de.md) | **Português**

# AOS — BDB Agent OS

[![NPM Version](https://img.shields.io/npm/v/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![CI](https://github.com/hybridlabor-api/aos/actions/workflows/ci.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)

AOS instala uma biblioteca de skills curada, um roster de subagentes, hooks de portão e um pipeline multi-agente executável em todos os harnesses de agentes de código da sua máquina.

```bash
npx -y @hybridlabor-api/aos@latest
```

Construído para pessoas que já executam **Claude Code, Google Antigravity, Codex CLI, OpenCode, Cursor, Windsurf, Roo Code / Cline ou Aider** e querem que todos eles se comportem da mesma forma.

Após a instalação, você tem:

- **<!-- count:skills -->213<!-- /count --> skills** em seis categorias, descobríveis por cada harness como `<name>/SKILL.md`.
- **<!-- count:agents -->13<!-- /count --> subagentes** (Architect, TechLead, Reviewer, os Godmodes, revisores de segurança e falhas silenciosas) compilados em cada formato nativo de agente do harness.
- **<!-- count:mcps -->21<!-- /count --> servidores MCP** para software criativo, controle de SO, memória e delegação entre harnesses.
- **Três pipelines** — `/startcycle`, `/startcycle-graph`, `/startcycle-graph-user` — e um **portão GO** que bloqueia mecanicamente `git push`, `npm publish`, `npm version` e `rm` recursivo.
- **Ferramentas:** Plan Canvas, agenttrail, archify, AOS Store, dashboard Launchpad e `aos doctor`.

---

## Instalar

Requisitos: Node.js >= 20. macOS, Linux e Windows (PowerShell).

```bash
npx -y @hybridlabor-api/aos@latest
```

**Primeira execução.** O instalador detecta quais harnesses estão presentes, pergunta quais são os alvos e qual camada (Pro MEDIA ou Basic), copia as skills em cada diretório de skills do harness, compila os subagentes, conecta os hooks, mescla a configuração MCP em cada arquivo de configuração próprio do harness (entradas existentes são mantidas) e oferece os módulos opcionais listados abaixo.

**Toda execução posterior** abre um menu:

| Item do menu | O que faz |
|---|---|
| Quick Update | Atualiza skills, templates, hooks e módulos instalados para a versão que você acabou de executar |
| Run System Checkup / Doctor | Executa `aos doctor`: dependências, posicionamento de arquivos, daemons, hooks |
| Drop Local Project Harness | Copia o contrato do dispatcher no diretório atual (veja abaixo) |
| Reconfigure System | Muda alvos, camada ou opções |
| Uninstall AOS | Remove o que o instalador colocou; seus dados permanecem |

### Não-interativo

```bash
npx -y @hybridlabor-api/aos@latest -y --platforms=2          # Claude only, all defaults
npx -y @hybridlabor-api/aos@latest -y --platforms=1,5 --mcps=none
npx -y @hybridlabor-api/aos@latest --dry-run                 # print what would change
```

`--platforms=` valores: `0` universal (todos detectados), `1` Antigravity, `2` Claude Desktop / Claude Code, `3` Cursor, `5` Codex CLI, `6` Windsurf, `7` Roo Code / Cline, `8` Aider, `10` AOS CLI. `4` (caminhos personalizados) precisa do menu interativo. `--mcps=<name,name>|all|none` escolhe o subconjunto de MCP. `--verbose` e `--no-intro` fazem o que dizem.

### Harness local do projeto

Em vez de instalar em `$HOME`, solte apenas o contrato do dispatcher (`.agents/`, os hooks do portão, as definições de agentes, o workflow `/startcycle-graph`, o plugin OpenCode) em um repositório:

```bash
cd your-project && npx -y @hybridlabor-api/aos@latest --project-harness -y
```

---

## Harnesses suportados

O que o instalador escreve para cada alvo. Os caminhos são os padrões; o instalador apenas escreve em harnesses que realmente detecta.

| Harness | Skills | Subagentes | Hooks | Plugin / regras |
|---|---|---|---|---|
| Claude Code / Claude Desktop | `~/.claude/skills` | `~/.claude/agents` | `~/.claude/hooks` + `settings.json` (portão GO, portão de grafo, proteção de arquivo de env, Conventional Commits, injeção memB, retransmissão de trail) | manifesto `.claude-plugin/` enviado no repo (veja Contributing) |
| Google Antigravity | `~/.gemini/config/skills` | `~/.gemini/config/agents` | `~/.gemini/config/hooks.json` e `~/.gemini/antigravity-cli/hooks.json` | — |
| Codex CLI | `~/.codex/skills` | `~/.codex/agents` | `~/.codex/hooks` + `config.toml` | `.codex-plugin/` |
| OpenCode | `~/.config/opencode/skills` | `~/.opencode/agents` | via plugin | plugin `bdb-aos.js` + comando `/startcycle-graph`, registrado em `opencode.jsonc`; mantém uma execução `/startcycle-graph` em movimento em `session.idle` |
| Cursor | `~/.cursor/skills` | — | — | `.cursor/rules` (projeto) |
| Windsurf | `~/.windsurf/bdb-skills` | — | — | `mcp.json` |
| Roo Code / Cline | `~/.roo/skills` | — | — | `.roomodes` (projeto) |
| Aider | `~/.aider/bdb-skills` | — | — | — |
| AOS CLI (`pi`) | lê `~/.agents/skills` | `~/.agents/AGENTS.md` como prompt do sistema | — | sem MCP; instalação separada, Node >= 22.19 — veja [packages/aos-cli](packages/aos-cli/README.md) |

Toda instalação também escreve a cópia universal em `~/.agents/skills`, que é o que a CLI AOS e a CLI `skills` leem.

---

## Os pipelines

O contrato vive em [`.agents/graph.md`](.agents/graph.md), o roster de nós em [`.agents/nodes.json`](.agents/nodes.json), o dispatcher executável em [`.claude/workflows/startcycle-dispatch.mjs`](.claude/workflows/startcycle-dispatch.mjs).

**Uma regra: nós nunca invocam uns aos outros.** Um dispatcher lê `production_artifacts/state.json` após cada nó retornar e decide o que executa a seguir. Não há cadeia de repasse e nenhum agente dizendo a outro agente para prosseguir.

```mermaid
flowchart LR
    U(["User"]) --> A["Architect"] --> T["TechLead"]
    T --> UX["Godmode_UI_UX"] & EN["Godmode_Engineering"] & ME["Godmode_Media"]
    UX & EN & ME --> R["Reviewer"] --> S["Shipping"]
    T -.->|reject| A
    R -.->|findings| UX
    R -.->|needs_human| U
```

| Comando | Mecanismo | Use quando |
|---|---|---|
| `/startcycle` | Cadeia linear, repasses de arquivo em `production_artifacts/`. Nenhuma máquina de estado, nenhum loop de reparo. `/startcycle --skill=<name> <goal>` força uma skill em cada nó. | Uma compilação direta com o roster de agentes mas sem a cerimônia. |
| `/startcycle-graph` | O grafo completo: `state.json` durável, loop de reparo do Reviewer, portão de qualidade automatizado, escalonamento para humanos. | Trabalho de feature onde a correção importa mais que velocidade e você quer um rastro de auditoria. |
| `/startcycle-graph-user` | Fan-out de 2–4 nós descartáveis. Nada persistente. Modelo em camadas por função; usa Antigravity, OpenCode ou Codex se instalado, subagentes Claude Code caso contrário. | Um "spawn de alguns workers" único em qualquer projeto. |

O que mantém o grafo completo honesto:

| Mecanismo | O que previne |
|---|---|
| Isolamento do Reviewer | O Reviewer lê artefatos e o contrato do plano, nunca o raciocínio do nó de compilação ou sua alegação de que está pronto. |
| Guarda de falta de progresso | Um ciclo de reparo que relata o mesmo ID de achado bloqueador da anterior escala para um humano em vez de queimar iterações. |
| Fragmentos de estado por nó | Nós de compilação paralelos escrevem `state.d/<node>.json`; o dispatcher mescla. Sem corrida de atualização perdida em um arquivo. |
| Teto de iteração | `max_iterations` (padrão 3) para o loop incondicionalmente. |
| Borda humana no-loop | Qualquer nó pode definir `needs_human: true` e parar a execução. |

## O portão GO

Alcançar `ready_to_ship` não é enviar. [`.claude/hooks/go-gate.mjs`](.claude/hooks/go-gate.mjs) é um hook `PreToolUse` que bloqueia `git push`, `npm publish`, `npm version` e `rm` recursivo a menos que sua mensagem imediatamente anterior seja a palavra literal **GO**. É um hook, não uma regra que um agente é convidado a respeitar: dispara antes de qualquer verificação de modo de permissão e não pode ser contornado. O instalador conecta o mesmo portão em Antigravity, Codex e OpenCode; em harnesses sem suporte a hook, a regra em [AGENTS.md](AGENTS.md) se aplica e o agente é a execução. Um subagente nunca herda o GO do seu orquestrador, e um comando de lançamento falhado precisa de um novo.

---

## Ferramentas

| Ferramenta | Comando | O que faz |
|---|---|---|
| Plan Canvas | `aos-plan-canvas open <file>` (skill `plan-canvas`) | Abre um plano ou artefato HTML em um canvas de navegador local onde você anota elementos, conversa e aprova ou solicita mudanças. Planos dos pipelines abrem aqui por padrão. |
| agenttrail | `aos-trail` (skill `agenttrail`, porta 5330) | Quadro ao vivo de uma compilação multi-agente: qual componente, qual agente ou harness, o que está pronto, o que está preso. Alimentado pelos hooks trail-relay e por `mcsc`. |
| archify | `aos-archify` (skill `archify`) | Arquitetura validada, sequência, fluxo de dados e diagramas de estado como HTML autossuficiente com exportação SVG; aceita Mermaid. |
| AOS Store | `aos store list \| search <q> \| install <name> [--project]`, `aos store ui` (também `aos-store`, comando slash `/aos-store`) | Procure e instale skills e agentes AOS Core e ECC. A interface web em `http://127.0.0.1:4322` mostra o que está instalado, visualiza o exato caminho de alvo e instala apenas após você confirmar. Skills multi-arquivo são instaladas completamente. `list` e `search` leem um índice fixo offline. |
| Launchpad | `aos-dashboard [--port 7900] [--no-open]` | Uma página com todos os serviços BDB locais (memB, Synapse, OpenWiki, AO, Remote, AOS Store): status, iniciar/parar, logs. Registrado como entrada de inicialização automática. |
| Doctor | `aos doctor [--json] [--net]` (também `aos-doctor`) | Verifica dependências, posicionamento de skills por harness, daemons, hooks e módulos; sai com 1 quando algo precisa de atenção. A primeira coisa a executar quando algo se comporta mal. |
| Config | `aos-config show \| propose \| set <key> <value>` | Nível de máquina `~/.agents/aos-config.json`: raiz do workspace, domínios, id do usuário. |
| mcsc | Ferramentas MCP `delegate_agy`, `delegate_opencode`, `delegate_codex`, `delegate_smart` (skill `mcsc`) | Delega uma tarefa a outro harness CLI instalado e transmite suas chamadas de ferramenta para agenttrail. Preferido sobre shell out para a CLI. |

---

## Memória e conhecimento

Instalado como módulos opcionais pelo instalador; `aos doctor` os verifica e o Launchpad os mostra.

- **memB** (`@hybridlabor-api/memb`) — memória vetorial local, offline com servidor MCP (`add_memory`, `search_memory`, `list_memories`, `delete_memory`), WebUI na porta 8088 e hook ambiente que injeta memórias relevantes em sessões Claude Code. Skills: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.
- **deja** (`@vshulcz/deja-vu`, instalado com memB) — indexa seus transcritos de agentes localmente com segredos redatados; `deja fix` em um erro, `deja wip` ao retomar, `deja search` para sessões passadas. Skill: `deja-memory`.
- **OpenWiki** (CLI `openwiki`) — gera e atualiza uma wiki fundamentada de uma base de código, com um visualizador na porta 4321 e um daemon de fundo. Skill: `openwiki-skill`; a própria wiki deste repo está sob [`.openwiki/`](.openwiki/quickstart.md).
- **Synapse** (`@hybridlabor-api/bdb-synapse`) — renderiza um repositório como uma cidade de código 3D e repassa sessões de agentes através dela. Skill: `synapse-integration-skill`.

`aos-setup` traz uma máquina para um estado verificado para todos os quatro; `aos-project-init` vincula um projeto a eles (slug, wiki, memória, `AGENTS.md`).

---

## Skills

<!-- count:skills -->213<!-- /count --> skills, cada uma um diretório com um `SKILL.md` cujo frontmatter declara `name`, `description` e uma `category`: `bdb-core`, `design-ui-ux`, `engineering-method`, `engineering-hardware`, `media-eventtech`, `library`. O catálogo completo está em [docs/skills_table.md](docs/skills_table.md).

Os sete **Godmodes** sob `skills/basic` são a camada de persona; três deles são os nós de compilação e envio do grafo.

| Godmode | Possui |
|---|---|
| `godmode-engineering` | DDD, Clean Architecture, TypeScript rigoroso, depuração sistemática. O nó `Engineering`. |
| `godmode-ui-ux` | Frontend anti-slop, tokens DTCG, movimento, acessibilidade. O nó `UI_UX`. |
| `godmode-shipping` | Verificações pré-lançamento, portão de qualidade, rollback seguro. O nó `Shipping`. |
| `godmode-eventtech` | Controle de shows, fluxo de sinais, protocolos, hardware de evento ao vivo. |
| `godmode-3d-creation` | Geração 3D primeiro MCP, reconstrução de malha, CAD paramétrico. |
| `godmode-media-creation` | Vídeo, montagem de timeline, pipelines de design de movimento. |
| `godmode-hardware-pcb` | Esquemáticos, layout de PCB, portão KiCad ERC/DRC/DFM, co-design de invólucro. |

Outros pontos de entrada que valem a pena conhecer: `ask-tim` (qual skill se encaixa), `bdbrainstorm` e `bdbmediastorm` (ideação multi-agente terminando em um plano), `teamwork-preview` (elaboração de prompt e delegação), a família `grilling` (`grill-me`, `grill-with-docs`, `triage`), `ci-pipeline` e os geradores e validadores `github-actions-*` / `dockerfile-*` / `makefile-*`, `bdb-security-audit`, `bdbresilience`.

A biblioteca também é legível pela CLI `skills`:

```bash
npx skills add hybridlabor-api/aos
```

---

## Servidores MCP

[`mcp_config.json`](mcp_config.json) define <!-- count:mcps -->21<!-- /count --> servidores, construídos ou aquecidos pelo instalador de `mcps/` e mesclados em cada configuração MCP do harness:

- **Software criativo:** Unreal Engine, Rhino / Grasshopper (primário + fallback), DaVinci Resolve, Blender, After Effects (primário + fallback), ponte Adobe UXP, TouchDesigner (MindDesigner `tdmcp` + backup), grandMA3, Resolume, Open Design.
- **Controle de SO:** `zavora_computer_use` (macOS / Linux, binário nativo), `bdb_windows_computer_use`.
- **Memória e delegação:** `memb_mcp`, `deja`, `mcsc`.
- **Infraestrutura:** `github`, `chrome-devtools`, `bdb_remoteos_mcp` (gateway multi-nuvem com aprovações 4-olhos).

Cada servidor criativo tem uma skill de guia (`bdb-unreal-mcp`, `bdb-touchdesigner-mcp`, `bdb-davinci-mcp`, ...) que ensina ao agente as assinaturas de ferramenta. Portas por servidor, pares primário/fallback e notas de plataforma: [docs/mcp-servers.md](docs/mcp-servers.md).

---

## Módulos opcionais

O seletor de módulo do instalador oferece, e Quick Update mantém atual:

| Módulo | Pacote |
|---|---|
| memB | `@hybridlabor-api/memb` |
| Synapse | `@hybridlabor-api/bdb-synapse` |
| Heimdall Token Saver (hooks de compressão de saída CLI) | `@hybridlabor-api/heimdall-token-saver` |
| AO — Agent Orchestrator (agentes paralelos em Git worktrees) | `@hybridlabor-api/bdb-agent-orchestrator` |
| Creator Extension (ComfyUI, image-to-3D, vídeo) | `@hybridlabor-api/bdb-dev-creator-extension` |
| Hardware & PCB (módulo de design KiCad e OpenSCAD, orientado por `godmode-hardware-pcb`) | `@hybridlabor-api/bdb-hardware-pcb` |
| OS Remote (gateway de execução remota) | `@hybridlabor-api/bdb-os-remote` |

Detalhes para cada: [docs/ecosystem.md](docs/ecosystem.md).

---

## Atualizando

Execute o mesmo comando novamente. O instalador vê a versão instalada, oferece **Quick Update** e atualiza skills, hooks, templates e módulos:

```bash
npx -y @hybridlabor-api/aos@latest
```

Não há um subcomando `aos update`. Se você uma vez executou `npm i -g @hybridlabor-api/aos`, um simples `aos` no seu PATH executa essa cópia congelada e sua versão, não a mais recente; ou atualize (`npm i -g @hybridlabor-api/aos@latest`) ou remova e fique com `npx`. O instalador imprime o comando de atualização em si sempre que uma versão mais recente existe; a skill `bdb-updater` envolve a mesma verificação para uso dentro de uma sessão.

## Desinstalar

```bash
aos-uninstall              # removes what AOS installed; memory, wikis and credentials stay
aos-uninstall --purge      # also removes ~/.MemBDB, ~/.openwiki, ~/.synapse, ~/.memb
aos-uninstall --dry-run    # list everything, delete nothing
```

O desinstalador funciona a partir do manifesto de instalação: um arquivo que ainda corresponde ao hash que AOS escreveu é removido, um arquivo que você editou é de backup, um arquivo que AOS nunca escreveu não é tocado. A mesma ação está no menu do instalador.

---

## Contribuindo

- [AGENTS.md](AGENTS.md) é a única fonte de regras para cada harness: o contrato de skill, roteamento de categoria, o portão de lançamento, Conventional Commits.
- Uma skill é um diretório com `SKILL.md`; o frontmatter precisa de `name` (igual ao diretório), `description` e uma `category`: `bdb-core`, `design-ui-ux`, `engineering-method`, `engineering-hardware`, `media-eventtech`, `library`. `npm run validate` executa o contrato, assim como CI em cada push.
- `npm test` executa o self-test do validador, verificação do manifesto plugin e testes do instalador, store, doctor e hooks entre harnesses.
- `.claude-plugin/plugin.json` e `marketplace.json` são gerados por `npm run plugin:build` e verificados por `npm run plugin:check`. Existem hoje; o caminho de instalação do marketplace Claude Code ainda está sendo finalizado, então o instalador acima permanece a rota suportada.
- Releases são cortadas pelo release-please de Conventional Commits; não bump `package.json` manualmente. `feat:` significa um bump menor.
- Skills derivadas de outros projetos registram `source:` no frontmatter e uma entrada em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Links

- Pacote: [npmjs.com/package/@hybridlabor-api/aos](https://www.npmjs.com/package/@hybridlabor-api/aos)
- Fonte e issues: [github.com/hybridlabor-api/aos](https://github.com/hybridlabor-api/aos) · [issues](https://github.com/hybridlabor-api/aos/issues)
- [CHANGELOG.md](CHANGELOG.md) · [docs/skills_table.md](docs/skills_table.md) · [docs/cli.md](docs/cli.md) · [docs/mcp-servers.md](docs/mcp-servers.md) · [docs/ecosystem.md](docs/ecosystem.md)
- Repos irmãos: [bdb-agent-orchestrator](https://github.com/hybridlabor-api/bdb-agent-orchestrator) · [bdb-synapse](https://github.com/hybridlabor-api/bdb-synapse) · [bdb-dev-creator-extension](https://github.com/hybridlabor-api/bdb-dev-creator-extension) · [bdb-hardware-pcb](https://github.com/hybridlabor-api/bdb-hardware-pcb) · [bdb-os-remote](https://github.com/hybridlabor-api/bdb-os-remote)

Licença: [Apache-2.0](LICENSE).
