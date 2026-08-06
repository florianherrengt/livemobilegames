#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

environment_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}/envs")"

if jq -e '
  [.[] | select(.key == "COOKIE_SECRET")] as $entries |
  ($entries | length) > 0 and
  any($entries[]; .is_preview == false) and
  all($entries[]; .is_buildtime == false and .is_runtime == true)
' >/dev/null <<<"${environment_json}"; then
  echo "Preserving the existing COOKIE_SECRET."
else
  cookie_secret="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"));')"

  if ! jq -e 'map(.key) | index("COOKIE_SECRET") != null' >/dev/null <<<"${environment_json}"; then
    jq -n \
      --arg value "${cookie_secret}" \
      '{
        key: "COOKIE_SECRET",
        value: $value,
        is_preview: false,
        is_literal: true,
        is_multiline: false,
        is_shown_once: false,
        is_buildtime: false,
        is_runtime: true
      }' | "${SCRIPT_DIR}/api.sh" POST "/applications/${COOLIFY_APPLICATION_UUID}/envs" - >/dev/null
  fi

  for preview_value in false true; do
    jq -n \
      --arg value "${cookie_secret}" \
      --argjson is_preview "${preview_value}" \
      '{
        key: "COOKIE_SECRET",
        value: $value,
        is_preview: $is_preview,
        is_literal: true,
        is_multiline: false,
        is_shown_once: false,
        is_buildtime: false,
        is_runtime: true
      }' | "${SCRIPT_DIR}/api.sh" PATCH "/applications/${COOLIFY_APPLICATION_UUID}/envs" - >/dev/null
  done

  unset cookie_secret
  echo "Created or rotated COOKIE_SECRET as a cryptographically random, runtime-only value."
fi

jq -n '{
  ports_exposes: "3000",
  ports_mappings: "4478:3000",
  health_check_enabled: true,
  health_check_path: "/api/health",
  health_check_port: "3000",
  health_check_host: "127.0.0.1",
  health_check_method: "GET",
  health_check_scheme: "http",
  health_check_return_code: 200
}' | "${SCRIPT_DIR}/api.sh" PATCH "/applications/${COOLIFY_APPLICATION_UUID}" - >/dev/null

echo "Configured container port 3000, Cloudflare tunnel mapping 4478:3000, and the /api/health health check."
"${SCRIPT_DIR}/sync-proxy-labels.sh"
"${SCRIPT_DIR}/check-config.sh"
