# warden

The fleet's governing corpus, and the machinery that keeps a repository in step with it.

`warden/` sits outside `src/` because it is not a runtime namespace and is never Worker-reachable.
The import rule runs one way: warden may import up into `src/tooling/`, and nothing in `src/` may
import warden. `buildTimeBoundaryStep` enforces it.

## Layout

| Path | What it holds |
| --- | --- |
| `canon/shared/` | The documents both kinds share, byte-identical |
| `canon/libs/` | The library corpus |
| `canon/apps/` | The application corpus |
| `claude/agents/` | Agent definitions, one tree per kind — the source a sync copies from |
| `claude/commands/` | Slash commands, shared by both kinds |
| `claude/seed/` | `CLAUDE.md`, `AGENTS.md` and `settings.local.json`, written only when absent |
| `share/` | Example editor configuration `warden show` writes to stdout |
| `src/` | Every module — the command, the sync, the checks, the index, the MCP server |

**The canon is never copied into a consumer.** It is read from the installed
`node_modules/@y-core/forge/warden/canon/`. A sync writes `claude/` and nothing else, so a rule can
never be edited in a consumer and silently reverted by the next sync.

## Commands

```bash
warden sync                  # replace .claude/agents and .claude/commands
warden sync --init           # also seed CLAUDE.md, AGENTS.md and settings.local.json if absent
warden sync --check          # report drift and exit 1 if any, writing nothing
  --kind=<libs|apps>         # select the tree, overriding package.json's `warden.kind`
  --root=<path>              # the repository to act on

warden natives               # place the editor architecture's prebuilt native bindings
warden show --zed            # write the Zed user settings to stdout, to merge by hand
```

A sync deletes `.claude/agents/` wholesale. A repository-local agent added since the last sync is
lost — keep one outside that directory.
