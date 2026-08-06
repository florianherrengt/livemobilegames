#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

application_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}")"
environment_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}/envs")"

configuration_ok=true

if ! jq -e '
  .build_pack == "dockerfile" and
  .base_directory == "/" and
  .dockerfile_location == "/Dockerfile" and
  .ports_exposes == "3000" and
  .ports_mappings == "4478:3000" and
  .health_check_enabled == true and
  .health_check_path == "/api/health" and
  .health_check_port == "3000" and
  .health_check_host == "127.0.0.1" and
  .health_check_method == "GET" and
  .health_check_scheme == "http" and
  .health_check_return_code == 200
' >/dev/null <<<"${application_json}"; then
  configuration_ok=false
  echo "Coolify application configuration is incorrect:" >&2
  jq '{
    build_pack,
    base_directory,
    dockerfile_location,
    ports_exposes,
    ports_mappings,
    health_check_enabled,
    health_check_path,
    health_check_port,
    health_check_host,
    health_check_method,
    health_check_scheme,
    health_check_return_code
  }' <<<"${application_json}" >&2
fi

encoded_labels="$(jq -r '.custom_labels // ""' <<<"${application_json}")"
if [[ -z "${encoded_labels}" ]]; then
  configuration_ok=false
  echo "Coolify proxy labels are missing." >&2
else
  proxy_labels="$(printf '%s' "${encoded_labels}" | base64 --decode)"
  if ! grep -Eq 'traefik\.http\.services\..*\.loadbalancer\.server\.port=3000$' <<<"${proxy_labels}" ||
    ! grep -Eq 'caddy_.*reverse_proxy=\{\{upstreams 3000\}\}$' <<<"${proxy_labels}" ||
    grep -E 'loadbalancer\.server\.port=|reverse_proxy=\{\{upstreams ' <<<"${proxy_labels}" | grep -Ev 'server\.port=3000$|upstreams 3000\}\}$' >/dev/null; then
    configuration_ok=false
    echo "Coolify proxy labels do not exclusively target port 3000." >&2
  fi
fi

if ! jq -e '
  [.[] | select(.key == "COOKIE_SECRET")] as $entries |
  ($entries | length) > 0 and
  any($entries[]; .is_preview == false) and
  all($entries[]; .is_buildtime == false and .is_runtime == true)
' >/dev/null <<<"${environment_json}"; then
  configuration_ok=false
  echo "COOKIE_SECRET is missing or is not runtime-only." >&2
fi

if [[ "${configuration_ok}" != true ]]; then
  exit 1
fi

echo "Coolify production configuration is valid."
