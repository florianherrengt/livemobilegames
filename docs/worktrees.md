# Multiple git worktrees

Each git worktree runs its own copy of the application, and every listener
binds a TCP port: the Node server, the Vite dev server, Storybook, Vite
preview, and Playwright. Two worktrees on the same machine must use different
port sets. Worktrees live in `.worktrees/` (gitignored) and each one owns a
gitignored `.env` with its ports, so changing one worktree never affects
another.

## Create a worktree

From the repository root:

```bash
pnpm worktree:create <name>
```

The command:

1. runs `git worktree add -b <name> .worktrees/<name>` from the current `HEAD`;
2. writes `.worktrees/<name>/.env` from `.env.example` with auto-assigned
   ports, a generated `COOKIE_SECRET`, and `PUBLIC_ORIGIN` matching `WEB_PORT`;
3. runs `pnpm install` in the worktree.

The first worktree gets these ports:

| Variable | Port | Listener |
| --- | --- | --- |
| `PORT` | `3100` | HTTP API and Colyseus |
| `WEB_PORT` | `5273` | Vite dev server |
| `STORYBOOK_PORT` | `6106` | Storybook dev server |
| `PREVIEW_PORT` | `4273` | `vite preview` |
| `E2E_PORT` | `3310` | Playwright production server |

Later worktrees scan the `.env` files of existing worktrees and pick the lowest
unused port per service, so no two worktrees overlap while both exist.

## Options

```text
--path <dir>            Worktree directory (default: .worktrees/<name>)
--branch <branch>       Branch to check out (default: <name>)
--from <ref>            Commit or branch to create the worktree from
--port <n>              HTTP/Colyseus server port
--web-port <n>          Vite dev server port
--storybook-port <n>    Storybook dev server port
--preview-port <n>      Vite preview server port
--e2e-port <n>          Playwright E2E server port
--no-install            Skip pnpm install in the new worktree
--help                  Show this help
```

`--branch` also attaches to an existing branch instead of creating a new one
(then `--from` is not allowed). Ports passed on the command line are used as
is; the script still validates that the five values are distinct.

## Start the worktree

```bash
cd .worktrees/demo
pnpm dev
```

- Web app: `http://localhost:<WEB_PORT>`
- HTTP API and Colyseus: `http://localhost:<PORT>`

Vite proxies `/api`, `/matchmake`, and `/colyseus` to the worktree's own Node
server, using the `PORT` value from the same `.env`.

Storybook, preview, and E2E in the worktree:

```bash
pnpm storybook
pnpm --filter @phone-party/web preview
pnpm test:e2e
```

They read `STORYBOOK_PORT`, `PREVIEW_PORT`, and `E2E_PORT` from the worktree
root `.env`. The server, Vite, the Storybook dev launcher, and Playwright all
load that `.env`; a value already exported in the shell wins over it.

## Manage worktrees

List all worktrees:

```bash
git worktree list
```

Remove a worktree after stopping its dev servers:

```bash
git worktree remove .worktrees/demo
git branch -d demo
```

The whole `.worktrees/` directory is gitignored, including each worktree's
`.env` and build artifacts.

## Troubleshooting

- **Port already in use:** Vite (`strictPort`) and Storybook (`--exact-port`)
  fail loudly instead of silently moving to another port. If the port is held
  by an unrelated process or another worktree, pass explicit `--*-port` flags
  or edit the worktree's `.env`.
- **Unrelated process on a default port:** the main checkout uses `3000` and
  `5173` from its own `.env`. If another project occupies those ports, change
  the main `.env` or do the work in a worktree.
- **Hand-made worktrees:** port allocation only sees worktrees that have a
  `.env`. A worktree created with plain `git worktree add` and no `.env` is
  invisible to the allocator; give it an explicit port set.
