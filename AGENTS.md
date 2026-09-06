# md4lp — Agent Guide

> Agent-facing operating guide for this repository. Read first.

## What this project is

**md4lp** ("Markdown for legacy people") is a **free, open-source, web-first WYSIWYG Markdown
service backed by git**. It lets non-technical authors create, edit, comment, and resolve comments
on documents visually, while AI agents read and write the very same `.md` files as text. The `.md`
in git is the **byte-exact source of truth**: the visual editor never reserializes it lossily, so
diffs stay clean and human-authored and AI-authored content share one canonical file.

## Current phase

**Local MVP running, including live collaborative editing.**
`pnpm dev` starts the standalone Hono server (`@md4lp/server`, HTTP + MCP at port 8787) and the
Vite-based WYSIWYG web app (port 5173). 98 vitest + 16 Playwright e2e tests green.

Live editing: one editor at a time (server-held lock, idle timeout, lazy expiry), auto-save to an
ephemeral per-file edit branch, consolidation to `main` on release, and edits/comments propagated
to every viewer over SSE (`/api/events`) — no manual save, no reload.

Application code is written against an **approved spec** (see Workflow below).

## Documentation home

This project is developed using a personal **second brain** for operational development control following the [agent-brain](https://github.com/juanyque/agent-brain) operating model.
- **Publishable docs live in this repository**: `README.md` (overview) and, as the project approaches publication, a user guide, architecture, and CONTRIBUTING.
- **Internal/dev design docs** — the feasibility analysis, decision log, roadmap, phase specs, and backlog — are kept **in the second brain (`WIP/md4lp/`)** and are intentionally **not** in this repository nor in local CLI scratch/artifact paths.
- **Agent resolution**: Agents with the `brain` skill (e.g., via `/brain` or `$brain`) should resolve the brain home dynamically using `find_home.py` / `session_open.py` as defined in the agent-brain model, and document progress directly under `WIP/md4lp/` and the session lifecycle notes.

## How to work in this repo

**Method: Spec-Driven Development (SDD) + autonomous mode.**

- **Spec-first.** Every phase/feature starts as a written spec (requirements → design → task
  breakdown), maintained privately. The spec is the source of truth and the review gate; update it
  if reality diverges.
- **Autonomous mode.** Once the maintainer approves a spec, advance autonomously through its tasks
  (write code + tests, run them, iterate) **without per-step approval.** Report progress; stop only
  at a **hard intervention point**:
  1. Spec/architecture approval before implementing a new phase.
  2. Git — the maintainer commits/pushes; **never commit or push autonomously.**
  3. Outward/irreversible — publishing the repo, choosing the final name, publishing releases.
  4. External infra/credentials — cloud accounts, tokens, secrets.
  5. A new unmade decision.
  Within those bounds: **progress over permission.**
- **Reuse over reinvent**, with license compatibility (permissive/Apache-2.0; avoid GPL/AGPL deps).
- **Use sub-agents** for broad research/exploration to keep the main context clean.

## Configuration (`md4lp.config.json`)

The server reads `md4lp.config.json` from the working directory at startup. If absent, built-in
defaults are used (alice/bob/agent-claude). Schema:

```json
{
  "repoDir": "<path to git repo>",
  "port": 8787,
  "users": {
    "<username>": { "role": "editor | commenter", "email": "<optional>" }
  }
}
```

**Env overrides** (highest priority): `MD4LP_REPO`, `MD4LP_PORT`, `MD4LP_CONFIG` (path to a
non-default config file location).

**User roles:**
- `editor` — can read, write `.md` files, apply/reject suggestions, merge to `main`.
- `commenter` — read-only; can post comments and suggestions, cannot write or merge.

Unknown users (not declared in `users`) default to `editor` (dev convenience; tighten in production).

**Single-process constraint (D18):** REST (`/api/*`) and MCP (`/mcp`) run in the same process and
share one `createApi` instance. The in-process mutex in `@md4lp/repo` / `@md4lp/comments` is the
only serialization point. Never run two server processes against the same repo directory.

## Stack

TypeScript end to end (a monorepo of focused packages). The editor builds on **CodeMirror 6** +
`@codemirror/lang-markdown` with **Atomic Editor** for rich live decoration; the shared
**canonicalizer** uses the **remark/unified** ecosystem (opt-in, format-on-save, never in the edit
path); git access uses **isomorphic-git**; comment re-anchoring uses **diff-match-patch**. All
permissively licensed.

## Quality gates

Once Stage 0 is scaffolded: `pnpm test` (unit + the byte-exact round-trip suite), `pnpm lint`,
`pnpm typecheck`. The byte-exact round-trip suite (frontmatter, GFM tables, task lists, HTML
comments) is a permanent project asset and the core safety net.

## Language

All shared content is in **English**: source code, comments, docs, commit messages, PR descriptions.

## Git workflow

Personal project. Work on the default branch unless a reason to branch arises. **The maintainer
handles all commits and pushes** — do not commit or push autonomously.

## Acknowledgements

Built on the work of the open-source community, notably **CodeMirror 6**, **Atomic Editor**, the
**remark/unified** ecosystem, **isomorphic-git**, and **diff-match-patch**. See `README.md`.

## Future work (noted)

Beyond the local MVP, designed-for but deferred: bring-your-own remote repos (GitHub/GitLab),
fine-grained per-file/branch permissions (a `pre-receive` hook on protected refs for the hosted
phase), a unified multi-user change/comment view, multi-process concurrency (today's in-process
mutex assumes a single server instance), and a hosted-service deployment. The architecture keeps
these seams (repo backend, canonicalizer, comment store) open from day 1.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
