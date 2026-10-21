<div align="center">

![AOS — BDB Agent OS](assets/header-v5.png)

**Language / Sprache / Idioma**: [English](README.md) · [Deutsch](README.de.md) · **Português**

# AOS — BDB Agent OS

[![NPM Version](https://img.shields.io/npm/v/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![NPM Downloads](https://img.shields.io/npm/dw/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![GitHub stars](https://img.shields.io/github/stars/hybridlabor-api/aos?style=flat&color=gold)](https://github.com/hybridlabor-api/aos/stargazers)
[![last commit](https://img.shields.io/github/last-commit/hybridlabor-api/aos.svg)](https://github.com/hybridlabor-api/aos/commits/main)
[![CI](https://github.com/hybridlabor-api/aos/actions/workflows/ci.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)
[![skills](https://img.shields.io/badge/skills-270%20curated-brightgreen.svg)](#skills)
[![MCPs](https://img.shields.io/badge/local%20MCPs-21-brightgreen.svg)](#servidores-mcp)
[![harnesses](https://img.shields.io/badge/harnesses-9%20supported-blueviolet.svg)](#harnesses-suportados)
[![SkillSpector](https://github.com/hybridlabor-api/aos/actions/workflows/skillspector.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions/workflows/skillspector.yml)
[![skills.sh](https://img.shields.io/badge/skills.sh-listed-black.svg)](https://skills.sh/hybridlabor-api/aos)

[![agents](https://img.shields.io/badge/subagents-45-orange.svg)](#os-subagents-45)
[![commands](https://img.shields.io/badge/commands-15-blue.svg)](#ver-tudo)
[![playbooks](https://img.shields.io/badge/playbooks-36-informational.svg)](#playbooks)
[![A2A](https://img.shields.io/badge/A2A-Claude%20%C2%B7%20OpenCode%20%C2%B7%20agy%20%C2%B7%20Codex-0b7285.svg)](#a2a-sess%C3%B5es-que-conversam-entre-si)
[![MCP gateway](https://img.shields.io/badge/MCP%20gateway-default-teal.svg)](#gateway-mcp-e-um-mcp-por-app)
[![go-gate](https://img.shields.io/badge/go--gate-hook--enforced-red.svg)](#o-go-gate)

<p align="center">
  <b>O sistema operativo para harnesses de agentes de IA.</b><br/>
  Uma instalação: as mesmas skills em nove harnesses. Subagents e o GO gate imposto por hook no Claude Code, Antigravity, Codex e OpenCode.
</p>

<p align="center">
  Feito para <b>técnicos de eventos e media</b>, <b>designers</b> e <b>gestores</b>, para <b>construtores de instalações à medida</b> (show control, 3D, PCB e caixas), e tanto para o <b>trabalho de código do dia a dia</b>: apps, ferramentas e plugins. A biblioteca de skills e os servidores MCP cobrem os dois mundos.
</p>

O AOS instala uma biblioteca de skills curada, um roster de subagents, gate hooks e uma pipeline de build multi-agente executável em cada harness de agente de código da sua máquina.

```bash
npx -y @hybridlabor-api/aos@latest
```

<p align="center">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-D97757?logo=anthropic&logoColor=white">
  <img alt="Antigravity" src="https://img.shields.io/badge/Google%20Antigravity-4285F4?logo=google&logoColor=white">
  <img alt="Codex CLI" src="https://img.shields.io/badge/Codex%20CLI-412991?logo=openai&logoColor=white">
  <img alt="OpenCode" src="https://img.shields.io/badge/OpenCode-111827">
  <img alt="Cursor" src="https://img.shields.io/badge/Cursor-000000?logo=cursor&logoColor=white">
  <img alt="Windsurf" src="https://img.shields.io/badge/Windsurf-0B100F">
  <img alt="Roo Code / Cline" src="https://img.shields.io/badge/Roo%20Code%20%2F%20Cline-5B21B6">
  <img alt="Aider" src="https://img.shields.io/badge/Aider-14B814">
  <img alt="AOS CLI" src="https://img.shields.io/badge/AOS%20CLI-pi--based-0d1117">
</p>

<sub>Recomendado: o instalador completo acima. Em alternativa, a skills CLI:</sub>

<table>
<tr>
<td width="100%" valign="top" align="left"><b>Instalar apenas skills</b><br/><br/><code>npx skills add hybridlabor-api/aos</code><br/><br/><sub>Gate hooks e servidores MCP exigem o instalador completo. O caminho do marketplace de plugins está em curso; ver <a href="#plugins-e-marketplace">Plugins e marketplace</a>.</sub></td>
</tr>
</table>

<sub>As skills usam o formato aberto <a href="https://agentskills.io">Agent Skills</a> (<code>SKILL.md</code>). O AOS instala-as para <b>Claude Code, Google Antigravity, Codex CLI, OpenCode, Cursor, Windsurf, Roo Code / Cline, Aider e a AOS CLI</b>, para que todos se comportem da mesma forma.</sub>

<p align="center">
  <img src="docs/assets/readme/architecture-hero.svg" alt="Como o AOS se encaixa: nove harnesses alimentam um kernel de 270 skills, 45 subagents, gate hooks e 21 servidores MCP, que move três pipelines, mensagens de sessão para sessão e ferramentas locais, com o GO gate à frente de cada comando de release" width="100%">
</p>

</div>

---

## Porquê o AOS

| | Padrão do harness | Com o AOS |
|---|---|---|
| **Skills** | Cada harness tem a sua própria pasta de skills e as suas próprias cópias. | <!-- count:skills -->270<!-- /count --> skills em oito categorias, escritas como `<name>/SKILL.md` em todos os harnesses que tiver. Uma única árvore de código-fonte. |
| **Subagents** | Ficheiros de agente escritos à mão, por harness, no formato desse harness. | <!-- count:agents -->45<!-- /count --> subagents compilados para o formato nativo de agente de cada harness (Claude Code, Antigravity, Codex, OpenCode; os outros usam regras no AGENTS.md). |
| **Segurança de release** | Uma regra num prompt que se pede ao agente para respeitar. | Um hook `PreToolUse` (Claude Code, Antigravity, Codex, OpenCode) ou regras no AGENTS.md (os outros) que bloqueia `git push`, `npm publish`, `npm version` e `rm` recursivo até a sua própria mensagem ser a palavra literal **GO**. |
| **Builds multi-agente** | Agentes que chamam agentes, com o roteamento dentro dos seus prompts. | Um dispatcher graph: os nós nunca se invocam entre si, o estado é durável, um repair loop tem um no-progress guard e a escalada vai para você. |
| **Planos** | Desfazer o scroll no chat para encontrar o que foi acordado. | Plan Canvas: anotar o plano no navegador e aprovar antes de qualquer agente construir. |
| **Visibilidade** | Ler logs em vários terminais. | Mapa em vivo do agenttrail por repositório, e uma fleet band no Claude Code com o modo do gate, o tempo dos tokens e quem espera pelo seu GO. |
| **Sessões** | Cada sessão está sozinha no seu terminal. | A2A entre sessões vivas de Claude Code, OpenCode, agy e Codex no localhost. Uma mensagem recebida nunca é um GO. |
| **Além do código** | Assistentes de código conhecem código. | 19 skills de media-eventtech e servidores MCP para grandMA3, Resolume, TouchDesigner, Unreal, DaVinci, After Effects, Blender e Rhino; `godmode-hardware-pcb` para KiCad e OpenSCAD; playbooks para orçamentos, faturas, crew call sheets e event trackers. |

## O que recebe

<table>
<tr>
<td width="33%" valign="top">🎯 <b>Skills</b><br/>270 skills curadas em oito categorias, descobertas por cada harness como <code>&lt;name&gt;/SKILL.md</code>.<br/>→ <a href="#skills-de-um-relance">Skills de um relance</a></td>
<td width="33%" valign="top">👥 <b>Subagents</b><br/>45 subagents: Architect, TechLead, Reviewer, Godmodes e revisores especializados.<br/>→ <a href="#o-dispatcher-graph">O dispatcher graph</a></td>
<td width="33%" valign="top">🔌 <b>Servidores MCP</b><br/>21 servidores para software criativo, controlo do SO, memória e delegação entre harnesses.<br/>→ <a href="#servidores-mcp">Servidores MCP</a></td>
</tr>
<tr>
<td width="33%" valign="top">🚀 <b>Pipelines &amp; GO gate</b><br/><code>/fabric</code>, <code>/fabric-graph</code>, <code>/fabric-multigraph</code>, e o gate de release imposto por hook.<br/>→ <a href="#as-pipelines">As pipelines</a></td>
<td width="33%" valign="top">💬 <b>Sessões que conversam</b><br/>A2A entre sessões de Claude Code, OpenCode, agy e Codex no localhost.<br/>→ <a href="#a2a-sess%C3%B5es-que-conversam-entre-si">A2A</a></td>
<td width="33%" valign="top">🛠️ <b>Ferramentas</b><br/>Plan Canvas, agenttrail, archify, AOS Store, AOS Hub, aos sessions, fleet band, aos doctor.<br/>→ <a href="#skills-de-um-relance">Ferramentas</a></td>
</tr>
</table>

<table>
<tr>
<td width="20%" valign="top"><b>Eventos &amp; media tech</b><br/>• Show control em vivo: grandMA3, Resolume, TouchDesigner<br/>• Produção de media: Unreal, DaVinci, After Effects</td>
<td width="20%" valign="top"><b>Design</b><br/>• Sistema de design UI/UX e brand discovery<br/>• Landing pages, redesigns de apps, Plan Canvas</td>
<td width="20%" valign="top"><b>Gestão</b><br/>• Orçamentos, faturas, controlo de budget<br/>• Crew sheets, planeamento de eventos, meeting actions</td>
<td width="20%" valign="top"><b>Builds à medida</b><br/>• Design de PCB e caixas OpenSCAD<br/>• Assets 3D, Rhino, modelação Blender</td>
<td width="20%" valign="top"><b>Dev geral</b><br/>• Backend, frontend, testes e shipping<br/>• 45 subagents, três pipelines, skills de biblioteca</td>
</tr>
</table>

Para fluxos guiados nestes domínios, ver [Playbooks](#playbooks).

---

## Início rápido

| Quero ... | Executar |
|---|---|
| Instalar em todos os meus harnesses | `npx -y @hybridlabor-api/aos@latest` |
| Instalar com pouco overhead de contexto | `npx -y @hybridlabor-api/aos@latest --profile=minimal` |
| Refrescar apenas os gates e hooks | `npx -y @hybridlabor-api/aos@latest --hooks-only` |
| Ver primeiro o que mudaria | `npx -y @hybridlabor-api/aos@latest --dry-run` |
| Verificar uma instalação avariada | `aos doctor` |
| Abrir a página local de controlo (serviços, catálogo, store, planos) | `aos hub` |
| Procurar e adicionar skills e agents | `aos store ui` |
| Adicionar o grafo de conhecimento de código | `npx -y @hybridlabor-api/aos@latest -y --modules=codebase-memory` |
| Planear uma feature e depois construí-la | `/plan`, depois `/fabric-graph` |

---

## Vê-lo em ação

<p align="center">
<img src="docs/assets/readme/agenttrail-live.gif" alt="mapa em vivo do agenttrail de um build multi-agente em execução" width="100%"><br/>
<sub><b>agenttrail.</b> O mapa em vivo de um build multi-agente enquanto corre. <a href="docs/assets/readme/agenttrail-live.mp4">▶ Vídeo em qualidade completa</a></sub>
</p>

<table>
<tr>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/plan-canvas.png" alt="Plan Canvas com uma anotação num elemento do plano" width="100%"><br/>
<sub><b>Plan Canvas.</b> Anotar o plano no navegador e aprová-lo antes de qualquer agente construir.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/ao-pipeline.png" alt="Workspace do AO: o monitor da pipeline AOS com as fases plan, gate, build, review e ship e o roteamento papel-modelo" width="100%"><br/>
<sub><b>Workspace do AO.</b> O monitor da pipeline, do plano ao ship, com roteamento de papel e de modelo por nó.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/aos-store.png" alt="Web UI do AOS Store: skills, agents e playbooks por scope, categoria e fonte" width="100%"><br/>
<sub><b>AOS Store.</b> Skills, agents e playbooks em 127.0.0.1:4322.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/codenotch-usage.png" alt="Codenotch: agents em execução e ocupados por harness, versões do AOS e do AO" width="100%"><br/>
<sub><b>Codenotch.</b> Agents em execução e ocupados por harness.</sub>
</td>
</tr>
</table>

<p align="center">
<img src="docs/assets/readme/fleet-band.png" alt="Fleet band no Claude Code mostrando o modo do gate, uso de contexto e sessões com os seus contadores de GO" width="100%"><br/>
<sub><b>Fleet band.</b> No Claude Code: modo do gate, token-weather e as sessões que esperam pelo seu GO.</sub>
</p>

<p align="center">
<img src="docs/assets/readme/aos-installer.gif" alt="Instalador do AOS: animação de arranque, telemetria de pre-flight e o menu de configuração" width="100%"><br/>
<sub><b>Instalador.</b> <code>npx -y @hybridlabor-api/aos@latest</code>: arranque, telemetria de pre-flight, depois o menu de configuração. <a href="docs/assets/readme/aos-installer.mp4">▶ Vídeo em qualidade completa</a></sub>
</p>

---

## Skills de um relance

- [**`/fabric`**](skills/basic/fabric/SKILL.md) - entrada mestra: escolhe o modo fabric adequado à tarefa e diz porquê numa linha
- [**`/fabric-graph`**](skills/basic/fabric-graph/SKILL.md) - dispatcher graph com `state.json` durável, repair loop do Reviewer, quality gate e escalada
  - O dispatcher invoca os subagents [`architect`](agents/architect.md), [`techlead`](agents/techlead.md), [`godmode-ui-ux`](agents/godmode-ui-ux.md), [`godmode-engineering`](agents/godmode-engineering.md), [`godmode-media-eventtech`](agents/godmode-media-eventtech.md), [`reviewer`](agents/reviewer.md) e [`godmode-shipping`](agents/godmode-shipping.md); nunca se chamam entre si
- [**`/fabric-multigraph`**](skills/basic/fabric-multigraph/SKILL.md) - fan-out descartável de 2-4 nós para qualquer projeto, nada persistente fica para trás
- [**`/fabric-teamwork`**](skills/basic/fabric-teamwork/SKILL.md) - elaboração de prompts e delegação a uma equipa; `/fabric-swarm` executa vários workers semelhantes sobre um pool partilhado; `/fabric-loop` está documentado e chega na 5.4.1
- [**`/plan`**](commands/plan.md) - redigir, renderizar numa canvas do navegador, anotar, aguardar aprovação, depois entregar
  - [**`plan-canvas`**](skills/global_config/plan-canvas/SKILL.md) - canvas local onde anota elementos, conversa e aprova ou pede alterações
  - [**`plan-arbiter`**](skills/global_config/plan-arbiter/SKILL.md) - comparar planos concorrentes de vários agentes e produzir um plano recomendado
- [**`/bdbrainstorm`**](skills/bdbrainstorm/SKILL.md) - brainstorm multi-agente que termina numa entrega ao `/fabric-graph`
  - [**`/grill-me`**](skills/global_config/grill-me/SKILL.md) - entrevista implacável para afinar um plano ou um design
  - [**`bdbmediastorm`**](skills/basic/bdbmediastorm/SKILL.md) - brainstorm para event tech em vivo, show control e media em tempo real
- [**`/playbooks`**](commands/playbooks.md) - listar todos os playbooks `pb-*` com duração, dificuldade e requisitos, e iniciar um
  - [`pb-bug-fix`](skills/playbooks/pb-bug-fix/SKILL.md) - de issue do GitHub a fix testado e PR; push e PR só depois de GO
  - [`pb-ship`](skills/playbooks/pb-ship/SKILL.md) - triar, rever e fechar os PRs do dia; merge só depois de GO
  - [`pb-release-aos`](skills/playbooks/pb-release-aos/SKILL.md) - lançar o AOS no npm através da PR do release-please
  - [`pb-show-build`](skills/playbooks/pb-show-build/SKILL.md) - construir um show entre grandMA3, Resolume e TouchDesigner, offline primeiro
  - [`pb-offer`](skills/playbooks/pb-offer/SKILL.md) - redigir uma proposta de cliente com preços da sua lista de preços; enviar só depois de GO
- [**`factory-collect`**](skills/global_config/factory-collect/SKILL.md) - Factory: recolher e triar feedback, telemetria, erros e relatórios de issues
  - [`factory-lookback`](skills/global_config/factory-lookback/SKILL.md) - auditar problemas recorrentes entre fontes para correções sistémicas
  - [`factory-review-prs`](skills/global_config/factory-review-prs/SKILL.md) - rever uma fila de PRs configurada; aprovar e fazer merge ficam consigo
  - [`factory-human-digest`](skills/global_config/factory-human-digest/SKILL.md) - digest só de leitura do que ainda precisa de uma decisão humana
- [**`gogate`**](skills/global_config/gogate/SKILL.md) - mostrar ou explicar o modo do go-gate (hard, soft, off) e os grants de tempo limitado; CLI: `aos-gogate`
- [**`aos-a2a`**](skills/global_config/aos-a2a/SKILL.md) - listar, enviar e responder a peers de harness ativos por A2A no localhost
  - [`master-session`](skills/basic/master-session/SKILL.md) - supervisionar várias sessões: roster, pedidos de estado, quadro de GO; workers podem ser criados via `aos-acp`
  - [`mcsc`](skills/global_config/mcsc/SKILL.md) - delegar uma tarefa a outro harness de CLI instalado (agy, OpenCode, Codex)
- [**`agenttrail`**](skills/global_config/agenttrail/SKILL.md) - mapa em vivo no navegador de um build multi-agente; CLI: `aos-trail`
- [**`aos-store`**](skills/global_config/aos-store/SKILL.md) - procurar, pré-visualizar e instalar skills e agents numa web UI local (`aos store`)
- [**`memb-skill`**](skills/global_config/memb-skill/SKILL.md) - motor de memória de longo prazo local-first (memB)
  - [`memb-ingest`](skills/memb-ingest/SKILL.md) - ingerir ficheiros de projeto e logs de conversação no memB
- [**`openwiki-skill`**](skills/global_config/openwiki-skill/SKILL.md) - inicializar, atualizar e visualizar wikis de codebase com o OpenWiki
- [**`synapse-integration-skill`**](skills/synapse-integration-skill/SKILL.md) - integração do BDB Synapse (visualizador de codebase em 3D)
- [**`/doctor`**](commands/doctor.md) - verificar a máquina e o projeto atual, imprimir entradas `permissions.allow` sugeridas, não escreve settings
- [**`aos-setup`**](skills/global_config/aos-setup/SKILL.md) - levar uma máquina a uma instalação AOS completa e verificada
  - [`aos-project-init`](skills/global_config/aos-project-init/SKILL.md) - configurar uma pasta de projeto: slug, wiki, memória, mapa Synapse, `AGENTS.md`
- **Godmodes** - livros de regras por domínio
  - [`godmode-engineering`](skills/basic/godmode-engineering/SKILL.md) - DDD estrito, strictness de TypeScript, Clean Architecture, triagem de debugging em 5 passos
  - [`godmode-ui-ux`](skills/basic/godmode-ui-ux/SKILL.md) - brand discovery, regras anti-slop, design tokens DTCG, motion fluida
  - [`godmode-eventtech`](skills/basic/godmode-eventtech/SKILL.md) - execução de show control para grandMA3, Resolume, Unreal, Rhino, Vectorworks e Adobe MCP
  - [`godmode-hardware-pcb`](skills/basic/godmode-hardware-pcb/SKILL.md) - esquemas, layout de PCB, caixas KiCad e OpenSCAD com sign-off DFM/DRC/ERC
  - [`godmode-shipping`](skills/basic/godmode-shipping/SKILL.md) - gatekeeper final: verificações pré-lançamento, rollouts com feature flags, planeamento de rollback
- **Auxiliares vendados** de [BuilderIO/skills](https://github.com/BuilderIO/skills)
  - [`read-the-damn-docs`](skills/global_config/read-the-damn-docs/SKILL.md) - força uma passagem pelos docs antes de codificar APIs de terceiros de memória
  - [`stay-within-limits`](skills/global_config/stay-within-limits/SKILL.md) - respeitar os limites de 5 horas e semanais em execuções longas ou paralelas
  - [`quick-recap`](skills/global_config/quick-recap/SKILL.md) - terminar cada resposta com uma linha de estado vermelho/amarelo/verde

Os catálogos completos (cada skill, subagent, playbook e servidor MCP) estão nas listas dobráveis em "O que está incluído".

---

## O que há de novo no v5

O v5 muda a forma como o AOS chega a uma máquina e como as suas partes conversam entre si.

| Área | O que mudou |
|---|---|
| **Instalador** | Fluxo reconstruído: Kernel, Harnesses, Packages, Optional, Verify. Perfis `minimal`, `standard`, `full`; `--no-hooks`, `--hooks-only`, `--without=<ids>`; reparação e desinstalação a partir do manifest; uma verificação de versão no início com Update como predefinição. Ver [Instalar](#instalar) e [docs/install-options.md](docs/install-options.md). |
| **MCP gateway** | `aos-gateway`: um endpoint local (1mcp atrás de um forwarder com verificação de token) à frente de uma allow list dos servidores incluídos, `aos-gateway adopt` para os seus próprios servidores stdio, e **um MCP por app** (Blender, Resolume, After Effects). Instala-se com o perfil por defeito; desliga-se com `aos-gateway direct`, `--without=gateway` ou `--profile=minimal`. [docs/mcp-gateway.md](docs/mcp-gateway.md). |
| **A2A** | Sessões vivas de Claude Code, OpenCode, agy e Codex trocam mensagens com `aos-a2a`. Uma mensagem recebida nunca é um GO. Qualquer harness capaz de MCP pode entrar através do servidor MCP `aos-a2a`. [docs/a2a.md](docs/a2a.md). |
| **Agentes nativos** | Os subagents são compilados para os formatos e caminhos que cada harness realmente lê, incluindo OpenCode e agy. Nenhum modelo é fixado a menos que você defina um: [docs/agent-models.md](docs/agent-models.md). |
| **Fleet mod** | Uma banda no Claude Code: modo do gate, token-weather (percentagem de contexto como palavra de tempo mais uma sparkline) e quais sessões trabalham ou esperam por si com os seus contadores de GO. `aos-gogate` mostra o estado do gate em modo só de leitura. |
| **AOS Hub** | Uma página local para tudo o que o AOS corre a pedido, em `127.0.0.1:7900`: Services, Catalog, Store e Plans. `aos hub`, `aos services`, `aos restart`. Substitui o antigo servidor HTTP do Launchpad; o `aos-dashboard` passou a ser um alias fino. [docs/hub.md](docs/hub.md). |
| **agenttrail** | Um mapa em vivo por repositório, iniciado automaticamente, com um link na sua sessão. Uma sala de controlo v2 está **em curso**. |
| **Plan Canvas** | Os planos abrem numa canvas local; as anotações são devolvidas ao agente. |
| **go-gate** | Comandos de leitura, teste e build sem efeito de escrita ou de rede passam sem GO; os logs de deny mascaram credenciais; hooks em quatro harnesses; um perfil de gate de máquina (`strict`, `work`, `off`) estreita ou alarga. |
| **Playbooks e Factory** | 36 playbooks `pb-*`, as nove skills `factory-*` e `plan-arbiter`. |
| **Cadeia de orquestradores** | master session, project orchestrator, package orchestrator, mapeados em mecanismos reais. |

**Em curso, sem ser declarado como lançado.** Sala de controlo agenttrail v2, intercom A2A e a2abook, modo `spawn` do A2A, `skill-create` e `instinct-*`.

---

## O dispatcher graph

O graph é neutro de harness e corre nos Dynamic Workflows do Claude Code, na execução paralela do Antigravity e em qualquer harness de agente compatível.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart TB
    subgraph SG[" "]
    direction TB
    U(["User"])
    A["<b>Architect</b><br/>System Plan"]
    T["<b>TechLead</b><br/>Capability Map"]
    UX["<b>UI_UX</b><br/>Frontend"]
    EN["<b>Engineering</b><br/>Backend"]
    ME["<b>Media_EventTech</b><br/>Creative"]
    R["<b>Reviewer</b><br/>QA"]
    S["<b>Shipping</b><br/>Gate"]

    U --> A --> T
    T --> UX & EN & ME
    UX & EN & ME --> R
    R --> S

    T -.->|reject| A
    R -.->|findings| UX
    S -.->|gate fail| EN
    R -.->|escalate| U
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class A,T plan
    class UX,EN,ME build
    class R,S gate
    class U human
```

<p align="center"><sub><b>Dispatcher graph.</b> Architect e TechLead planeiam, três nós de build trabalham em paralelo, Reviewer e Shipping fecham o resultado, e arestas tracejadas encaminham rejeições e escaladas.</sub></p>

---

## Instalar

**Requisitos.** Node.js >= 20. macOS, Linux e Windows (PowerShell).

```bash
npx -y @hybridlabor-api/aos@latest
```

**Primeira execução.** O instalador deteta os harnesses presentes, pergunta quais ativar e qual o tier (Pro MEDIA ou Basic), copia as skills para a pasta de skills de cada harness, compila os subagents, liga os hooks, faz merge da configuração MCP no ficheiro de configuração próprio de cada harness (as entradas existentes são mantidas) e oferece os módulos opcionais listados abaixo.

**Cada execução seguinte** abre em vez disso um menu:

| Item do menu | O que faz |
|---|---|
| Quick Update | Atualiza skills, templates, hooks e módulos instalados para a versão que acabou de executar |
| Run System Checkup / Doctor | Executa `aos doctor`: dependências, colocação de ficheiros, daemons, hooks |
| Drop Local Project Harness | Copia o contrato do dispatcher para o diretório atual (ver abaixo) |
| Reconfigure System | Mudar destinos, tier, perfil ou opções |
| Uninstall AOS | Remove o que o instalador colocou; os seus dados ficam |

### Perfis e opções

| Flag | Efeito |
|---|---|
| `--profile=standard` (predefinição) | Skills, agents, regras, todos os hooks, MCPs, OpenWiki, Token Saver, fleet. |
| `--profile=minimal` | Apenas skills, agents e regras de harness. Sem hooks de injeção de contexto, OpenWiki, Token Saver, Codenotch, módulos opcionais, gateway nem fleet. A opção de pouco contexto. |
| `--profile=full` | `standard` mais todos os módulos opcionais (igual a `--modules=all` com `-y`). |
| `--no-hooks` | Salta apenas os hooks de injeção de contexto (`memb-inject`, `rules-inject`, `trail-relay`, `trail-autostart`). |
| `--hooks-only` | Instala ou refresca os hooks e as suas entradas de settings e sai. Com `--no-hooks` refresca apenas os gates. |
| `--without=id,id` | Exclui pacotes por id de registo (`memb, synapse, openwiki, remote, ao, creator, hardware, rustauri, styleseed, installer, deja, token-saver, codenotch, gateway, hub, fleet, sessions, alert`) ou pelo bundle `memory` (memB, deja e OpenWiki: [memória unificada](docs/unified-memory.md)). Guardado, para que updates e reparações os ignorem. |
| `--modules=id,id` | Inclui apenas os módulos opcionais nomeados numa execução não interativa (por exemplo `--modules=creator` ou `--modules=codebase-memory`); `all` pega em todos. Também definível por `AOS_MODULES`. |
| `AOS_DISABLED_MCPS=a,b` | Mantém esses nomes de servidores MCP incluídos fora das configurações de harness que o instalador escreve. |
| `--dry-run` | Imprime o que mudaria e não escreve nada. |

**O gate e os hooks de segurança são sempre instalados.** Nenhum perfil ou flag remove `go-gate`, `go-token`, `go-grant`, `graph-gate`, `conventional-commits` ou `env-file-protection`. O plugin OpenCode não é afetado por `--no-hooks` nem por `minimal`. As escolhas de perfil ficam guardadas em `~/.aos/v5-settings.json`. Referência completa: [docs/install-options.md](docs/install-options.md).

### Não interativo

```bash
npx -y @hybridlabor-api/aos@latest -y --platforms=2          # apenas Claude, todas as predefinições
npx -y @hybridlabor-api/aos@latest -y --platforms=1,5 --mcps=none
npx -y @hybridlabor-api/aos@latest -y --modules=codebase-memory,styleseed
npx -y @hybridlabor-api/aos@latest --dry-run                 # imprimir o que mudaria
```

Valores de `--platforms=`: `0` universal (todos os detetados), `1` Antigravity, `2` Claude Desktop / Claude Code, `3` Cursor, `5` Codex CLI, `6` Windsurf, `7` Roo Code / Cline, `8` Aider, `10` AOS CLI. `4` (caminhos próprios) precisa do menu interativo. `--mcps=<name,name>|all|none` escolhe o subconjunto de MCPs. `--verbose` e `--no-intro` fazem o que dizem.

### Project harness local

Em vez de instalar em `$HOME`, deposite apenas o contrato do dispatcher (`.agents/`, os gate hooks, as definições de agent, o workflow `/fabric-graph`, o plugin OpenCode) num único repositório:

```bash
cd o-seu-projeto && npx -y @hybridlabor-api/aos@latest --project-harness -y
```

---

## Harnesses suportados

**O que é escrito.** O instalador escreve o seguinte para cada destino. Os caminhos são as predefinições; o instalador só escreve em harnesses que realmente deteta.

| Harness | Skills | Subagents | Hooks | Plugin / regras |
|---|---|---|---|---|
| Claude Code / Claude Desktop | `~/.claude/skills` | `~/.claude/agents` | `~/.claude/hooks` + `settings.json` (GO gate, graph gate, env-file protection, Conventional Commits, memB inject, trail relay, A2A inbox) | manifest `.claude-plugin/` incluído no repositório (ver Contribuir); fleet mod registado em `settings.json` |
| Google Antigravity | `~/.gemini/config/skills` | `~/.gemini/config/agents/<name>/agent.md` | `~/.gemini/config/hooks.json` e `~/.gemini/antigravity-cli/hooks.json` | `plugin.json` raiz / `plugins/bdb-aos/plugin.json`, comandos `/bdb-aos:<cmd>`, ver [docs/codex-agy-setup.md](docs/codex-agy-setup.md) |
| Codex CLI | `~/.agents/skills` (o Codex lê esta raiz e `~/.codex/skills`; o AOS escreve apenas a primeira, para que as skills não apareçam em duplicado) | `~/.codex/agents` | `~/.codex/hooks` + `config.toml` | `.codex-plugin/` + `.agents/plugins/marketplace.json`, comandos `$bdb-aos:<cmd>`, ver [docs/codex-agy-setup.md](docs/codex-agy-setup.md) |
| OpenCode | `~/.config/opencode/skills` | `~/.config/opencode/agents` | via plugin | plugin `bdb-aos.js` + comando `/fabric-graph`, registado em `opencode.jsonc`; mantém uma execução de `/fabric-graph` em movimento em `session.idle`; comandos `/bdb-aos-<cmd>` gerados; extras opt-in, ver [docs/opencode-setup.md](docs/opencode-setup.md) |
| Cursor | `~/.cursor/skills` | nenhum | nenhum | `.cursor/rules` (projeto) |
| Windsurf | `~/.windsurf/bdb-skills` | nenhum | nenhum | `mcp.json` |
| Roo Code / Cline | `~/.roo/skills` | nenhum | nenhum | `.roomodes` (projeto) |
| Aider | `~/.aider/bdb-skills` | nenhum | nenhum | nenhum |
| AOS CLI (`pi`) | lê `~/.agents/skills` | `~/.agents/AGENTS.md` como system prompt | nenhum | sem MCP; instalação separada, Node >= 22.19, ver [packages/aos-cli](packages/aos-cli/README.md) |
| BDB AO Codenotch (app macOS, instalador Windows) | macOS `/Applications` ou `~/Applications`; Windows instalação NSIS por utilizador (`/S`, sem admin) | nenhum | nenhum | instalado por predefinição em macOS e Windows (nunca Linux); recusar com `--no-codenotch` ou `AOS_CODENOTCH=0`; falhas apenas avisam; DMG do repositório público de releases criado pelo Tim, verificado por SHA-256, assinado ad-hoc com a quarentena removida, ver [docs/codenotch.md](docs/codenotch.md) |

Cada instalação escreve também a cópia universal em `~/.agents/skills`, que é o que a AOS CLI e a skills CLI leem.

**Agents do OpenCode.** As quatro personas godmode (`godmode-ui-ux`, `godmode-engineering`, `godmode-media-eventtech`, `godmode-shipping`) são compiladas com `mode: all`, por isso aparecem no seletor de agents do OpenCode e podem conduzir uma sessão inteira, não apenas uma chamada de subagent. Ao lado delas são escritas duas funções de sessão finas como agents `mode: primary` que carregam a skill correspondente: `master-session` (roster, pedidos de estado, tabuleiro de GO) e `project-orchestrator` (agents paralelos entre repositórios através do daemon AO). Todos os outros agents são compilados como `mode: subagent`.

### Níveis de capacidade

Os harnesses não recebem a mesma camada de segurança. O nível diz o que está realmente ligado, não o que um harness poderia fazer em teoria; a evidência por linha está em [docs/harness-capabilities.md](docs/harness-capabilities.md).

| Nível | Harnesses | O que recebe |
|---|---|---|
| 1 Completo | Claude Code | GO gate como hook imposto, grants e modos tipados (`gogate grant ...`), painel de fleet, inbox A2A drenada para o prompt seguinte, todos os hooks de contexto, entradas do gateway MCP |
| 2 Gate e grants | OpenCode | GO gate através do plugin, grants limitados a 2 h e sem modo `off`, A2A injetado como prompt, entradas do gateway MCP; sem painel |
| 3 Apenas hook de gate | Codex CLI, Antigravity (agy) | Está instalado um hook de gate `PreToolUse`; grants e modos não estão ligados (só um GO humano literal conta); o Codex precisa de uma confiança `/hooks` única, e se o hook dispara sob `codex exec`, `aos-acp` ou `agy --print` está **não verificado**; A2A recebido por `codex queue` (Codex) ou só por pull (agy) |
| 4 Skills, regras, MCP | Cursor, Windsurf, Roo Code / Cline, Aider | Skills e regras de projeto (`.mdc` do Cursor, modos do Roo); entradas MCP para o Cursor; **sem hook**, pelo que o texto de Destructive Actions no `AGENTS.md` é a única camada de segurança |
| Não suportado | Zed, Kimi | Sem destino no instalador |

Onde um nível não tem hook, nada de mecânico impede um comando guardado: use um harness de nível 1 ou 2 para tudo o que possa fazer push, publicar ou apagar.

<details>
<summary><b>Mapa de capacidades por harness (4)</b></summary>

**Delegação, A2A e gate hooks.** As linhas dizem o que o código deste repositório faz. Fonte: [docs/harness-capabilities.md](docs/harness-capabilities.md).

| Capacidade | Claude Code | OpenCode | Codex | agy |
|---|---|---|---|---|
| Delegação para fora (`aos-acp`) | sim | sim | sim | via comandos de shell (sem cliente ACP próprio) |
| A2A recebido | UserPromptSubmit drain + Stop nudge | injeção do plugin como prompt sintético | `codex queue` / `codex exec resume` | apenas pull, inbox MCP `a2a_inbox_pull`; uma sessão interativa em execução não pode ser empurrada |
| Resposta A2A | `aos-a2a reply` via regras Bash pré-aprovadas | ficheiro de resposta escrito pelo plugin | resposta ao prompt na fila ou retomado | ferramenta `a2a_reply`, ou `aos-a2a reply` |
| Modo sidecar A2A | `--mode live` | `--mode live` | `--mode live` | `--mode live` |
| Hook do GO gate | sim | sim (plugin, hooks partilhados) | sim (um hook está instalado; disparar sob `codex exec`, `aos-acp` e `agy --print` não está verificado) | hooks gate-only (`PreToolUse`, `PreInvocation`, `Stop`) |
| Nunca-GO em A2A recebido | sim | sim | sim | sim |

</details>

---

## As pipelines

O contrato vive em [`.agents/graph.md`](.agents/graph.md), o roster de nós em [`.agents/nodes.json`](.agents/nodes.json), o dispatcher executável em [`.claude/workflows/fabric-dispatch.mjs`](.claude/workflows/fabric-dispatch.mjs).

**Uma regra: os nós nunca se invocam entre si.** Um dispatcher lê `production_artifacts/state.json` depois de cada nó devolver e decide o que corre a seguir. Não há cadeia de hand-offs nem agente a dizer a outro agente para avançar. Este design garante fidelidade de contexto, auditabilidade da lógica de roteamento num único sítio e portabilidade entre harnesses.

Cada nó lê o plano e o seu próprio estado anterior, executa o seu trabalho, escreve o seu artefacto e fragmentos de estado e devolve. O dispatcher faz merge dos fragmentos de estado por nó (`state.d/<node>.json`), avalia os predicados das arestas e encaminha para o próximo nó, ou escala para o utilizador se o no-progress guard disparar (a mesma finding bloqueadora no segundo ciclo de reparação) ou se o teto de iterações for atingido.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph SG[" "]
    direction LR
    U(["User"]) --> A("Architect") --> T("TechLead")
    T --> UX("Godmode_UI_UX") & EN("Godmode_Engineering") & ME("Godmode_Media")
    UX & EN & ME --> R("Reviewer") --> S("Shipping")
    T -.->|reject| A
    R -.->|findings| UX
    R -.->|needs_human| U
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class A,T plan
    class UX,EN,ME build
    class R,S gate
    class U human
```

<p align="center"><sub><b>Roster de nós.</b> Os sete nós do graph e as arestas que devolvem trabalho: reject, findings e needs_human.</sub></p>

| Comando | Mecânica | Quando usar |
|---|---|---|
| `/fabric` | Entrada mestra. Lê a tarefa, escolhe um dos modos abaixo e diz qual e porquê numa linha. | Quando não é claro qual modo serve. |
| `/fabric-graph` | O graph completo: `state.json` durável, repair loop do Reviewer, quality gate automatizado, escalada humana. | Trabalho de features onde a correção importa mais que a velocidade e quer um trilho de auditoria. |
| `/fabric-multigraph` | Fan-out descartável de 2-4 nós. Nada persistente. Tiers de modelo por papel; usa Antigravity, OpenCode ou Codex se instalados, subagents do Claude Code caso contrário. | Um "cria alguns workers" pontual em qualquer projeto. |
| `/fabric-teamwork` | 9-step prompt crafting and delegation to a team. | A vague brief that needs sharpening before a team gets it. |
| `/fabric-swarm` | N similar workers take items from one shared pool (`production_artifacts/swarm.json`). | Many near-identical items, one worker each. |
| `/fabric-loop` | Documented, arrives in 5.4.1. Routes to `loop-templates` meanwhile. | Repeat until a condition holds. |

### Os modos lado a lado

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart TB
    subgraph L["/fabric-graph (linear run)"]
        direction LR
        L1("Architect") --> L2("TechLead") --> L3("parallel build") --> L4("Reviewer")
        L1 -. "production_artifacts/*.md" .-> L4
    end
    subgraph G["/fabric-graph (durable)"]
        direction LR
        D{{"Dispatcher<br/>state.json"}}
        D --> N1("node") --> D
        D --> N2("node") --> D
        D --> Q("quality gate")
        D -. "no progress / ceiling" .-> H(["Human"])
    end
    subgraph F["/fabric-multigraph (throwaway)"]
        direction LR
        F0("main session") --> W1("worker") & W2("worker") --> F3("review pass")
    end
    L ~~~ G ~~~ F

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    class L1,L2,F0 plan
    class L3,N1,N2,W1,W2 build
    class L4,Q,F3,D gate
    class H human
    style L fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    style G fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    style F fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

<p align="center"><sub><b>Três variantes.</b> A cadeia linear, o dispatcher graph durável e o fan-out descartável, lado a lado.</sub></p>

**O que mantém o graph completo honesto.**

| Mecanismo | O que previne |
|---|---|
| Isolamento do Reviewer | O Reviewer lê os artefactos e o contrato do plano, nunca o raciocínio do nó de build nem a alegação de que está pronto. |
| No-progress guard | Um ciclo de reparação que reporta a mesma finding ID bloqueadora que o anterior escala para um humano em vez de queimar iterações. |
| Fragmentos de estado por nó | Nós de build em paralelo escrevem `state.d/<node>.json`; o dispatcher faz o merge. Sem corrida de lost-update num único ficheiro. |
| Teto de iterações | `max_iterations` (predefinição 3) para o loop incondicionalmente. |
| Aresta humana no loop | Qualquer nó pode definir `needs_human: true` e parar a execução. |

### Cadeia de orquestradores

**Mapeamento.** `master session -> project orchestrator -> package orchestrator` é uma convenção. Isto é como cada salto mapeia em mecanismos que existem ([docs/orchestrator-chain.md](docs/orchestrator-chain.md), skill `orchestrator-chain`):

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart TD
    subgraph SG[" "]
    direction TB
    H(["Human"]) -->|"GO &lt;session&gt;"| M("Master session<br/>skill master-session<br/>roster, status, GO board")
    M --> P("Project orchestrator<br/>ao-orchestrator ou um dispatcher de pipeline")
    P --> K1("Package orchestrator<br/>worker aos-acp")
    P --> K2("Package orchestrator<br/>peer aos-a2a")
    P --> K3("Package orchestrator<br/>nó de build de pipeline")
    K1 -.->|"nunca herda GO"| M
    K2 -.->|"mensagem A2A nunca é GO"| M
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class H human
    class M gate
    class P plan
    class K1,K2,K3 build
```

<p align="center"><sub><b>Cadeia de orquestradores.</b> Cada salto do humano até um package orchestrator, com arestas tracejadas a mostrar que um GO nunca é herdado para cima.</sub></p>

**Profundidade.** O A2A recusa um send quando a profundidade de quem chama está em ou acima de `AOS_A2A_MAX_DEPTH` (predefinição 1) e o `mcsc` está a um nível de profundidade. Os workers não apagam nada; a limpeza é trabalho do dispatcher depois do seu GO.

---

## O GO gate

Chegar a `ready_to_ship` não é fazer ship. [`.claude/hooks/go-gate.mjs`](.claude/hooks/go-gate.mjs) é um hook `PreToolUse` que bloqueia `git push`, `npm publish`, `npm version` e `rm` recursivo a menos que a sua mensagem imediatamente anterior seja a palavra literal **GO**. É um hook, não uma regra que se pede a um agente para respeitar: dispara antes de qualquer verificação de modo de permissões e não pode ser contornado com argumentos. O instalador liga o mesmo gate no Antigravity, no Codex e no OpenCode; em harnesses sem suporte de hooks aplica-se a regra no [AGENTS.md](AGENTS.md) e o agente é a imposição. Um subagent nunca herda o GO do seu orquestrador, e um comando de release falhado precisa de um novo.

**O que o v5 acrescenta.**

- **Trabalho só de leitura continua rápido.** Comandos de leitura, teste e build sem efeito de escrita ou de rede passam sem GO, também após mensagens de peers.
- **Uma mensagem A2A nunca é um GO.** Cada mensagem injetada traz essa frase.
- **Modos e grants.** O modo do gate (`hard`, `soft`, `off`) e os grants de tempo limitado são mostrados por `aos-gogate status` e pela skill `gogate`. O `aos-gogate` é só de leitura e nunca registra um grant.
- **Os logs de deny mascaram credenciais** (bearer tokens, flags, URLs com credenciais).
- **Limite.** O hook vê as chamadas de ferramenta que o harness encaminha por ele. Um worker iniciado com permissões contornadas não pede nada, por isso o hook dentro do harness continua a ser a camada principal.

### Perfis de gate

Um perfil de máquina, definido por uma pessoa, alarga ou estreita o que o gate pede. `.claude/hooks/go-gate.mjs` lê-o através de `.claude/hooks/gate-profile.mjs`, por isso qualquer harness que use o go-gate partilhado (Claude Code, OpenCode, Codex, agy) o respeita.

| Perfil | O que exige de si | Predefinição / máximo |
|---|---|---|
| `strict` | tudo o que está guardado (predefinição) | nunca expira |
| `work` | apenas a classe de release | 4 h / 24 h |
| `off` | apenas bloqueios duros | 1 h / 2 h |

```bash
aos-gate status                       # perfil, tempo restante, última mudança
aos-gate profile work --for 24h       # exige um TTY real; recusado dentro de uma sessão de harness
aos-gate profile strict               # não precisa de confirmação
```

- **Classe de release** (ainda precisa de um GO com `work`): push para o branch por defeito, `main`/`master` ou `release/*`, `npm publish`, `npm version`, `npm dist-tag add/rm`, `gh pr merge`, `gh release create`, eliminação recursiva, mover em massa para fora do home e apagar fora do seu próprio worktree.
- **Bloqueios duros mantêm-se em todos os perfis**: escritas no store do gate ou na sua configuração, caminhos de eliminação construídos a partir de HOME, `~` ou variáveis de ambiente, eliminação recursiva fora do seu próprio worktree, edições nos hooks do gate e nas settings que os registam.
- **Falha fechada**: uma configuração em falta, ilegível, com symlink, demasiado grande, com dono errado ou modo errado (não 0600), um ficheiro corrompido ou expirado, ou um perfil `work`/`off` sem expiração leem-se todos como `strict`. Configuração: `~/.aos/gate/config.json`.
- Alargar exige escrever de volta uma palavra aleatória no TTY.
- Risco residual aceite: código a correr com o seu próprio utilizador pode escrever diretamente o ficheiro de perfil. Ver [docs/gate-residuals.md](docs/gate-residuals.md).

---

## Playbooks

Um playbook é uma skill com `kind: playbook` que transforma um trabalho recorrente numa execução guiada com um contrato fixo. Os 36 playbooks `pb-*` acompanham as skills; listá-los com `/playbooks` (executa `list-playbooks.mjs` e imprime nome, tempo, dificuldade e requisitos de cada um). Não há um comando por playbook: chama-se o playbook pelo nome.

**O que um playbook declara.** O seu frontmatter nomeia frases de gatilho, `inputs`, `requires` (skills, subagents, servidores MCP, itens da store), `go_points`, `outputs`, uma verificação `verify`, `difficulty` e `est_time`. O corpo é uma lista numerada de passos. Cada passo nomeia a skill ou agente que usa, a sua entrada, o artefacto que escreve e a verificação que diz que está pronto.

**Como corre uma execução.**

- **Uma sessão por predefinição.** A sessão principal percorre os passos e chama as skills necessárias. Cada passo acrescenta uma linha a um log de execução (`production_artifacts/pb-<name>-<date>.md`, nunca commitado).
- **Subagents onde importa.** Passos marcados com `(agent)` correm um subagent: `reviewer` em `pb-bug-fix`, `pb-ship` e `pb-release-aos`; `architect`, `techlead` e `reviewer` em `pb-harness-work`, `pb-idea-to-launch` e `pb-redesign-app`; `security-reviewer` e `silent-failure-hunter` em `pb-security-sweep`; `opensource-forker` e `opensource-sanitizer` em `pb-open-source`. Num harness sem subagents, a sessão principal lê o ficheiro do agente e corre o mesmo contrato inline. O `pb-master` vai mais longe e corre uma sessão de controlo sobre várias sessões de Claude Code, Codex ou OpenCode.
- **Os GO points fazem parte do contrato.** Um passo `[GO]` para com `WAITING FOR GO: <step>` até que você escreva **GO**; um GO cobre um passo, uma vez. O hook do go-gate é apenas o último recurso. Uma verificação falhada para a execução e é escrita no log; nada é repetido em silêncio.
- **Um comando, não um por playbook.** Existe um único comando `playbooks` que os lista; depois chama-se o playbook pelo nome. Como chegar lá difere por harness:

| Harness | Escreva isto |
|---|---|
| Claude Code | `/bdb-aos:playbooks` e depois nomeie um; ou diga o que quer ("master session" arranca `pb-master`) |
| Codex | `$bdb-aos:playbooks`; mencionar um playbook pelo nome em palavras também funciona através de `~/.agents/skills` (uso direto de `$pb-<name>` não está verificado) |
| OpenCode | `/bdb-aos-playbooks`, ou pergunte em palavras; playbooks que precisem de um servidor de app (media, show) param com "Missing MCP" por desenho |
| Antigravity (agy) | `/bdb-aos:playbooks` (o namespacing de comandos num agy vivo não está verificado, ver [docs/agy-coverage.md](docs/agy-coverage.md)) |
| Cursor, Windsurf, Roo Code / Cline, Aider | apenas a pasta de skills, sem comando: peça o playbook pelo nome |

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph SG[" "]
    direction LR
    I[("Issue")] --> C1("Root cause<br/>+ test")
    C1 --> C2("Fix")
    C2 --> R("Review")
    R -.->|findings| C2
    R --> C3("PR")
    C3 --> G{{"GO"}}
    G -->|yes| C4("Push")
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class I store
    class C1,C3 plan
    class C2,C4 build
    class R,G gate
```

<p align="center"><sub><b>pb-bug-fix.</b> O issue é o contrato, o teste vem antes do fix, o Reviewer vê apenas o diff e o issue, e o push espera pelo seu GO.</sub></p>

<details>
<summary><b>Playbooks por domínio (36)</b></summary>

| Playbook | Objetivo | Subagents | Tempo · nível |
|---|---|---|---|
| **Build e código** | | | |
| `pb-bug-fix` | Transformar um issue do GitHub num fix testado num branch com PR aberta. | reviewer | 30-90 min · intermédio |
| `pb-project-new` | Começar um novo projeto privado no GitHub à maneira do AOS. | — | 20-40 min · intermédio |
| `pb-idea-to-launch` | Transformar uma ideia num protótipo implantado. | architect, techlead, reviewer | 2-6 h · avançado |
| `pb-harness-work` | Mudar o próprio harness de agente (hooks, gates, memória, permissões, plugins) da forma segura. | architect, techlead, reviewer | 1-3 h · avançado |
| `pb-security-sweep` | Passe de segurança sobre um repositório: secrets, dependências, diff, um relatório de findings classificado. | security-reviewer, silent-failure-hunter | 1-2 h · avançado |
| `pb-open-source` | Preparar um projeto para open source: fork higienizado, veredicto do sanitizer, README e LICENSE, novo repositório privado. | opensource-forker, opensource-sanitizer | 1-3 h · avançado |
| `pb-worktrees-land` | Limpar git worktrees nos seus repositórios; remove apenas os já integrados. | — | 10-30 min · intermédio |
| `pb-tauri-e2e` | Auditoria de segurança E2E, live-app e binária multifásica para apps desktop Tauri v2. | reviewer, silent-failure-hunter, security-reviewer | 15-45 min · avançado |
| **Release, CI e operações** | | | |
| `pb-ship` | Entregar o trabalho do dia num repositório: triagem, rever cada PR aberta, merge. | reviewer | 20-60 min · intermédio |
| `pb-release-aos` | Lançar uma nova versão do AOS no npm através da PR do release-please, integrada só depois de GO. | reviewer | 30-60 min · avançado |
| `pb-ci-fix` | Corrigir CI vermelha ou configurar GitHub Actions de ponta a ponta; push só depois de GO. | — | 15-45 min · intermédio |
| `pb-aos-e2e` | Verificação E2E de release do AOS numa sandbox limpa a partir do tarball: install, doctor, gate hooks, round trip do gate, hub, uninstall. | reviewer | 20-60 min · avançado |
| `pb-deploy-saas` | Implantar uma app SaaS na fleet BDB: preflight, plano de guardrails, CI verde, deploy depois de GO, verificação de saúde. | — | 30-90 min · avançado |
| `pb-health-weekly` | Relatório de saúde semanal dos repositórios BDB: deriva de versões e estado de CI. | — | 15-30 min · intermédio |
| **Design e web** | | | |
| `pb-landing-page` | Construir e lançar uma landing page: copy confirmada, tokens de marca, revisão de UI e SEO, deploy depois de GO. | — | 1-3 h · intermédio |
| `pb-redesign-app` | Reformar a UI de uma app com base numa auditoria. | architect, techlead, reviewer | 2-4 h · avançado |
| `pb-docs-site` | Publicar a documentação de um projeto como manual HTML estático nas GitHub Pages. | — | 30-90 min · intermédio |
| `pb-newsletter` | Transformar um recap ou um intervalo de changelog num rascunho de newsletter onde cada afirmação cita uma linha de fonte. | — | 20-40 min · intermédio |
| **Media e event tech** | | | |
| `pb-show-build` | Construir um show entre luzes (grandMA3), media (Resolume) e visuais (TouchDesigner) a partir de uma cue list, offline primeiro. | — | 2-6 h · avançado |
| `pb-crew-call-sheet` | Construir um crew call sheet e um plano de load-in / load-out para um dia de show; enviar à equipa só depois de GO. | — | 10-20 min · iniciante |
| `pb-event-tracker` | Uma folha de cálculo para um evento: convidados, fornecedores, cronograma, orçamento, com mensagens aos fornecedores redigidas. | — | 20-40 min · intermédio |
| `pb-clip-from-moodboard` | Transformar um brief de look e imagens de referência num clip social finalizado. | — | 1-3 h · avançado |
| `pb-image-to-3d` | Transformar uma imagem de referência num asset 3D limpo e escalado. | — | 30-90 min · avançado |
| `pb-launch-video` | Transformar uma app em execução ou landing page num vídeo de lançamento curto. | — | 30-90 min · intermédio |
| `pb-social-pack` | Transformar um recap de release num social pack onde cada afirmação remonta a um ficheiro de factos. | — | 30-60 min · intermédio |
| `pb-content-studio` | Da ideia ao conteúdo pronto a publicar: brief, guião, render através da skill content-studio da Creator Extension, depois um social pack. | — | 45-120 min · intermédio |
| **Hardware** | | | |
| `pb-pcb-to-case` | De uma board KiCad a uma caixa OpenSCAD paramétrica que lhe serve. | — | 1-3 h · avançado |
| **Gestão e escritório** | | | |
| `pb-offer` | Redigir uma proposta de cliente com itens precificados apenas pela sua lista de preços; enviar só depois de GO. | — | 10-20 min · iniciante |
| `pb-invoice-check` | Verificar faturas e recibos linha a linha contra as suas propostas. Nada é pago ou enviado. | — | 10-20 min · iniciante |
| `pb-inbox-zero` | Ordenar uma pilha de emails em responder, delegar, arquivar e ignorar, e redigir as respostas. | — | 10-20 min · iniciante |
| `pb-meeting-actions` | Transformar uma transcrição de reunião em notas, decisões e responsáveis; enviar o follow-up só depois de GO. | — | 10-20 min · iniciante |
| `pb-handover` | Escrever uma nota de entrega para um colega a partir do estado de uma pasta de projeto. | — | 10-20 min · iniciante |
| `pb-week-plan` | Transformar listas de tarefas e notas espalhadas num plano semanal priorizado. | — | 10-20 min · iniciante |
| `pb-focus-chunks` | Dividir uma grande tarefa em blocos de no máximo 25 minutos, cada um com verificação de feito. | — | 5-10 min · iniciante |
| `pb-todo` | Transformar uma frase numa linha de tarefa na lista de tarefas certa. | — | 2-5 min · iniciante |
| **Máquina e sessões** | | | |
| `pb-machine-setup` | Levar uma máquina nova a uma instalação AOS verificada. | — | 30-60 min · intermédio |
| `pb-master` | Uma sessão de controlo sobre várias sessões de Claude Code, Codex ou OpenCode: roster, quadro de estado, quadro de GO. | — | 15 min de setup, depois durante a sessão · avançado |

</details>

---

## Factory

**O que é.** Nove skills experimentais adaptadas de [BuilderIO/skills](https://github.com/BuilderIO/skills) que transformam feedback, telemetria, erros, issues e pull requests num ciclo de revisão repetível: `factory` (o agendamento e a política que alojam as outras), `factory-collect`, `factory-lookback`, `factory-review-prs`, `factory-human-digest`, mais as do lado da entrega `factory-ship`, `factory-babysit-pr`, `factory-watchdog` e `factory-recover`. No AOS eles reportam e redigem; cada escrita externa espera pelo seu GO. O `plan-arbiter` acompanha-os para comparar planos concorrentes.

**O ciclo de revisão.**

| Skill | Lê | Escreve | Precisa de GO? |
| --- | --- | --- | --- |
| `factory-collect` | as fontes em `workflows.collect.sources` | relatório de triagem, rascunhos de respostas, propostas de texto de fecho; correção local opcional | Responder, fechar, push, merge, publicar |
| `factory-lookback` | fontes configuradas sobre um período limitado, correções anteriores | relatório de padrões; correção sistémica local opcional | Responder, fechar, publicar, merge |
| `factory-review-prs` | PRs que correspondem aos filtros configurados | findings por PR, rascunhos de comentários, prontidão de aprovação e merge | Responder, aprovar, merge |
| `factory-human-digest` | repositórios e fontes configurados (predefinição: últimos 7 dias) | fila de decisões, nada mais | Só de leitura |

### Como correr

- **Invocar pelo nome.** Pedir ao agente para correr a skill, por exemplo `factory-collect`; cada `SKILL.md` traz um gatilho "Use when". Começar à mão e ler o relatório antes de agendar qualquer coisa.
- **Configurar.** `.agent-factory/config.yaml`, lido por todas elas. Chaves nomeadas nas skills: `workflows.collect.sources`, `workflows.collect.implement`, `workflows.lookback`, `workflows.lookback.implement`, `workflows.human-digest`, e um `skill_prompts.<skill-name>` opcional por skill. Se o ficheiro falta, a skill para e pergunta; nunca o cria.
- **A regra do GO.** Nada na configuração abre o go-gate. `git push`, `gh pr merge`, `gh release create` e cada resposta, comentário, aprovação, fecho ou mudança de estado precisam do seu GO literal para essa ação exata. Execuções agendadas ou não assistidas são só de leitura.

Vendado de [BuilderIO/skills](https://github.com/BuilderIO/skills) (MIT) com alterações de segurança do AOS, ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); docs a montante: https://github.com/BuilderIO/skills/blob/main/docs/factory/README.md.

Detalhes: [docs/factory.md](docs/factory.md).

---

## A2A: sessões que conversam entre si

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/a2a-logo-white.svg"><img src="docs/assets/readme/a2a-logo-black.svg" alt="logótipo do protocolo A2A" height="40"></picture><br/>
  <img alt="aos-a2a: sidecar por sessão mais plugins e hooks do harness" src="https://img.shields.io/badge/aos--a2a-sidecar%20%2B%20harness%20plugins-0b7285"> <img alt="protocolo A2A, @a2a-js/sdk" src="https://img.shields.io/badge/protocol-A2A%20(%40a2a--js%2Fsdk)-333333">
</p>

Sessões vivas de Claude Code, OpenCode, agy e Codex trocam mensagens no localhost. Cada sessão viva corre um pequeno sidecar ligado a `127.0.0.1` numa porta aleatória com um bearer token por sessão e registra-se num registo local. Não há serviço central.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A", "textColor": "#15171A", "actorBkg": "#E6F4EA", "actorBorder": "#1A7F3C", "actorTextColor": "#15171A", "actorLineColor": "#6e7681", "signalColor": "#6e7681", "signalTextColor": "#6e7681", "noteBkgColor": "#F7F4EC", "noteBorderColor": "#B9B5AA", "noteTextColor": "#15171A", "lineColor": "#6e7681", "sequenceNumberColor": "#15171A", "labelBoxBkgColor": "#F7F4EC", "labelBoxBorderColor": "#B9B5AA", "labelTextColor": "#15171A", "loopTextColor": "#15171A"}}}%%
sequenceDiagram
    participant C as Claude Code session
    participant R as local registry
    participant O as OpenCode session
    C->>R: aos-a2a list
    R-->>C: live peers (name, harness, url)
    C->>O: aos-a2a send --to opencode-1 "review this diff"
    Note over O: plugin injects it<br/>as a prompt,<br/>marked "never a GO"
    O-->>C: aos-a2a reply taskId "answer"
    Note over C: Codex: queue or resume<br/>agy: pull via inbox MCP
```

<p align="center"><sub><b>Fluxo de mensagens A2A.</b> Uma sessão de Claude Code lista os peers vivos no registo local, envia uma mensagem a uma sessão de OpenCode e recebe a resposta de volta.</sub></p>

```bash
aos-a2a list                              # peers vivos
aos-a2a send --to <name> "<text>"         # enviar uma mensagem a uma sessão
aos-a2a reply <taskId> "<answer>"         # responder a uma mensagem recebida
aos-a2a watch <name> [--once]             # seguir um peer em modo só de leitura
```

Receção por harness: o Claude Code esvazia a inbox num hook, o OpenCode recebe uma injeção de plugin, o Codex recebe `codex queue` ou `codex exec resume`, o agy puxa através de um inbox MCP (uma sessão interativa de agy em execução não pode ser empurrada). Para outros canais use `mcsc` (tarefa de uma vez) ou `aos-acp` (worker que pode precisar de um GO): [docs/delegation-routing.md](docs/delegation-routing.md). Detalhes: [docs/a2a.md](docs/a2a.md). **Em curso:** intercom e a2abook por cima do A2A.

**Para qualquer harness capaz de MCP.** `bin/aos-a2a-mcp.mjs` é um único servidor stdio que junta enviar e puxar no mesmo sítio, para que o agy, o Cursor e tudo o que fala MCP entre sem um plugin de harness. Ferramentas: `a2a_list`, `a2a_send`, `a2a_status`, `a2a_card`, `a2a_inbox_pull`, `a2a_reply`. Três regras tornam seguro expô-lo a um modelo:

- **Exige `AOS_A2A_NAME`.** Enviar, responder e puxar falham com `AOS_A2A_NAME is not set` em vez de inventarem uma identidade. O `a2a_reply` não tem sequer argumento de nome, portanto um modelo não consegue escrever a resposta de outra sessão.
- **Texto é dado.** Os argumentos são validados localmente até 8 KiB antes de qualquer chamada de rede, o MCP não expõe nenhum argumento de GO, aprovação ou token, e o texto dos peers é sempre envolvido pela linha nunca-GO. O `bin/a2a-inbox-mcp.mjs` continua a ser o inbox MCP separado, só de pull, já registado para o agy.
- **Sem segredos na saída.** Os bearer tokens dos peers nunca aparecem em nenhum resultado de ferramenta; são lidos do ficheiro de tokens separado do registo, por loopback.

---

## Ferramentas

<p align="center"><img src="docs/assets/readme/tools-landscape.svg" alt="A paisagem de ferramentas do AOS: harness universal no topo, abaixo o workspace do AO, agenttrail, A2A, o MCP gateway, memB, skills de design e godmode, Creator Extension com Synapse, e Codenotch" width="100%"><br/><sub><b>Paisagem de ferramentas.</b> O harness universal no topo, com as ferramentas do AOS e os módulos opcionais abaixo.</sub></p>

<details>
<summary><b>Esboço de visão geral v3.4.0 original</b></summary>

<p align="center"><img src="assets/bdb_v3_4_0_core_tools_overview_sketch.jpg" alt="visão geral dos componentes do sistema BDB do v3.4.0" width="100%"><br/><sub><b>Visão geral v3.4.0.</b> Esboço conceptual do v3.4.0; os componentes cresceram desde então, a tabela abaixo está atualizada.</sub></p>

</details>

| Ferramenta | Comando | O que faz |
|---|---|---|
| Plan Canvas | `aos-plan-canvas open <file>` (skill `plan-canvas`) | Abre um plano ou artefacto HTML numa canvas local no navegador onde anota elementos, conversa e aprova ou pede alterações. Os planos das pipelines abrem aqui por predefinição. |
| agenttrail | `aos-trail` (skill `agenttrail`, porta 5330) | Quadro em vivo de um build multi-agente: que componente, que agente ou harness, o que está feito, o que está preso. Alimentado pelos hooks trail-relay, pelo `mcsc` e pelo `aos-acp`. |
| archify | `aos-archify` (skill `archify`) | Diagrams de arquitetura, sequência, fluxo de dados e estado validados como HTML standalone com exportação SVG; aceita Mermaid. |
| AOS Store | `aos store list \| search <q> \| install <name> [--project]`, `aos store ui` (também `aos-store`, comando `/aos-store`) | Procurar e instalar skills e agents do AOS Core, ECC e Scenario (scenario-labs/skills, MIT); as skills necessárias são instaladas em conjunto e cada ficheiro é verificado por SHA-256. Ambas as UIs dispõem os itens numa grelha de cartões (instalado vs em falta, nome, categoria, tier) em vez de uma tabela: a web UI standalone em `http://127.0.0.1:4322` e o separador Store do AOS Hub, onde um slide-over pré-visualiza os caminhos exatos de destino e instala ou reverte só depois de escrever o nome. `list` e `search` leem um índice offline fixado: 287 skills ECC (library 174, bdb-core 46, engineering-method 38, design-ui-ux 19, media-eventtech 10), 53 subagents ECC e 13 skills Scenario (third-party, MIT, [scenario-labs/skills](https://github.com/scenario-labs/skills)). Itens que o instalador já coloca ficam excluídos da lista. |
| AOS Hub | `aos hub [--port 7900] [--tab id] [--no-open]`, `aos hub status [--json]`, `aos hub stop`, comando `/hub` | A única página local para tudo o que o AOS corre a pedido, em `127.0.0.1:7900`, com quatro separadores: **Services** (estado, start/stop/restart, caudas de log), **Catalog** (cada skill, agent, comando e MCP com o que está instalado e onde), **Store** (a grelha de cartões) e **Plans** (sessões plan-kit ligadas ao seu mapa agenttrail). Apenas loopback, token por processo em `~/.aos/hub/hub.json` (0600), confirmação tipada em tudo o que é destrutivo. Substitui o antigo servidor HTTP do Launchpad; o `aos-dashboard` passou a ser um alias fino que arranca o hub. |
| Dashboard | `aos-dashboard [--port 7900] [--no-open]` | Alias fino para o AOS Hub na mesma porta. Substituído por `aos hub`. |
| Sessões | `aos-sessions [--json]`, mod do Claude Code `bdb-aos-sessions` (`/aos-sessions`) | Visão geral só de leitura de todas as sessões vivas entre harnesses mais os workers ACP, em quatro grupos: NEEDS YOU, WORKING, IDLE, ACP WORKERS. Alimenta a fleet band e o separador Plans do hub. |
| Doctor | `aos doctor [--json] [--net]` (também `aos-doctor`) | Verifica dependências, colocação de skills por harness, daemons, hooks, módulos e o MCP gateway; sai com código 1 quando algo precisa de atenção. O primeiro a correr quando algo se porta mal. |
| Workers | `aos-acp <claude\|codex\|opencode\|agy> --name <worker> [--sandbox coop\|wsl2]` | Arranca um worker cujos comandos guardados precisam de um token GO para o seu nome. `--sandbox` envolve o arranque numa sandbox opcional por execução (desligada por predefinição): `coop` em macOS/Linux, `wsl2` em Windows. |
| Fleet band | mod do Claude Code `plugins/bdb-aos-fleet` | Banda de duas linhas: modo do gate (clique para abrir o painel do gate), token-weather, sessões a trabalhar ou à espera com contadores de GO, e os projetos ativos. Precisa de Claude Code >= 2.1.287; recusar com `AOS_NO_FLEET=1`. |
| Barra de alerta | mod do Claude Code `plugins/bdb-aos-alert` (`/aos-alert test`, `/aos-alert off`) | Uma barra vermelha a piscar em redor do prompt quando um bloqueio do go-gate, um pedido de permissão ou uma pergunta trava a sessão. Como o mod de sessões, é só de leitura e não concede GO. |
| Auxiliar GO | `aos-gogate status [--session <id>] \| preset <name> \| presets` | Estado do gate em só de leitura e textos de presets. Nunca registra um grant. |
| Perfil do gate | `aos-gate status \| profile <strict\|work\|off> [--for <duration>]` | Ler ou mudar o perfil de gate ao nível da máquina; mudá-lo exige um TTY real e é recusado dentro de uma sessão de harness. |
| A2A | `aos-a2a list \| send \| reply \| status \| cancel` | Mensagens entre sessões vivas de harnesses. |
| MCP gateway | `aos-gateway status \| enable \| direct \| adopt` | Um endpoint local para servidores MCP partilhados. Instala-se com o perfil por defeito; o `direct` volta a desligá-lo. |
| Config | `aos-config show \| propose \| set <key> <value>` | `~/.agents/aos-config.json` ao nível da máquina: raiz do workspace, domínios, id do utilizador. |
| mcsc | Ferramentas MCP `delegate_agy`, `delegate_opencode`, `delegate_codex`, `delegate_smart` (skill `mcsc`) | Delega uma tarefa a outro harness de CLI instalado e transmite as suas chamadas de ferramenta ao agenttrail. Preferido a invocar a CLI diretamente. |

### O AOS Hub e a sandbox

**Separadores do hub.** Services, Catalog, Store e Plans. O separador Catalog é estritamente só de leitura: lê `skills/`, `agents/`, `commands/`, `mcp_config.json`, `mcp_picks.json` e a allow list do gateway, e confere a lista de comandos contra `plugin.json`. Nenhum valor de pedido chega ao sistema de ficheiros e nada é escrito. A mesma CLI funciona sem navegador: `aos services status [--json]`, `aos services start <id>`, `aos services stop <id> --confirm <id>`, `aos restart <id> --confirm <id>`. Detalhes: [docs/hub.md](docs/hub.md).

**Sandbox do worker.** `aos-acp --sandbox <provider>` envolve um arranque de worker, e apenas esse arranque. Está desligada por predefinição e o provider é verificado antes de algo arrancar:

| Provider | Onde | Como envolve |
|---|---|---|
| `coop` | macOS e Linux | Precisa do binário `coop` no `PATH` **e** de `AOS_SANDBOX_COOP_CMD`, um template com `{cmd}` como token próprio (por exemplo `coop <subcommand> {cwd} -- {cmd}`), porque o README do coop v0.8.0 fixado não documenta nenhuma forma de correr um comando. `{cwd}` é substituído pelo diretório do worker. |
| `wsl2` | Windows | `wsl.exe --cd <path> --exec <cmd...>`, para que o prompt não seja re-dividido por uma shell. Caminhos de disco são traduzidos para `/mnt/<drive>/...`; caminhos UNC e `\\?\` são recusados em vez de traduzidos mal. Não verificado numa máquina Windows real. |

Um provider desconhecido, ou indisponível nesta plataforma, falha com o motivo e nada arranca. `--sandbox` não estreita caminhos por si só: com `--allow-default=scoped` o estreitamento de caminhos vem da sandbox do agy e do hook aos-go-gate, não deste flag.

### Fleet band e token-weather

**Token-weather.** O fleet mod transforma a percentagem de contexto de uma sessão numa palavra de tempo com um conselho e uma sparkline: por exemplo `ok` com pouco uso, `compact soon` por volta dos 80 por cento, `compact or start a new session` acima dos 90. A mesma banda lista as suas sessões Claude, quais trabalham, quais esperam por si, e quantos pedidos de GO cada uma tem pendentes. Fonte: `plugins/bdb-aos-fleet`.

---

## Servidores MCP

O [`mcp_config.json`](mcp_config.json) define <!-- count:mcps -->21<!-- /count --> servidores stdio locais, construídos ou aquecidos pelo instalador a partir de `mcps/`. Chegam aos seus harnesses de uma de duas formas:

- **Direto.** Cada servidor é escrito na configuração MCP de cada harness, para que todos vejam o mesmo conjunto de ferramentas. É o que recebe com `--without=gateway`, `--profile=minimal` ou depois de `aos-gateway direct`.
- **Através do MCP gateway (a predefinição).** Cada harness recebe uma única entrada `aos` apontando a `127.0.0.1:7790`; atrás dela, o [1mcp](https://github.com/1mcp-app/agent) corre os servidores na allow list do gateway uma vez para todos os harnesses. O `aos-gateway adopt` põe os seus servidores locais atrás dele também, e o `aos-gateway direct` reverte. deja, memB, mcsc e os servidores de controlo do SO permanecem sempre diretos.

**Um risco residual que vale a pena conhecer.** A entrada do gateway carrega o seu token local em linha, como cabeçalho `X-AOS-Token`, em cada configuração de harness: o launcher secreto (`bin/aos-mcp-env.mjs`) cobre os servidores stdio, e uma entrada HTTP streamable precisa do próprio cabeçalho. O token trava navegadores, não outros processos locais.

A coluna "Routing" diz que caminho um servidor toma quando o gateway está ligado; "Chega à app via" diz como fala com a sua aplicação. Chaves de API e tokens vivem em `~/.aos/secrets.env` (modo 0600), nunca inline numa configuração de harness: [docs/mcp-secrets.md](docs/mcp-secrets.md).

| Servidor | App | Chega à app via | Routing | Skill |
|---|---|---|---|---|
| **3D / CAD** | | | | |
| `bdb_blender_mcp` | Blender | integração por socket; o MCP oficial do Blender é escolhido quando se encontra Blender >= 5.1 | gateway (escolha oficial: direto) | `bdb-blender-mcp` |
| `bdb_rhino_mcp` | Rhino 3D, Grasshopper | router Yak da McNeel, precisa de Rhino no host | direto | `bdb-rhino-mcp` |
| `bdb_rhino_mcp_fallback` | Rhino 3D | GOLEM 3D (105 ferramentas) | direto | `bdb-rhino-mcp` |
| `bdb_unreal_mcp` | Unreal Engine 5 | Web Remote Control API, porta 30010 | gateway | `bdb-unreal-mcp` |
| **Vídeo / pós-produção** | | | | |
| `bdb_davinci_mcp` | DaVinci Resolve | API de scripting do Resolve (162 ferramentas) | gateway | `bdb-davinci-mcp` |
| `bdb_after_effects_mcp` | After Effects | `@kumoproductions/mcp-aftereffects` fixado, Node >= 24; servidor legado apenas com `AOS_AE_MCP=legacy` | gateway | `bdb-after-effects-mcp` |
| `bdb_after_effects_mcp_fallback` | After Effects | servidor Go, ExtendScript | direto | `bdb-after-effects-mcp` |
| `adobe_uxp_mcp` | Photoshop, Illustrator, Premiere Pro, After Effects | ponte UXP por WebSocket | gateway | `bdb-adobe-suite-mcp` |
| **Show control / ao vivo** | | | | |
| `bdb_grandma3_mcp` | grandMA3 | ferramentas tipadas `ma3_*`, OSC/UDP porta 8000 | gateway | `bdb-grandma3-mcp` |
| `bdb_resolume_mcp` | Resolume Arena | API REST, porta 8080; o servidor Arena oficial é escolhido quando o seu binário é encontrado | gateway (escolha oficial: direto) | `bdb-resolume-mcp` |
| `bdb_td_minddesigner` | TouchDesigner | ponte MindDesigner, porta 9980 | direto | `bdb-touchdesigner-mcp` |
| `bdb_td_backup` | TouchDesigner | ponte stdio, fallback | direto | `bdb-touchdesigner-mcp` |
| **Design / navegador** | | | | |
| `open_design_mcp` | Open Design | daemon local em 127.0.0.1:3000 | gateway | — |
| `chrome-devtools` | Chrome | Puppeteer | direto | — |
| **Controlo do SO** | | | | |
| `zavora_computer_use` | desktop macOS, Linux | `npx -y @zavora-ai/computer-use-mcp@7.4.0`, módulo Rust nativo embalado no pacote npm | direto | `bdb-computer-use-mcp` |
| `bdb_windows_computer_use` | desktop Windows | Win32, COM, UIAutomation, OCR Tesseract local | direto | `bdb-computer-use-mcp` |
| **Memória / infra** | | | | |
| `memb_mcp` | memB | SQLite local + ONNX, WebUI na porta 8088 | direto | `memb-skill`, `bdb-memb-mcp` |
| `deja` | transcrições de agentes | índice local, secrets redigidos | direto | `deja-memory` |
| `mcsc` | outros harnesses | cria agy, OpenCode ou Codex e transmite ao agenttrail | direto | `mcsc` |
| `github` | GitHub | `@modelcontextprotocol/server-github` | gateway | `github` |
| `bdb_remoteos_mcp` | RemoteOS | gateway multi-nuvem com aprovação de quatro olhos | direto | — |

**Routing.** A allow list em `lib/gateway/config.js` decide: os nove servidores marcados como `gateway` são partilhados pela única entrada `aos` assim que a ativa; todo o resto permanece direto em cada harness.

### Gateway MCP e um MCP por app

**Um MCP por app.** Para Blender, Resolume e After Effects o instalador mantém um único candidato (`mcp_picks.json`): o Blender oficial quando se encontra Blender >= 5.1, o Resolume oficial quando o binário do Arena é encontrado, o servidor embalado caso contrário. O servidor de After Effects é um pacote `npx` fixado e precisa de Node >= 24 (o servidor legado apenas com `AOS_AE_MCP=legacy`).

**Gateway (o perfil por defeito).** O `aos-gateway` corre um forwarder com verificação de token em `127.0.0.1:7790` à frente do `@1mcp/agent` e partilha uma allow list de servidores incluídos atrás de uma entrada `aos` por harness. O `aos-gateway adopt` põe os seus servidores stdio locais atrás dele (ignorando entradas remotas e entradas com secrets inline). O `aos-gateway direct` reverte tudo. O token para navegadores, não outros processos locais. `deja`, `memb_mcp` e `mcsc` permanecem diretos. Desligar com `--without=gateway` ou `--profile=minimal`.

**Formas ignoradas.** O gateway só escreve num harness cuja forma de configuração já verificou. Claude Desktop, Cline, Aider, VS Code, Windsurf, a cópia app-support do Cursor e um segundo candidato do agy são reportados como `skipped: shape unverified` e nunca são modificados, porque não há documentação de fornecedor registada para a forma das suas entradas remotas. As linhas verificadas são Claude Code, Cursor (`~/.cursor/mcp.json`), Roo Code, OpenCode, Codex (`config.toml`) e Antigravity.


```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph D["Direto (gateway desligado)"]
        direction LR
        H1("Claude") --> S1[("github")] & S2[("blender")] & S3[("resolume")]
        H2("OpenCode") --> S1 & S2 & S3
        H3("Codex") --> S1 & S2 & S3
        H4("agy") --> S1 & S2 & S3
    end
    subgraph G["Gateway (predefinição)"]
        direction LR
        G1("Claude") & G2("OpenCode") & G3("Codex") & G4("agy") --> F("aos entry<br/>127.0.0.1:7790<br/>token check")
        F --> M("1mcp agent<br/>127.0.0.1:7791") --> U1[("github")] & U2[("blender")] & U3[("resolume")]
        G1 -.->|"stays direct"| X[("memb_mcp, deja, mcsc")]
    end
    D ~~~ G

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    class H1,H2,H3,H4,G1,G2,G3,G4 plan
    class S1,S2,S3,U1,U2,U3,X store
    class F,M gate
    style D fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    style G fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

<p align="center"><sub><b>Roteamento direto e por gateway.</b> Com o gateway ligado (a predefinição) todos os harnesses partilham uma única entrada aos à frente do agente 1mcp; com ele desligado cada harness fala diretamente com cada servidor.</sub></p>

**Referência.** [docs/mcp-gateway.md](docs/mcp-gateway.md).

---

## Plugins e marketplace

**Manifest de plugin.** `.claude-plugin/plugin.json` + `marketplace.json` (gerado por `npm run plugin:build`). O AOS traz manifests de plugin para o Claude Code (`.claude-plugin/`), o Codex (`.codex-plugin/`) e o Antigravity (`plugin.json`); o OpenCode não tem conceito de marketplace e carrega antes um plugin local. Fontes: [docs/marketplaces.md](docs/marketplaces.md).

| Harness | Instalar | Atualizar |
|---|---|---|
| Claude Code | `claude plugin marketplace add hybridlabor-api/aos` · `claude plugin install bdb-aos@bdb-marketplace` | `claude plugin marketplace update bdb-marketplace` · `claude plugin update bdb-aos@bdb-marketplace` |
| Codex CLI | `codex plugin marketplace add hybridlabor-api/aos` · `codex plugin add bdb-aos@bdb-aos` | `codex plugin marketplace upgrade bdb-aos` · `codex plugin add bdb-aos@bdb-aos` |
| Antigravity (agy) | `agy plugin install <diretório de plugin local>` — o instalador npm faz isto por si | voltar a correr o instalador npm |
| OpenCode | plugin local `.opencode/plugins/bdb-aos.js`, copiado pelo instalador; sem marketplace | sobrescrever o ficheiro do plugin |

O marketplace do Claude `bdb-marketplace` oferece quatro plugins: `bdb-aos` (skills e subagents), `bdb-aos-fleet`, `bdb-aos-sessions` e `bdb-aos-alert`. Quando encontra o Claude Code, o instalador oferece os três mods (`-y` ativa-os) e regista-os ele próprio em `~/.claude/settings.json`; `--without=fleet,sessions,alert` ou `--profile=minimal` salta-os, e o Uninstall remove-os. O instalador npm continua a fazer o registo de plugins de cada harness na medida do possível; os comandos CLI acima são os equivalentes manuais. O caminho do marketplace transporta apenas skills e subagents — o instalador npm é o caminho recomendado porque também configura os gate hooks e os servidores MCP.

**Descoberta de skills.** Cada harness encontra skills no seu diretório nativo (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.roo/skills`, etc.). Para procurar e instalar skills adicionais após a instalação:

```bash
npx skills add hybridlabor-api/aos
```

Isto descobre todas as <!-- count:skills -->270<!-- /count --> skills curadas e instala-as no diretório universal `~/.agents/skills` (usado por todos os harnesses e pela AOS CLI).

---

## AOS CLI

Um harness de CLI leve construído sobre o [pi](https://github.com/earendil-works/pi), um agente de código que corre no terminal. A AOS CLI lê `~/.agents/skills` (escrito pelo instalador) e `~/.agents/AGENTS.md` (o dispatcher graph como instruções de sistema), não corre servidores MCP próprios e precisa de **Node >= 22.19** (o piso do pi, mais alto que o instalador principal do AOS).

```bash
aos-cli "what is the fastest way to fix this bug"
aos-cli --continue                    # retomar a sessão anterior
```

O lançador da CLI (`packages/aos-cli/bin/aos-cli.mjs`) acompanha um modo escuro com tema AOS (`aos.json`), as dez skills centrais de `core-skills.json` (ask-tim, aos-setup, systematic-debugging, archify, etc.), e dois comandos de sessão em só de leitura (`/aos` mostra o menu de instalação; `/aos-status` corre a verificação de saúde).

Instale-a pelo instalador AOS com o destino AOS CLI: `npx -y @hybridlabor-api/aos@latest -y --platforms=10`. O pacote é privado e não está publicado no npm, por isso `npm i -g @hybridlabor-api/aos-cli` não funciona.

---

## Memória e conhecimento

Instalados como módulos opcionais pelo instalador; o `aos doctor` verifica-os e o separador Services do AOS Hub mostra-os.

- **memB** (`@hybridlabor-api/memb`): memória vetorial local e offline com um servidor MCP (`add_memory`, `search_memory`, `list_memories`, `delete_memory`), uma WebUI na porta 8088 e um hook ambiente que injeta memórias relevantes em sessões de Claude Code. Skills: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.
- **deja** (`@vshulcz/deja-vu`, instalado com o memB): indexa as suas transcrições de agentes localmente com secrets redigidos; `deja fix` perante um erro, `deja wip` ao retomar, `deja search` para sessões passadas. Skill: `deja-memory`.
- **OpenWiki** (CLI `openwiki`): gera e refresca um wiki fundamentado de uma codebase, com um visualizador na porta 4321 e um daemon em segundo plano. Skill: `openwiki-skill`; o wiki próprio deste repositório está em [`.openwiki/`](.openwiki/quickstart.md).
- **Synapse** (`@hybridlabor-api/bdb-synapse`): renderiza um repositório como uma cidade de código 3D e reproduz sessões de agentes através dela. Skill: `synapse-integration-skill`.

O `aos-setup` leva uma máquina a um estado verificado para os quatro; o `aos-project-init` liga um projeto a eles (slug, wiki, memória, `AGENTS.md`).

---

## O que está incluído

### Os subagents (45)

**Roster.** <!-- count:agents -->45<!-- /count --> agentes são compilados para o formato nativo de agente do Claude Code, do Antigravity, do Codex e do OpenCode; Cursor, Windsurf, Roo e Aider não recebem nenhum e usam antes as regras no `AGENTS.md`. As fontes estão em [`agents/`](agents/). O AOS não fixa modelo: os agentes herdam o modelo da sessão, a menos que `.aos/pipeline.json` sobreponha um papel por harness ([docs/agent-models.md](docs/agent-models.md)).

| Grupo | Agentes |
|---|---|
| Nós de pipeline (7) | `architect`, `techlead`, `godmode-ui-ux`, `godmode-engineering`, `godmode-media-eventtech`, `reviewer`, `godmode-shipping` |
| Revisão e segurança (6) | `security-reviewer`, `silent-failure-hunter`, `database-reviewer`, `reviewer-1`, `reviewer-2`, `devils-advocate` |
| Revisores de linguagem (8) | `typescript-reviewer`, `python-reviewer`, `go-reviewer`, `rust-reviewer`, `java-reviewer`, `kotlin-reviewer`, `cpp-reviewer`, `csharp-reviewer` — só de leitura, compilados com edit e bash recusados |
| Ajudantes de build (3) | `go-build-resolver`, `opensource-forker`, `opensource-sanitizer` |
| Assistentes de domínio (5) | `spec-prd-creator`, `pcb-design-assistant`, `event-manager-assistant`, `live-media-operator`, `video-motion-assistant` |

**O que fazem os sete nós de pipeline.** O Architect transforma o objetivo num plano de sistema depois de ler a arquitetura existente. O TechLead transforma o plano num mapa de capacidades (limites de módulos, direção de dependências, ordem de build) antes de qualquer nó de build começar, e rejeita de volta ao Architect se não se sustainar. O `godmode-ui-ux` lidera o frontend, o `godmode-engineering` o backend, o `godmode-media-eventtech` o trabalho criativo e de show control. O Reviewer é uma revisão adversarial de correção do output do nó de build contra o contrato do plano; o Shipping corre o gate mecânico (lint, typecheck, testes, a11y, seo) e impõe o GO gate. Os 22 auxiliares não são nós do graph. Os subagents nunca herdam um GO e nunca se invocam entre si.

### Skills por categoria

**Categorias.** <!-- count:skills -->270<!-- /count --> skills curadas, descobertas por cada harness (o catálogo completo gerado está na secção seguinte). Oito categorias, impostas por `npm run validate`:

- **bdb-core**: infraestrutura central do AOS, pipelines, ferramentas e utilitários: `fabric`, `fabric-graph`, `fabric-multigraph`, `fabric-teamwork`, `fabric-swarm`, `fabric-loop`, `agenttrail`, `plan-canvas`, `aos-a2a`, `aos-gateway`, `aos-store`, `master-session`, `codebase-memory` e mais.
- **design-ui-ux**: frontend, design de UI, acessibilidade, tokens, motion, anti-slop: `senior-frontend`, `ui-ux-pro-max`, `tailwind-patterns`, `shadcn`, `wcag-audit-patterns` e mais.
- **engineering-method**: arquitetura, testes, debugging, CI/CD, qualidade de código: `software-architecture`, `test-driven-development`, `systematic-debugging`, `ci-pipeline`, `github-actions-generator`, `docker-expert`, `makefile-pro` e mais.
- **library**: especificidades de linguagens e frameworks: TypeScript, Node.js, Python, React, Postgres, Prisma, Next.js, Drizzle ORM, Go, Rust, Tauri e mais.
- **media-eventtech**: 3D, vídeo, show control, design espacial: `godmode-eventtech`, `threejs-skills`, as skills MCP de software criativo e mais.
- **engineering-hardware**: design de PCB e eletricidade: `godmode-hardware-pcb`.
- **saas-ops**: correr um SaaS de ponta a ponta: `golive`, `pb-deploy-saas`, `pb-health-weekly`.
- **business-ops**: o lado comercial de escritório: `pb-offer`, `pb-invoice-check`.

### Ver tudo

**Catálogo gerado.** Construído a partir dos ficheiros do repositório (frontmatter de cada `SKILL.md`, `agents/`, `commands/`). Abra uma secção para ver nomes e descrições de uma linha.
<!-- BEGIN GENERATED CATALOG: regenerate from the repo, do not hand-edit -->

<details>
<summary><b>Harnesses (9)</b></summary>

| Harness | Skills | Subagents | Hooks and gates | MCP | Extras |
|---|:---:|:---:|:---:|:---:|---|
| Claude Code / Desktop | yes | yes | yes (GO gate, graph gate, env-file protection, Conventional Commits, memB inject, trail relay, A2A inbox) | yes | slash commands, fleet band, plugin manifest |
| Google Antigravity (agy) | yes | yes | gate-only hooks | yes | `/bdb-aos:<cmd>` commands, inbox MCP for A2A |
| Codex CLI | yes | yes | GO gate, graph gate | yes | `$bdb-aos:<cmd>` commands, A2A queue/resume |
| OpenCode | yes | yes | via `bdb-aos.js` plugin | yes | `/bdb-aos-<cmd>` commands, A2A inject |
| Cursor | yes | no | no | yes | `.cursor/rules` |
| Windsurf | yes | no | no | yes | `mcp.json` |
| Roo Code / Cline | yes | no | no | yes | `.roomodes` |
| Aider | yes | no | no | no | none |
| AOS CLI (pi) | yes | system prompt | no | no | 10 core skills, dark theme |

</details>

<details>
<summary><b>Tools and CLIs (15)</b></summary>

| Command | What it does |
|---|---|
| `aos` | Installer menu: update, doctor, reconfigure, uninstall. |
| `aos doctor` | Verify dependencies, skill placement, daemons, hooks, modules, gateway. |
| `aos store` | Browse and install skills and agents (CLI and web UI on port 4322). |
| `aos-plan-canvas` | Open plans and HTML artifacts in the annotation canvas (port 4519). |
| `aos-trail` | agenttrail live map (port 5330). |
| `aos-archify` | Architecture and sequence diagrams as standalone HTML. |
| `aos-hub` | The AOS Hub on port 7900: Services, Catalog, Store, Plans. `aos-dashboard` is a thin alias. |
| `aos-services` (via `aos services`) | Status, start, stop and restart for every local service. |
| `aos-a2a` | List, send to and reply to live harness peers. |
| `aos-acp` | Start workers whose guarded commands need a GO token; `--sandbox coop\|wsl2` wraps one launch. |
| `aos-gateway` | Local MCP gateway: serve, enable, direct, adopt, status. |
| `aos-gogate` | Read-only gate status and presets. |
| `aos-gate` | Read or change the machine-wide gate profile. |
| `aos-sessions` | Read-only overview of every live session and ACP worker. |
| `aos-config` | Machine-level AOS configuration. |

</details>

<details>
<summary><b>MCP servers (21)</b></summary>

| Server | Domain |
|---|---|
| `github`, `chrome-devtools` | Issues, PRs, workflows; browser automation and debugging |
| `bdb_unreal_mcp` | Unreal Engine (Web Remote Control, port 30010) |
| `bdb_rhino_mcp`, `bdb_rhino_mcp_fallback` | Rhino 3D and Grasshopper |
| `bdb_davinci_mcp` | DaVinci Resolve |
| `bdb_grandma3_mcp` | grandMA3 (typed `ma3_*` tools) |
| `bdb_resolume_mcp` | Resolume Arena (REST, port 8080) |
| `adobe_uxp_mcp` | Adobe UXP bridge |
| `bdb_blender_mcp` | Blender |
| `bdb_after_effects_mcp`, `bdb_after_effects_mcp_fallback` | After Effects |
| `bdb_td_minddesigner`, `bdb_td_backup` | TouchDesigner (port 9980) |
| `zavora_computer_use`, `bdb_windows_computer_use` | Desktop control on macOS and Linux, and on Windows |
| `memb_mcp`, `deja` | Local memory and transcript search |
| `mcsc` | Delegation to other harnesses |
| `open_design_mcp` | Open Design |
| `bdb_remoteos_mcp` | RemoteOS multi-cloud gateway with 4-eyes approval |

</details>

<details>
<summary><b>Skills (219)</b></summary>

<details>
<summary><b>library (85)</b></summary>

| Skill | What it does |
|---|---|
| `ai-agent-development` | AI agent development workflow for building autonomous agents, multi-agent systems, and agent orchestration with CrewAI, LangGraph, and custom agents. |
| `ai-product` | Every product will be AI-powered. |
| `api-design-principles` | Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers and stand the test of time. |
| `api-patterns` | API design principles and decision-making. |
| `apify-lead-generation` | Scrape leads from multiple platforms using Apify Actors. |
| `apify-ultimate-scraper` | AI-driven data extraction from 55+ Actors across all major platforms. |
| `bash-linux` | Bash/Linux terminal patterns. |
| `brainstorming` | Use before creative or constructive work (features, architecture, behavior). |
| `browser-automation` | Browser automation powers web testing, scraping, and AI agent interactions. |
| `cloudflare-workers-expert` | Expert in Cloudflare Workers and the Edge Computing ecosystem. |
| `copywriting` | Write rigorous, conversion-focused marketing copy for landing pages and emails. |
| `crewai` | Expert in CrewAI, the leading role-based multi-agent framework. |
| `database-design` | Database design principles and decision-making. |
| `debugger` | Debugging specialist for errors, test failures, and unexpected behavior. |
| `deep-research` | Run autonomous research tasks that plan, search, read, and synthesize information into comprehensive reports. |
| `docker-expert` | Advanced Docker containerization: optimization, security hardening, multi-stage builds, orchestration. |
| `documentation` | Documentation generation workflow covering API docs, architecture docs, README files, code comments, and technical writing. |
| `drizzle-orm-expert` | Expert in Drizzle ORM for TypeScript: schema design, relational queries, migrations, and serverless database integration. |
| `firecrawl` | Search, scrape, and interact with the web via the Firecrawl CLI. |
| `firecrawl-sdk` | Integrate Firecrawl into product code: SDK setup and FIRECRAWL_API_KEY onboarding, /scrape, /search and /interact endpoints. |
| `gemini-api-dev` | The Gemini API provides access to Google's most advanced AI models. |
| `gemini-api-integration` | Use when integrating Google Gemini API into projects. |
| `geo-fundamentals` | Generative Engine Optimization for AI search engines (ChatGPT, Claude, Perplexity). |
| `git-advanced-workflows` | Master advanced Git techniques to maintain clean history, collaborate effectively, and recover from any situation. |
| `git-pr-review` | Generate a concise and structured PR description from commit history with minimal token usage. |
| `github` | Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries. |
| `github-actions-templates` | Production-ready GitHub Actions workflow patterns for testing, building, and deploying applications. |
| `github-workflow-automation` | Patterns for automating GitHub workflows with AI assistance. |
| `go-concurrency-patterns` | Master Go concurrency with goroutines, channels, sync primitives, and context. |
| `go-playwright` | Robust browser automation using Playwright Go. |
| `golang-pro` | Master Go 1.21+ with modern patterns, advanced concurrency, performance optimization, and production-ready microservices. |
| `landing-page-generator` | Generates high-converting Next.js/React landing pages with Tailwind CSS. |
| `linear-claude-skill` | Manage Linear issues, projects, and teams. |
| `llm-app-patterns` | Production-ready patterns for building LLM applications. |
| `llm-application-dev-ai-assistant` | Creating intelligent conversational interfaces, chatbots, and AI-powered applications. |
| `llm-prompt-optimizer` | Use when improving prompts for any LLM. |
| `llm-structured-output` | Get reliable JSON, enums, and typed objects from LLMs using response_format, tool_use, and schema-constrained decoding. |
| `local-llm-expert` | Master local LLM inference, model selection, VRAM optimization, and local deployment using Ollama, llama.cpp, vLLM, and LM Studio. |
| `microservices-patterns` | Microservices architecture patterns: service boundaries, inter-service communication, data management, resilience. |
| `modern-javascript-patterns` | Modern JavaScript (ES6+) features, functional programming patterns, and best practices. |
| `monorepo-management` | Build efficient, scalable monorepos that enable code sharing, consistent tooling, and atomic changes. |
| `n8n-code-javascript` | Write JavaScript code in n8n Code nodes. |
| `n8n-code-python` | Write Python code in n8n Code nodes. |
| `n8n-expression-syntax` | Validate n8n expression syntax and fix common errors. |
| `n8n-mcp-tools-expert` | Expert guide for using n8n-mcp MCP tools effectively. |
| `n8n-workflow-patterns` | Proven architectural patterns for building n8n workflows. |
| `neon-postgres` | Expert patterns for Neon serverless Postgres, branching, connection pooling, and Prisma/Drizzle integration. |
| `nextjs-app-router-patterns` | Next.js 14+ App Router architecture, Server Components, and modern full-stack React development. |
| `nextjs-best-practices` | Next.js App Router principles. |
| `obsidian-markdown` | Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, and properties. |
| `openapi-spec-generation` | Generate and maintain OpenAPI 3.1 specifications from code, design-first specs, and validation patterns. |
| `os-scripting` | Operating system and shell scripting troubleshooting workflow for Linux, macOS, and Windows. |
| `playwright-skill` | General-purpose browser automation skill. |
| `posix-shell-pro` | Expert in strict POSIX sh scripting for maximum portability across Unix-like systems. |
| `postgres-best-practices` | Postgres performance optimization and best practices from Supabase. |
| `postgresql` | Design a PostgreSQL-specific schema. |
| `prisma-expert` | Prisma ORM: schema design, migrations, query optimization, relations modeling, and database operations. |
| `product-manager-toolkit` | Essential tools and frameworks for modern product management, from discovery to delivery. |
| `programmatic-seo` | Design and evaluate programmatic SEO strategies for creating SEO-driven pages at scale. |
| `python-patterns` | Python development principles and decision-making. |
| `python-performance-optimization` | Profile and optimize Python code using cProfile, memory profilers, and performance best practices. |
| `python-pro` | Master Python 3.12+ with modern features, async programming, performance optimization, and production-ready practices. |
| `rag-engineer` | Expert in building Retrieval-Augmented Generation systems. |
| `rag-implementation` | RAG implementation workflow: embedding selection, vector database setup, chunking strategies, retrieval optimization. |
| `react-best-practices` | Performance optimization guide for React and Next.js applications, maintained by Vercel. |
| `react-component-performance` | Diagnose slow React components and suggest targeted performance fixes. |
| `react-patterns` | Modern React patterns and principles. |
| `readme` | Technical writer for comprehensive project documentation. |
| `remotion` | Generate walkthrough videos from Stitch projects using Remotion with transitions, zooming, and text overlays. |
| `schema-markup` | Design, validate, and optimize schema.org structured data for eligibility, correctness, and measurable SEO impact. |
| `seo` | Run a broad SEO audit across technical SEO, on-page SEO, schema, sitemaps, content quality, AI search readiness, and GEO. |
| `seo-audit` | Diagnose and audit SEO issues affecting crawlability, indexation, rankings, and organic performance. |
| `seo-technical` | Audit technical SEO across crawlability, indexability, security, URLs, mobile, Core Web Vitals, and structured data. |
| `tanstack-query-expert` | Expert in TanStack Query (React Query), asynchronous state management. |
| `tmux` | Expert tmux session, window, and pane management for terminal multiplexing and persistent remote workflows. |
| `turborepo-caching` | Configure Turborepo for efficient monorepo builds with local and remote caching. |
| `typescript-pro` | Master TypeScript with advanced types, generics, and strict type safety. |
| `using-neon` | Neon serverless Postgres: autoscaling, branching, instant restore, scale-to-zero. |
| `vector-database-engineer` | Expert in vector databases, embedding strategies, and semantic search implementation. |
| `vercel-ai-sdk-expert` | Expert in the Vercel AI SDK. |
| `vercel-deployment` | Expert knowledge for deploying to Vercel with Next.js. |
| `web-artifacts-builder` | Build powerful frontend claude.ai artifacts. |
| `web-performance-optimization` | Optimize loading speed, Core Web Vitals, bundle size, caching strategies, and runtime performance. |
| `web-scraper` | Multi-strategy intelligent web scraping. |
| `zustand-store-ts` | Create Zustand stores following established patterns with proper TypeScript types and middleware. |

</details>

<details>
<summary><b>engineering-method (55)</b></summary>

| Skill | What it does |
|---|---|
| `agent-tool-builder` | Tools are how AI agents interact with the world: schema to error handling. |
| `agentic-harness-patterns` | Harness patterns for coding agents: memory, permissions, context engineering, delegation, skills, hooks, bootstrap. |
| `archify` | Validated architecture, workflow, sequence, data-flow, and state diagrams as explorable standalone HTML with inline SVG. |
| `architect-review` | Master software architect specializing in modern architecture. |
| `bdb-computer-use-mcp` | Native Rust/Node and Python computer-use servers to control macOS, Windows, and Linux desktops. |
| `bdb-security-audit` | Security auditing, diff analysis, defensive checklists, and vulnerability testing. |
| `bdb-shipping-skill` | Problem-framing pre-flight, one-way/two-way door classification, ADR-lite decision logging, post-ship outcome loop. |
| `ci-pipeline` | Set up a complete CI/CD pipeline for a project. |
| `clean-code` | The principles of "Clean Code". |
| `concise-planning` | Generate a clear, actionable, atomic checklist for a coding task. |
| `diagnosing-bugs` | Diagnosis loop for hard bugs and performance regressions. |
| `dispatching-parallel-agents` | Use when facing 2+ independent tasks that can be worked on without shared state. |
| `domain-modeling` | Build and sharpen a project's domain model. |
| `executing-plans` | Execute a written implementation plan in a separate session with review checkpoints. |
| `factory` | >- |
| `factory-babysit-pr` | >- |
| `factory-collect` | Experimental workflow for collecting and triaging product feedback, telemetry, runtime errors, and issue reports. |
| `factory-lookback` | Experimental workflow for auditing recurring feedback, telemetry, and errors to find systemic fixes. |
| `factory-recover` | >- |
| `factory-review-prs` | Experimental workflow for reviewing configured repositories' pull requests. |
| `factory-ship` | >- |
| `factory-watchdog` | >- |
| `finishing-a-development-branch` | Decide how to integrate finished work once implementation is complete and tests pass. |
| `github-actions-generator` | Create, generate, or scaffold GitHub Actions workflows and CI/CD pipelines. |
| `github-actions-validator` | Validate, lint, audit, fix GitHub Actions workflows. |
| `github-repo` | Standards and workflows for writing, sanitizing, and publishing high-quality GitHub repositories. |
| `godmode-engineering` | Senior Fullstack and Backend Engineer. |
| `godmode-shipping` | Release Gatekeeper, QA and Verification Auditor. |
| `grill-me` | A relentless interview to sharpen a plan or design. |
| `grill-with-docs` | Like grill-me, and builds the project's domain model (glossary and ADRs) as it goes. |
| `grilling` | Grill the user relentlessly about a plan, decision, or idea. |
| `makefile-pro` | Generate, scaffold, validate and lint Makefiles and .mk files: .PHONY targets, build automation, common mistakes. |
| `planning-with-files` | Use persistent markdown files as working memory on disk. |
| `pr-recap` | Visual recap page for a PR or git range: changed-files tree, per-file notes, Verified vs Not verified table, risks. |
| `prompt-engineer` | Transforms prompts into optimized prompts using frameworks (RTF, RISEN, Chain of Thought, and more). |
| `prompt-engineering-patterns` | Advanced prompt engineering techniques to maximize LLM performance, reliability, and controllability. |
| `prototype` | Build a throwaway prototype to answer a design question. |
| `read-the-damn-docs` | Read the docs before implementing, integrating, upgrading, or debugging anything third-party. |
| `requesting-code-review` | Verify work meets requirements after completing tasks or before merging. |
| `reverse-engineer-anything` | Reverse engineer native, managed, Electron/JS, packaged, firmware, and browser targets with REA. |
| `simplify-code` | Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes. |
| `software-architecture` | Guide for quality-focused software architecture. |
| `subagent-driven-development` | Execute implementation plans with independent tasks in the current session. |
| `systematic-debugging` | Use on any bug, test failure, or unexpected behavior, before proposing fixes. |
| `tdd` | Test-driven development. |
| `test-driven-development` | Use when implementing any feature or bugfix, before writing implementation code. |
| `to-spec` | Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed. |
| `triage` | Move issues and external PRs through a state machine of triage roles and write agent-ready briefs. |
| `two-axis-code-review` | Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding sta... |
| `using-git-worktrees` | Ensure an isolated workspace for feature work and plan execution. |
| `verification-before-completion` | Run verification commands and confirm output before claiming work is complete or passing. |
| `wayfinder` | Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time un... |
| `wcag-audit-patterns` | Audit web content against WCAG 2.2 with actionable remediation strategies. |
| `webapp-testing` | Test local web applications with native Python Playwright scripts. |
| `writing-plans` | Write a plan for a multi-step task from a spec, before touching code. |

</details>

<details>
<summary><b>bdb-core (45)</b></summary>

| Skill | What it does |
|---|---|
| `agent-manager-skill` | Manage multiple local CLI agents via tmux sessions with cron-friendly scheduling. |
| `agent-memory-mcp` | Hybrid memory system: persistent, searchable knowledge management for AI agents. |
| `agent-pipeline` | Reference for the seven-node dispatcher graph that /fabric-graph runs. |
| `agenttrail` | Live map of a multi-agent build in the browser: which plan component, which agent or harness, what is done, what is stuck. |
| `ao-orchestrator` | Multi-project orchestrator across repositories using the Agent Orchestrator (AO) daemon. |
| `aos-a2a` | List, send to and reply to live harness peers (Claude Code, OpenCode, Codex, agy) over A2A on localhost. |
| `aos-gateway` | Use the local MCP gateway and the per-app MCP picks. |
| `aos-project-init` | Interview a project folder into AOS: slug and domain, OpenWiki, memB, Synapse map, AGENTS.md. |
| `aos-setup` | Bring a machine to a complete, verified AOS installation. |
| `aos-store` | Browse, preview, and install AOS Core, ECC and Scenario skills and agents from a local web UI. |
| `ask-tim` | Ask which skill or flow fits your situation. |
| `bdb-aos` | Entry point for the BDB Agent OS suite installed as a Claude Code plugin. |
| `bdb-deploy` | Build and deploy a project to a real server via rsync over SSH. |
| `bdb-memb-mcp` | Model Context Protocol interface to the memB persistent agent memory layer. |
| `bdb-updater` | Proactively check for and install updates to the AOS package via npm. |
| `bdbhtmlmanueldocs` | Design system, standalone HTML template and GitHub Pages hosting workflow for neutral developer documentation. |
| `bdbrainstorm` | Multi-agent brainstorming, /grill-me and the Core Godmodes, ending in a hand-off to /fabric-graph. |
| `bdbresilience` | CI/CD error recovery, file-based locking, diagnostic triage, and two-phase GO gate resilience for multi-agent pipelines. |
| `codebase-memory` | >- |
| `deja-memory` | Use `deja fix` on an error, `deja wip` when resuming, `deja search` for past sessions. |
| `design-control-loop` | Interview the user to design an agentic control loop tailored to their codebase, then build it. |
| `factory-human-digest` | Experimental workflow for summarizing work that still needs human judgment. |
| `gogate` | Show or explain the AOS go-gate mode (hard, soft, off) and the time-limited grants of this session. |
| `instinct-export` | >- |
| `instinct-import` | >- |
| `instinct-status` | >- |
| `loop-templates` | Repeat a task on a schedule or until a condition holds (CI until green, follow a PR to merge). |
| `master-session` | One Claude Code session supervises several others: roster, status requests, GO board, idle notices, GO-token protocol. |
| `mcsc` | Delegate a task to another installed CLI harness (agy, OpenCode, Codex) from inside an AOS repo. |
| `memb-ingest` | Deep scan and ingest project files and past conversation logs into the local memB vector memory engine. |
| `memb-skill` | BDB local-first long-term memory engine (memB). |
| `openwiki-skill` | Initialize, update, and visualize codebase or personal knowledge wikis using OpenWiki. |
| `orchestrator-chain` | Hand work down the chain master session, project orchestrator, package orchestrator. |
| `plan-arbiter` | Compare, cross-review, merge, or arbitrate competing plans from multiple agents. |
| `plan-canvas` | Open plans and HTML artifacts in a local browser canvas where the human annotates, chats, and approves. |
| `quick-recap` | End each agent response with a red/yellow/green status line. |
| `skill-create` | >- |
| `fabric` | Master entry for the fabric family: picks the fitting mode for the task and says why. |
| `fabric-graph` | The autonomous multi-agent build pipeline with durable state, repair loop and escalation. |
| `fabric-loop` | Repeat-until-done mode. Arrives in 5.4.1; routes to loop-templates meanwhile. |
| `fabric-multigraph` | A small, throwaway multi-agent fan-out in any project. |
| `fabric-swarm` | N similar workers take items from one shared pool (`swarm.json`). |
| `fabric-teamwork` | Interactive 9-step prompt crafting and delegation protocol for autonomous multi-agent teams. |
| `stay-within-limits` | Respect 5-hour and weekly usage limits by checking usage between waves and pausing near the cap. |
| `subagent-setup` | Configure and synchronize multi-harness subagents with optional per-harness model overrides. |
| `synapse-integration-skill` | BDB Synapse (3D Codebase Visualizer) integration. |
| `token-saver-config` | Context window output compression engine for CLI commands. |

</details>

<details>
<summary><b>media-eventtech (19)</b></summary>

| Skill | What it does |
|---|---|
| `bdb-adobe-suite-mcp` | Automate Photoshop, Illustrator, Premiere Pro, and After Effects via ExtendScript and UXP bridges. |
| `bdb-after-effects-mcp` | Compositions, layers, masks, keyframe animations, and ExtendScript in After Effects. |
| `bdb-blender-mcp` | Build 3D assets, apply materials, inspect scenes, and script bpy in Blender. |
| `bdb-davinci-mcp` | DaVinci Resolve timeline editing, media analysis, color grading, Fusion and Fairlight scripting. |
| `bdb-eventagency-skill` | Event agency operations: client intake, scoping, vendors, crew, production planning, pre-show logistics, wrap. |
| `bdb-grandma3-mcp` | Patch fixtures, execute console commands, and trigger macros on grandMA3. |
| `bdb-resolume-mcp` | Trigger clips, clear layers, adjust speeds, and query composition status in Resolume Arena. |
| `bdb-rhino-mcp` | Create and manipulate 3D models and run Grasshopper graphs in Rhino. |
| `bdb-touchdesigner-mcp` | TOP/CHOP chains, operator scripting, parameter inspection, and node-network debugging in TouchDesigner. |
| `bdb-unreal-mcp` | Control UE5 through a native C++ Automation Bridge plugin. |
| `bdb-vectorworks-mcp` | Search and retrieve Vectorworks Python and VectorScript API documentation. |
| `bdbmediastorm` | Brainstorm live event technology, show control, and real-time media systems. |
| `brag` | Turn the current project website into a short, shareable launch video. |
| `godmode-3d-creation` | 3D meshes, text-to-CAD, and scene reconstruction via TRELLIS, TripoSR, or Text-to-CAD engines. |
| `godmode-eventtech` | Real-time performance and multimedia operator work: signal flows, OSC/DMX, MCP orchestration, hardware limits. |
| `godmode-media-creation` | Assemble video timelines, sync beats, and create media via OpenMontage, Palmier Pro, or TouchDesigner. |
| `mcp-manage` | Check capabilities and guide use of specialized MCP servers like Unreal, Rhino, DaVinci, or TouchDesigner. |
| `spline-3d-integration` | Interactive 3D scenes from Spline.design in web projects. |
| `threejs-skills` | Create 3D scenes, interactive experiences, and visual effects using Three.js. |

</details>

<details>
<summary><b>design-ui-ux (13)</b></summary>

| Skill | What it does |
|---|---|
| `bdb-ui-library` | >- |
| `bdb-visual-edit` | Edit source from an element the human points at in a running local dev app. |
| `bdbdesignpro` | Animation engine choice, motion tokens, scroll effects, micro-interactions, motion accessibility. |
| `design-spells` | Curated micro-interactions, delightful animations, and subtle design details. |
| `editable-design` | Fixed-canvas editable visual designs: posters, marketing graphics, covers, menus, banners, social cards. |
| `frontend-dev-guidelines` | Senior frontend engineering under strict architectural and performance standards. |
| `godmode-ui-ux` | Lead Frontend Designer and UI Engineer. |
| `live-preview-canvas` | Local HTML mock with a built-in feedback layer for visual comments. |
| `senior-frontend` | React components, Next.js performance, accessibility, frontend code quality. |
| `shadcn` | Add, customize, and troubleshoot shadcn/ui components. |
| `tailwind-patterns` | Tailwind CSS v4, CSS-first configuration, container queries, design token architecture. |
| `ui-ux-pro-max` | Comprehensive design guide for web and mobile applications. |
| `ux-persuasion-engineer` | Behavioral UX: choice architecture, friction audits, commitment design, without coercion. |

</details>

<details>
<summary><b>engineering-hardware (1)</b></summary>

| Skill | What it does |
|---|---|
| `godmode-hardware-pcb` | Electrical schematics, PCB layouts, KiCad projects, OpenSCAD enclosures: DFM/DRC/ERC sign-off and co-design. |

</details>

<details>
<summary><b>saas-ops (1)</b></summary>

| Skill | What it does |
|---|---|
| `golive` | Take an agent-written app from repo to live production on the user's OWN accounts, with providers they choose (hosting, database, auth, payments, email, doma... |

</details>

</details>

<details>
<summary><b>Playbooks (37)</b></summary>

| Playbook | What it does |
|---|---|
| `pb-aos-e2e` | AOS release E2E check in a clean sandbox: tarball install, doctor, gate hooks, memB inject, hub, update, uninstall. |
| `pb-bug-fix` | Turn a GitHub issue into a tested fix on a branch with an open PR. |
| `pb-ci-fix` | Fix red CI or set up GitHub Actions end to end; push only after GO. |
| `pb-clip-from-moodboard` | Turn a look brief and reference images into a finished social clip. |
| `pb-content-studio` | >- |
| `pb-crew-call-sheet` | Build a crew call sheet and a load-in / load-out plan for one show day. |
| `pb-deploy-saas` | Deploy a SaaS app to the BDB fleet: preflight, guardrail plan, green CI, deploy after GO, health check. |
| `pb-docs-site` | Publish a project's docs as a static HTML manual on GitHub Pages. |
| `pb-event-tracker` | One spreadsheet for an event: guests, vendors, timeline, budget. |
| `pb-focus-chunks` | Split one big task into chunks of at most 25 minutes, each with a done-check. |
| `pb-handover` | Write a handover note for a colleague from the state of a project folder. |
| `pb-harness-work` | Change the agent harness itself (hooks, gates, memory, permissions, plugins) the safe way. |
| `pb-health-weekly` | Weekly health report over the BDB repos: version drift and CI status. |
| `pb-idea-to-launch` | Turn an idea into a deployed prototype. |
| `pb-image-to-3d` | Turn one reference image into a cleaned, scaled 3D asset. |
| `pb-inbox-zero` | Sort an email backlog into reply, delegate, archive and ignore, and draft the replies. |
| `pb-invoice-check` | Check invoices and receipts line by line against your offers. |
| `pb-landing-page` | Build and launch a landing page: confirmed copy, brand tokens, UI and SEO review, deploy after GO. |
| `pb-launch-video` | Turn a live app or landing page into a short launch video. |
| `pb-machine-setup` | Bring a new machine to a verified AOS installation. |
| `pb-master` | One control session over several Claude Code, Codex or OpenCode sessions: roster, status board, GO board. |
| `pb-meeting-actions` | Turn a meeting transcript into notes, decisions and owners; send the follow-up only after GO. |
| `pb-newsletter` | Turn a recap or changelog range into a newsletter draft where every claim cites a source line. |
| `pb-offer` | Draft a client offer with line items priced only from your price list. |
| `pb-open-source` | Prepare a project for open sourcing: sanitized fork, sanitizer verdict, README and LICENSE, new private repo. |
| `pb-pcb-to-case` | From a KiCad board to a parametric enclosure that fits it. |
| `pb-project-new` | Start a new private GitHub project the AOS way. |
| `pb-redesign-app` | Overhaul one app's UI against an audit. |
| `pb-release-aos` | Release a new AOS version to npm through the release-please PR, merged only after GO. |
| `pb-security-sweep` | Security sweep over one repo: secrets, dependencies, diff, one ranked findings report. |
| `pb-ship` | Ship the day's work in one repo: triage, review every open PR, merge. |
| `pb-show-build` | Build a show across lights (grandMA3), media (Resolume) and visuals (TouchDesigner) from one cue list. |
| `pb-social-pack` | Turn a release recap into a social pack where every claim traces to a facts file. |
| `pb-tauri-e2e` | Multi-phase E2E, live-app, and binary security audit for Tauri v2 desktop apps. |
| `pb-todo` | Turn one sentence into a task line in the right to-do list. |
| `pb-week-plan` | Turn scattered to-do lists and notes into one prioritised plan for the week. |
| `pb-worktrees-land` | Clean up git worktrees across your repos; removes only merged ones. |

</details>

<details>
<summary><b>Subagents (45)</b></summary>

| Agent | What it does |
|---|---|
| `architect` | Turns the user's goal into a system plan. |
| `code-reviewer` | Independent read-only general code reviewer: code health, architecture boundaries, edge cases, error handling, and maintainability. |
| `comment-analyzer` | Independent read-only code comment analyzer: documentation drift, comment accuracy, security disclosures, and comment hygiene. |
| `cpp-reviewer` | Independent read-only C++ code reviewer: memory safety, modern C++ idioms, concurrency, and performance for `.cpp`/`.hpp`/`.cc`/`.h` changes. |
| `csharp-reviewer` | Independent read-only C#/.NET code reviewer: .NET conventions, async patterns, security, nullable reference types, EF Core. |
| `database-reviewer` | PostgreSQL specialist for query optimization, schema design, security, and performance. |
| `devils-advocate` | Argues against the plan or diff under review: hunts unstated assumptions, missing failure modes, and the case where the proposed approach is the wrong one. |
| `django-reviewer` | Independent read-only Django code reviewer: ORM query efficiency, security, transactions, view architecture, and migrations. |
| `event-manager-assistant` | Event production planning assistant: run of show, technical riders, crew plans, schedules and budgets, load-in planning, and vendor lists. |
| `fastapi-reviewer` | Independent read-only FastAPI code reviewer: async route correctness, Pydantic schemas, dependency injection, and API design. |
| `flutter-reviewer` | Independent read-only Flutter/Dart code reviewer: widget lifecycle, state management, rebuild performance, and platform patterns. |
| `fsharp-reviewer` | Independent read-only F# code reviewer: functional purity, algebraic data types, async workflows, and .NET interop. |
| `go-build-resolver` | Resolves Go build, vet, and compilation errors with minimal changes. |
| `go-reviewer` | Independent read-only Go code reviewer: idiomatic Go, concurrency, error handling, and performance for `.go` changes. |
| `godmode-engineering` | Senior Fullstack and Backend Engineer. |
| `godmode-media-eventtech` | Creative-Tech and Show-Control Specialist. |
| `godmode-shipping` | Release Gatekeeper, QA and Verification Auditor. |
| `godmode-ui-ux` | Lead Frontend Designer and UI Engineer. |
| `healthcare-reviewer` | Independent read-only healthcare application reviewer: HIPAA compliance, PHI protection, medical data schemas, and audit logging. |
| `java-reviewer` | Independent read-only Java code reviewer for Spring Boot and Quarkus projects: layered architecture, JPA/Panache, security, concurrency, testing. |
| `kotlin-reviewer` | Independent read-only Kotlin/Android/KMP code reviewer: idiomatic Kotlin, coroutine and Flow safety, Compose recomposition traps, clean architecture, Android... |
| `live-media-operator` | Live show operator for grandMA3, media servers such as Resolume, and TouchDesigner networks. |
| `mle-reviewer` | Independent read-only machine learning engineering reviewer: training pipelines, data leakage, inference latency, drift, and numerical stability. |
| `network-config-reviewer` | Independent read-only network configuration reviewer: routing protocols, ACLs, VLANs, firewall policies, and device security. |
| `opensource-forker` | Forks a project for open-sourcing: strips secrets and internal references. |
| `opensource-sanitizer` | Verifies an open-source fork is fully sanitized before release. |
| `pcb-design-assistant` | PCB design assistant for KiCad-centered hardware work: schematic and layout review, DRC/ERC clearance, stackup and impedance constraints, BOM checks, and man... |
| `php-reviewer` | Independent read-only PHP code reviewer: modern PHP 8.x idioms, Laravel/Symfony frameworks, OWASP security, and type safety. |
| `pr-test-analyzer` | Independent read-only pull request test coverage analyzer: assertion strength, mocking integrity, edge cases, and test flakiness. |
| `python-reviewer` | Independent read-only Python code reviewer: Pythonic idioms, PEP 8, type hints, security, and concurrency for `.py` changes. |
| `rag-pipeline-reviewer` | Independent read-only RAG pipeline reviewer: chunking strategy, embeddings, vector indexing, retrieval quality, and prompt injection defense. |
| `react-reviewer` | Independent read-only React code reviewer: hooks correctness, component lifecycle, Next.js architecture, render performance, and accessibility. |
| `reviewer` | Adversarial review of build-node output against the plan's contract. |
| `reviewer-1` | Independent adversarial reviewer, correctness focus: logic errors, broken edge cases, mismatches between the plan's stated contract and the implementation, a... |
| `reviewer-2` | Independent adversarial reviewer, security and operability focus: injection, leaked secrets, auth gaps, silent failures, and rollback/deployment hazards. |
| `rust-reviewer` | Independent read-only Rust code reviewer: ownership, lifetimes, unsafe usage, error handling, and idiomatic patterns for `.rs` changes. |
| `security-reviewer` | Security vulnerability detection and remediation. |
| `silent-failure-hunter` | Reviews code for silent failures, swallowed errors, bad fallbacks. |
| `spec-prd-creator` | Turns a raw idea into a spec/PRD: goals, non-goals, user stories, acceptance criteria, and open questions. |
| `swift-reviewer` | Independent read-only Swift code reviewer: Swift Concurrency, memory safety (ARC), SwiftUI/UIKit architecture, and Apple platform patterns. |
| `techlead` | Reviews the plan for a capability map before any build node starts. |
| `type-design-analyzer` | Independent read-only type design analyzer: encapsulation, domain modeling precision, algebraic data types, and type-system safety. |
| `typescript-reviewer` | Independent read-only TypeScript/JavaScript code reviewer: type safety, async correctness, Node/web security, and idiomatic patterns for `.ts`/`.tsx`/`.js`/`... |
| `video-motion-assistant` | Code-driven video and motion specialist, carved out of godmode-media-eventtech: programmatic video generation and editing, After Effects and Premiere automat... |
| `vue-reviewer` | Independent read-only Vue.js code reviewer: Vue 3 Composition API, reactivity rules, Pinia state, Nuxt architecture, and component performance. |

</details>

<details>
<summary><b>Slash commands (15)</b></summary>

| Command | What it does |
|---|---|
| `/brainstorm` | Brainstorm a topic with the matching skill: bdbrainstorm, bdbmediastorm, grill-me. |
| `/doctor` | Check the machine and project, and print suggested permissions.allow entries without writing settings. |
| `/graph` | Run the fabric-graph pipeline. |
| `/hub` | Open the AOS Hub on 127.0.0.1:7900 (services, plan kits, store) or stop/status it. |
| `/init` | Set up the current project folder for AOS. |
| `/loop` | Run a prompt repeatedly on an interval. |
| `/mastersession` | Supervise other Claude Code sessions: roster, status, GO board, idle notices. |
| `/memb` | Query or store long-term memory with memB. |
| `/orchestrator` | Coordinate parallel coding agents across repositories through the AO daemon. |
| `/plan` | Plan end to end: draft, render in plan-canvas, annotate, await approval, hand off. |
| `/playbooks` | List all pb-* playbooks and start one. |
| `/setup` | Bring this machine to a complete, verified AOS installation. |
| `/shipping` | Pre-ship framing and the technical release gate, with approvals under the go-gate rules. |
| `/startproject` | Start a new composition: project init, brainstorm, then pick a fabric mode. |
| `/store` | Browse and preview AOS skills, agents and playbooks in the local store UI. |

</details>


<!-- END GENERATED CATALOG -->

---

## Skills

<!-- count:skills -->270<!-- /count --> skills, curadas de coleções open source e proprietárias, cobrindo toda a pipeline de desenvolvimento de software e criativa. Cada skill é um diretório com um `SKILL.md` cujo frontmatter declara `name`, `description` e uma `category`: `bdb-core`, `design-ui-ux`, `engineering-method`, `engineering-hardware`, `media-eventtech`, `library`, `saas-ops`, `business-ops`.

**Camada de personae.** As skills **Godmode** são personae especializadas que mapeiam diretamente nos nós de build e ship do dispatcher graph.

Todo o trabalho de UI/UX — a persona `godmode-ui-ux` e as skills de design por onde ela encaminha, como a `bdbdesignpro` — busca os componentes primeiro na biblioteca fixada de componentes e motion icons da BDB (registo shadcn `@bdb`, suportado pelo pacote npm `@hybridlabor-api/ui-motion-library`), antes de recorrer a registos de terceiros ou de construir do zero.

| Godmode | Governa | Mapeia em |
|---|---|---|
| `godmode-engineering` | Domain-Driven Design, Clean Architecture, TypeScript/Python estrito, debugging sistemático, boas práticas de base de dados. | Nó **Engineering** |
| `godmode-ui-ux` | Princípios frontend anti-slop, design tokens DTCG, dinâmica de motion, acessibilidade (WCAG), gosto de alta iniciativa. | Nó **UI_UX** |
| `godmode-shipping` | Verificações pré-lançamento, quality gates automatizados, procedimentos de rollback seguros, imposição do go-gate. | Nó **Shipping** |
| `godmode-eventtech` | Show control, fluxo de sinal, iluminação DMX, redes TouchDesigner, servidores de media Resolume, hardware de eventos ao vivo. | Nó **Media_EventTech** |
| `godmode-3d-creation` | Geração 3D MCP-first, reconstrução de meshes, CAD paramétrico, modelação espacial. | Especialista opcional |
| `godmode-media-creation` | Produção de vídeo, montagem de timelines, pipelines de motion design, OpenMontage, Remotion. | Especialista opcional |
| `godmode-hardware-pcb` | Esquemas elétricos, layout e roteamento de PCB, gate KiCad ERC/DRC/DFM, co-design de caixas, OpenSCAD. | Especialista opcional |

**Pontos de entrada e navegação.**

- **`ask-tim`**: recomendação de skill por descrição
- **`bdbrainstorm`** e **`bdbmediastorm`**: sessões de ideias multi-agente que terminam num plano executável
- **`fabric-teamwork`**: elaboração de prompts, delegação de papéis, configuração de colaboração
- **Família grilling**: `grill-me` (auditoria geral), `grill-with-docs` (ancorado em documentação), `triage` (priorização)
- **CI/CD e geradores**: `ci-pipeline`, `github-actions-generator`, `docker-expert`, `makefile-pro`
- **Qualidade de código**: `bdb-security-audit`, `systematic-debugging`, `silent-failure-hunter`, `bdbresilience`
- **Especialistas de frameworks**: cobertura completa de TypeScript, React, Next.js, Drizzle ORM, Prisma, Python, Go e mais

**Skills CLI.** A biblioteca também é legível pela skills CLI:

```bash
npx skills add hybridlabor-api/aos
```

### Playbooks

36 playbooks `pb-*` transformam trabalhos recorrentes em execuções guiadas com GO points declarados. Como corre uma execução e a tabela completa por domínio: ver [Playbooks](#playbooks).

---

## Módulos opcionais

**Opcionais por design.** O seletor de módulos do instalador oferece-os e o Quick Update os mantém atuais. O AOS funciona sem nenhum deles. Escolha-os de forma não interativa com `-y --modules=<id>,<id>` ou `AOS_MODULES`; os ids são os nomes abaixo mais `rustauri`, `styleseed` e `codebase-memory`. Tudo o que é vendado vem dentro do kernel, portanto instala sem download.

### memB: memória vetorial local

`@hybridlabor-api/memb`: memória vetorial offline e local com um servidor MCP, WebUI na porta 8088 e um hook ambiente que injeta memórias relevantes em sessões de Claude Code. Skills: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.

O memB já não é um módulo opcional: faz parte da [memória unificada](docs/unified-memory.md) por defeito (memB, deja e OpenWiki, mais o Codebase Memory MCP quando programa), instalada com o perfil standard e com `-y`. Desative com `--without=memory` ou `--profile=minimal`; sem ela, nenhum harness recebe `memb_mcp`, `deja` nem o hook `memb-inject`.

### deja: indexação de transcrições

`@vshulcz/deja-vu`: indexa as suas transcrições de agentes localmente (secrets redigidos), com `deja fix` perante um erro, `deja wip` para retomar, `deja search` para sessões passadas. Instalado com o memB. Skill: `deja-memory`.

### OpenWiki: documentação viva

CLI `openwiki`: gera e refresca um wiki fundamentado de uma codebase, com um visualizador na porta 4321 e um daemon em segundo plano. Skill: `openwiki-skill`. O wiki deste repositório: [.openwiki/](.openwiki/quickstart.md).

**Synapse:** `@hybridlabor-api/bdb-synapse` renderiza um repositório como uma cidade de código 3D e reproduz sessões de agentes como rastos de luz. Skill: `synapse-integration-skill`.

**AO (Agent Orchestrator):** `@hybridlabor-api/bdb-agent-orchestrator` orquestra agentes em paralelo em Git worktrees com controlo de terminal ao vivo e feedback de CI/CD. Skill: `ao-orchestrator`.

**Creator Extension:** `@hybridlabor-api/bdb-dev-creator-extension` fornece MCP ComfyUI (FLUX, SDXL), image-to-3D (TripoSR, TRELLIS) e produção de vídeo automatizada (OpenMontage, Remotion). Skill: `bdb-dev-creator-extension`.

**Hardware e PCB:** `@hybridlabor-api/bdb-hardware-pcb` conduz design em KiCad e OpenSCAD com gate ERC/DRC e design de caixas paramétricas. Skills: `godmode-hardware-pcb`, `bdb-hardware-pcb`.

### Rust + Tauri (`rustauri`)

Vem dentro do kernel em `vendor/rustauri`, sem nada para descarregar. Duas skills: `tauri-pilot`, que conduz e testa uma app Tauri v2 em execução pela CLI ou por MCP (MIT, adaptada de [mpiton/tauri-pilot](https://github.com/mpiton/tauri-pilot)), e `rust-pro`, escrita para este repositório. Ativar com `-y --modules=rustauri` ou `aos package install rustauri`.

### StyleSeed (`styleseed`)

Vem dentro do kernel em `vendor/styleseed`, sem nada para descarregar. Oito skills de UI/UX na linguagem de design StyleSeed Toss (MIT, de [bitjaru/styleseed](https://github.com/bitjaru/styleseed)): `ui-component`, `ui-page`, `ui-pattern`, `ui-review`, `ui-tokens`, `ux-audit`, `ux-feedback`, `ux-flow`. É opt-in porque as skills partem desse design system; as personae dos agentes, os playbooks e a documentação referem-se a elas apenas como "se o pacote StyleSeed estiver instalado". Cópias de instalações anteriores são mantidas, não apagadas. Ativar com `-y --modules=styleseed`.

### Codebase Memory MCP (`codebase-memory`)

O grafo de conhecimento de código opcional. Um binário stdio de terceiros, autónomo ([DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), MIT), que indexa um repositório num grafo SQLite local sob `~/.cache/codebase-memory-mcp/` e responde a perguntas estruturais ("quem chama X", "que rotas expõe o serviço A") com muito menos tokens do que ler ficheiro a ficheiro. Sem chamadas na cloud, sem API keys.

O AOS nunca descarrega o binário. Se o instalar você mesmo (fixado em `0.11.0` quando o AOS o instala por si), a entrada MCP é registada no próximo sync de MCP do harness; o `aos doctor` reporta `app missing: codebase-memory-mcp` enquanto faltar. Pedi-lo é a resposta "sim, eu programo aqui": o instalador pergunta uma vez *"Do you use AOS for coding?"*, guarda a resposta como `codingMode` em `~/.aos/v5-settings.json`, e `--coding` / `--no-coding` definem-na sem pergunta. Ativar com `-y --modules=codebase-memory`; detalhes e a receita de medição em [docs/codebase-memory.md](docs/codebase-memory.md). Skill: `codebase-memory`.

<details>
<summary><b>Como os módulos funcionam (diagrams)</b></summary>

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph S["Synapse"]
    direction LR
    A[("Logs")] -->|parse| B("Adapters")
    B --> C("Events")
    C & D[("Repo")] --> E("Go server")
    E --> F("WebGL")
    end
    style S fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph A["AO"]
    direction LR
    H(["IDE"]) --> O("Orchestrator")
    O --> S1("Build") & S2("Refactor")
    S1 & S2 --> C("Monitor")
    C --> F("Feedback")
    end
    style A fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph C["Creator"]
    direction LR
    A("Agent") -->|MCP| R("Router")
    R --> D("3D") & V("Video")
    D --> T["TRELLIS"]
    V --> O["OpenMontage"]
    end
    style C fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph P["Hardware/PCB"]
    direction LR
    A("Agent") -->|MCP| K("KiCad") & O("OpenSCAD")
    K --> E("ERC") & L("Layout")
    O --> EN("Enclosure")
    E & L & EN --> F[("Output")]
    end
    style P fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

</details>

### Heimdall Token Saver: compressão de output de CLI

`@hybridlabor-api/heimdall-token-saver`: comprime output repetido de CLI através de hooks ambiente em cada harness. Reduz o overhead de tokens em projetos grandes. Skill: `token-saver-config`.

### Otimização de tokens de um relance

| Alavanca | Como |
|---|---|
| Perfil mínimo | `--profile=minimal` salta hooks de injeção de contexto e módulos opcionais. |
| Sem hooks de contexto | `--no-hooks` mantém os gates e deixa de fora a injeção de memB, regras e trail. |
| Heimdall Token Saver | Comprime output repetido de CLI via hooks. |
| Sem modelo fixado | Os agentes herdam o modelo da sessão; overrides por papel vivem em `~/.aos/pipeline.json` ([docs/agent-models.md](docs/agent-models.md)). |
| Token-weather | A fleet band mostra quão cheio está o contexto e quando compactar. |

---

## Atualizar

**Update.** Correr o mesmo comando outra vez. O instalador vê a versão instalada, oferece **Quick Update** e refresca skills, hooks, templates e módulos:

```bash
npx -y @hybridlabor-api/aos@latest
```

**Sem subcomando `aos update`.** Se alguma vez correu `npm i -g @hybridlabor-api/aos`, um `aos` simples no PATH corre essa cópia congelada e a sua versão, não a mais recente; ou a atualiza (`npm i -g @hybridlabor-api/aos@latest`) ou remova-a e fique com `npx`. O instalador imprime o próprio comando de update sempre que existe uma versão mais recente; a skill `bdb-updater` embrulha a mesma verificação para uso dentro de uma sessão.

---

## Desinstalar

```bash
aos-uninstall              # remove o que o AOS instalou; memória, wikis e credenciais ficam
aos-uninstall --purge      # também remove ~/.MemBDB, ~/.openwiki, ~/.synapse, ~/.memb
aos-uninstall --dry-run    # listar tudo, apagar nada
```

**Como funciona.** O desinstalador trabalha a partir do manifest de instalação: um ficheiro que ainda corresponde ao hash que o AOS escreveu é removido, um ficheiro que você editou é guardado em backup, um ficheiro que o AOS nunca escreveu não é tocado. A mesma ação está no menu do instalador. `aos-uninstall --restore-plugin-backup` restaura as cópias soltas de skills que o instalador removeu ao registrar o plugin; ver [docs/plugin-migration.md](docs/plugin-migration.md). A desinstalação move as opções de instalação guardadas para `~/.aos/v5-settings.json.removed-<timestamp>` em vez de as apagar.

---

## FAQ

**Preciso dos nove harnesses?** Não. O instalador só escreve nos harnesses que deteta.

**Sobrescreve a minha configuração MCP?** Não. As entradas existentes são mantidas e o AOS faz merge das suas. `AOS_DISABLED_MCPS` mantém os servidores escolhidos fora.

**Posso instalar com contexto mínimo?** Sim: `--profile=minimal`, ou `--no-hooks`. O gate e os hooks de segurança ficam de qualquer forma.

**O GO gate funciona em todos os harnesses?** É um hook real no Claude Code, Antigravity, Codex e no plugin OpenCode. No Cursor, Windsurf, Roo / Cline e Aider aplica-se apenas a regra no `AGENTS.md`.

**Um agente pode aprovar o seu próprio push?** Não através do gate: apenas o seu GO digitado conta, não uma mensagem de agente, o retransmissor de um subagent ou uma mensagem A2A.

**O AOS funciona sem AO, memB ou OpenWiki?** Sim. Todos são módulos opcionais.

**Algo está avariado.** Correr `aos doctor`. Ele nomeia o que falta e sai com 1.

---

## Contribuir

- [AGENTS.md](AGENTS.md) é a fonte única de regras para todos os harnesses: o contrato de skills, o roteamento por categoria, o gate de release, Conventional Commits.
- Uma skill é um diretório com `SKILL.md`; o frontmatter precisa de `name` (igual ao diretório), `description` e `category`. O `npm run validate` impõe o contrato, como o CI faz em cada push.
- `npm test` corre o self-test do validador, a verificação do manifest de plugin e os testes do instalador, store, doctor e hooks entre harnesses.
- `.claude-plugin/plugin.json` e `marketplace.json` são gerados por `npm run plugin:build` e verificados por `npm run plugin:check`. Existem hoje; o caminho de instalação pelo marketplace do Claude Code ainda está a ser finalizado, por isso o instalador acima continua a ser o caminho suportado.
- Releases são cortados pelo release-please a partir de Conventional Commits; não bump o `package.json` à mão. `feat:` significa um bump minor.
- Skills derivadas de outros projetos registam `source:` no frontmatter e uma entrada em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Encontrou um bug ou quer que se acrescente uma skill? [Abrir um issue](https://github.com/hybridlabor-api/aos/issues).

---

## Links

- Pacote: [npmjs.com/package/@hybridlabor-api/aos](https://www.npmjs.com/package/@hybridlabor-api/aos)
- Fonte e issues: [github.com/hybridlabor-api/aos](https://github.com/hybridlabor-api/aos) · [issues](https://github.com/hybridlabor-api/aos/issues)
- [CHANGELOG.md](CHANGELOG.md) · [docs/skills_table.md](docs/skills_table.md)
- Repositórios irmãos: [bdb-agent-orchestrator](https://github.com/hybridlabor-api/bdb-agent-orchestrator) · [bdb-synapse](https://github.com/hybridlabor-api/bdb-synapse) · [bdb-dev-creator-extension](https://github.com/hybridlabor-api/bdb-dev-creator-extension) · [bdb-hardware-pcb](https://github.com/hybridlabor-api/bdb-hardware-pcb) · [bdb-os-remote](https://github.com/hybridlabor-api/bdb-os-remote)

Licença: [Apache-2.0](LICENSE).
