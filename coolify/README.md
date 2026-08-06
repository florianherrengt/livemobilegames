# Coolify operations

Local helper scripts for the `livemobilegames` application hosted by the Coolify
instance at [http://helium:8000](http://helium:8000).

For the system boundary behind these commands, see
[Architecture](../docs/architecture.md) and
[Server runtime](../apps/server/docs/runtime.md). This file is the operational
source of truth for the live Coolify resource.

## Configured resource

| Resource | UUID |
| --- | --- |
| Project | `n58he3uipirx1x79w83tsszh` |
| Environment | `qm0fsdq20yoizqe5utsan2yl` |
| Application | `l1dggfkxw6q2bs2m79pqkzt2` |

The non-secret URL and UUIDs live in `config.sh`. The API base is
`http://helium:8000/api/v1`.

## Token

`coolify_token` contains the bearer token. Git ignores that filename everywhere
in the repository. Keep it on one line and restrict it to the current user:

```sh
chmod 600 coolify/coolify_token
```

Do not print, commit, paste, or pass the token as a command-line argument. The
scripts load it directly from the file. Replace the file when rotating the token.

The token needs `read` permission for status and deployment metadata,
`read:sensitive` for logs, and `deploy` for deploy/restart/stop operations.

## Requirements

- Network/DNS access to `helium`
- `bash`
- `curl`
- `jq`
- Node.js 22 or newer (used to generate `COOKIE_SECRET`)

Run every command from the repository root.

## Read-only commands

```sh
# Application status and deployed revision
./coolify/status.sh

# Validate port, health-check, and secret configuration
./coolify/check-config.sh

# Last 100 application log lines, or a custom count
./coolify/logs.sh
./coolify/logs.sh 250

# Ten most recent deployments, or a custom count
./coolify/deployments.sh
./coolify/deployments.sh 25

# One deployment, including its deployment log
./coolify/deployment.sh DEPLOYMENT_UUID

# Verify Coolify state, the tunnel origin, and the public health endpoint
./coolify/verify-live.sh
```

Application and deployment logs can contain secrets or user data. Inspect them
locally and do not paste them into tickets or chat without review.

## State-changing commands

These commands act immediately. They do not prompt for confirmation.

```sh
# Apply the required production port, health check, and signing secret
./coolify/configure-production.sh

# Queue a normal deployment
./coolify/deploy.sh

# Rebuild without cache
./coolify/deploy.sh --force

# Skip Coolify's deployment queue (use only when intentional)
./coolify/deploy.sh --instant

# Restart or stop the current application
./coolify/restart.sh
./coolify/stop.sh
```

`deploy.sh` prints the deployment UUID returned by Coolify. Pass it to
`wait-deployment.sh` to wait for completion or `deployment.sh` to inspect full
metadata and logs.

## Correct deployment procedure

Coolify builds the committed `main` branch from GitHub. Local uncommitted changes
are not deployed. Push the intended commit before starting this procedure.

```sh
# 1. Confirm production configuration. Configure it if this fails.
./coolify/check-config.sh || ./coolify/configure-production.sh

# 2. Queue a clean build. Copy deployment_uuid from this response.
./coolify/deploy.sh --force

# 3. Wait for that exact deployment; do not queue duplicate deployments.
./coolify/wait-deployment.sh DEPLOYMENT_UUID

# 4. Verify Coolify and the public endpoint.
./coolify/status.sh
./coolify/verify-live.sh
```

The required application settings are:

| Setting | Value |
| --- | --- |
| Build pack | Dockerfile |
| Base directory | `/` |
| Dockerfile | `/Dockerfile` |
| Exposed container port | `3000` |
| Host port mapping | `4478:3000` |
| Health check | enabled |
| Health-check method | `GET` |
| Health-check path | `/api/health` |
| Health-check host | `127.0.0.1` |
| Health-check port | `3000` |
| Health-check expected status | `200` |
| Traefik/Caddy upstream labels | `3000` |

`COOKIE_SECRET` is required, must contain at least 32 characters, and must be a
runtime-only variable: `is_runtime=true`, `is_buildtime=false`. Do not rotate it
on an ordinary deployment because rotation invalidates signed browser sessions.
`configure-production.sh` preserves an existing correctly configured secret and
rotates only a missing or incorrectly scoped one.

Reject a build if its logs contain `SecretsUsedInArgOrEnv` for `COOKIE_SECRET`.
Correct the environment flags, rotate the exposed value, and force a replacement
build. Never print raw environment objects: Coolify may return secrets in both
`value` and `real_value` fields.

## 2026-08-06 crash-loop incident

The application failed publicly for four independent configuration reasons:

1. Coolify had no environment entries. The image excludes `.env`, while server
   startup requires `COOKIE_SECRET`, so the process exited immediately with
   `Invalid server configuration`.
2. Coolify exposed `2567` with host mapping `4478:2567`, but this image listens
   on `3000`. Its health check was also disabled and pointed at `/` instead of
   `/api/health`.
3. Updating `ports_exposes` through this Coolify API version did not regenerate
   the existing Traefik/Caddy labels. The container became `running:healthy`,
   but the public domain still returned `502` because the proxy targeted `2567`.
   `configure-production.sh` now calls `sync-proxy-labels.sh` explicitly.
4. Cloudflare reaches this application through helium host port `4478`. Removing
   the obsolete `4478:2567` mapping made Coolify's direct HTTPS proxy healthy but
   left the public Cloudflare route returning `502`. The required tunnel mapping
   is `4478:3000`.

The log API returns `400 Application is not running` when the container has
already stopped. In that case, inspect the configuration with
`check-config.sh`, inspect the most recent build with `deployment.sh`, and use
the local production health reproduction described below.

```sh
pnpm build
NODE_ENV=production \
PORT=3000 \
HOST=127.0.0.1 \
COOKIE_SECRET=local-test-only-cookie-secret-000000000 \
node apps/server/dist/index.js

# In another shell:
curl --fail http://127.0.0.1:3000/api/health
```

## Generic API requests

`api.sh` supports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. It accepts only a
path beginning with one `/` and always targets the configured API base. Use `-`
as the JSON argument to read the request body from standard input; this keeps
secrets out of process arguments.

```sh
./coolify/api.sh GET "/applications"
./coolify/api.sh GET "/projects/n58he3uipirx1x79w83tsszh"
./coolify/api.sh PATCH \
  "/applications/l1dggfkxw6q2bs2m79pqkzt2" \
  '{"name":"livemobilegames"}'

printf '%s\n' '{"name":"livemobilegames"}' | \
  ./coolify/api.sh PATCH "/applications/l1dggfkxw6q2bs2m79pqkzt2" -
```

The generic helper prints the complete API response. Some endpoints return
sensitive configuration, so check the endpoint before using or sharing output.

## Troubleshooting

- `401`: the token is invalid or expired.
- `403`: the token lacks the required permission.
- `404`: the UUID is wrong or the token belongs to a different Coolify team.
- Connection errors: confirm that `http://helium:8000` is reachable and the API
  is enabled in Coolify under **Settings > Advanced > API Settings**.

API behavior follows the [Coolify API reference](https://coolify.io/docs/api-reference/authorization).
