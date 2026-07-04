# md4lp

**Markdown for legacy people.** A **free, open-source, web-first WYSIWYG editor for Markdown,
backed by git**. Non-technical authors create, edit, comment, and resolve comments on documents
visually, while AI agents read and write the very same `.md` files. The Markdown file in git stays
the **byte-exact source of truth**, so version history stays clean and humans and AI collaborate on
one canonical document.

## Status — local MVP, live collaborative editing

The local MVP is running end to end, including **real-time collaborative editing**: one editor at
a time (server-held lock + heartbeat), auto-save to an ephemeral edit branch, consolidation to
`main` on release, and live propagation of edits and comments to every viewer over SSE — no manual
save, no reload. `pnpm dev` starts a standalone HTTP + MCP server and the WYSIWYG web app; 98 unit
tests + 16 Playwright e2e tests pass.

## The idea

- **WYSIWYG without betraying the file.** The editor renders Markdown richly but never leaves the
  text buffer, so saving produces the exact Markdown you meant: no diff noise, no corrupted
  frontmatter, no mangled tables.
- **Live, like a shared doc.** One person edits at a time; everyone else sees the changes stream in
  as they happen. Idle out, and the next editor picks up where you left off.
- **Comments that survive edits.** Comments anchor to the text (not to line numbers) and re-anchor
  as the document changes, with a clear "intact / moved / orphaned" triage.
- **Branch-based collaboration, hidden from the author.** A consolidated `main` is the one source
  of truth and the comment coordinate system; edits and per-user comment threads live on ephemeral
  or sidecar branches the author never has to think about.
- **AI agents as first-class collaborators.** An agent is just another editor, working the same
  files locally or over an MCP endpoint, respecting the same one-editor-at-a-time lock.

## Architecture (high level)

```
Web UI (Milkdown/Crepe WYSIWYG + SSE live updates)
        │ HTTP proxy
Server (@md4lp/server — Hono · REST /api/* · MCP /mcp · SSE /api/events)
        │ single process, in-process mutex + edit lock (D18)
Repo backend (@md4lp/repo — isomorphic-git, plumbing-only writes)
```

TypeScript end to end. The canonicalizer (remark) is shared between client and server so the editor
and AI agents converge on the same canonical Markdown.

## Getting started

```sh
pnpm install
pnpm dev          # starts server (port 8787) + web app (port 5173)
```

Open [http://localhost:5173](http://localhost:5173). Identity is a `?user=` query parameter (e.g.
`?user=alice`); the built-in defaults are `alice` and `agent-claude` (editors) and `bob`
(commenter).

## Configuration

Create `md4lp.config.json` in the working directory to configure users, roles, the repo path, and
the port. A sample file is included at the repo root. If the file is absent, built-in defaults are
used (alice/bob/agent-claude).

```json
{
  "repoDir": "./packages/web/.sample-repo",
  "port": 8787,
  "users": {
    "alice":        { "role": "editor",    "email": "alice@example.com" },
    "bob":          { "role": "commenter", "email": "bob@example.com" },
    "agent-claude": { "role": "editor",    "email": "agent@md4lp.local" }
  }
}
```

Environment overrides (highest priority): `MD4LP_REPO`, `MD4LP_PORT`, `MD4LP_CONFIG` (path to config file).

## AI agents (MCP)

The server exposes an MCP endpoint at `http://localhost:8787/mcp` (StreamableHTTP).
Tools: `list_files`, `read_file`, `write_file`, `list_comments`, `add_comment`, `resolve_comment`.

Configure your agent client (e.g. OpenCode, Claude Desktop) to point at that URL. The agent user
(`agent-claude` by default) must be declared in `md4lp.config.json` with `"role": "editor"`.
`write_file` is a self-contained edit turn (acquire the lock → write → release), so the agent
respects the same one-editor-at-a-time rule as a human and fails if someone else is mid-edit.

> **Single process constraint (D18):** REST and MCP must run in the same process so the in-process
> mutex in `@md4lp/repo` and `@md4lp/comments` remains the single serialization point. Do not run
> multiple server instances against the same repo directory.

## Acknowledgements

Built on the open-source community's work, notably [CodeMirror 6](https://codemirror.net/),
Atomic Editor, the [remark/unified](https://unifiedjs.com/) ecosystem,
[isomorphic-git](https://isomorphic-git.org/), and diff-match-patch.

## License

Apache-2.0.
