#!/usr/bin/env bash
# install-lib.sh — Shared install functions for shetty4l services.
#
# Source this file from a per-service install.sh, then call the functions.
# Required variables before sourcing:
#   SERVICE_NAME  — e.g. "engram"
#   REPO          — e.g. "shetty4l/engram"
#   INSTALL_BASE  — e.g. "$HOME/srv/engram"
#
# Optional variables:
#   BIN_DIR       — CLI symlink directory (default: $HOME/.local/bin)
#   MAX_VERSIONS  — versions to keep (default: 5)
#
# After sourcing, these variables are set by fetch_latest_release:
#   RELEASE_TAG   — e.g. "v0.2.3"
#   TARBALL_URL   — download URL for the release tarball

set -euo pipefail

BIN_DIR="${BIN_DIR:-${HOME}/.local/bin}"
MAX_VERSIONS="${MAX_VERSIONS:-5}"

# --- color helpers ---

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; }
die()   { err "$@"; exit 1; }

# --- prereqs ---

check_prereqs() {
  local missing=()
  for cmd in bun curl tar jq; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required tools: ${missing[*]}"
  fi
}

# --- fetch latest release ---

fetch_latest_release() {
  info "Fetching latest release from GitHub..."

  local auth_header=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth_header=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
    info "Using authenticated GitHub API request"
  fi

  local release_json
  release_json=$(curl -fsSL ${auth_header[@]+"${auth_header[@]}"} "https://api.github.com/repos/${REPO}/releases/latest")

  RELEASE_TAG=$(echo "$release_json" | jq -r '.tag_name')
  TARBALL_URL=$(echo "$release_json" | jq -r ".assets[] | select(.name | startswith(\"${SERVICE_NAME}-\")) | .browser_download_url")

  if [ -z "$RELEASE_TAG" ] || [ "$RELEASE_TAG" = "null" ]; then
    die "No releases found for ${REPO}"
  fi
  if [ -z "$TARBALL_URL" ] || [ "$TARBALL_URL" = "null" ]; then
    die "No tarball asset found in release ${RELEASE_TAG}"
  fi

  info "Latest release: ${RELEASE_TAG}"
}

# --- download and extract ---

download_and_extract() {
  local version_dir="${INSTALL_BASE}/${RELEASE_TAG}"

  if [ -d "$version_dir" ]; then
    warn "Version ${RELEASE_TAG} already exists at ${version_dir}, reinstalling..."
    rm -rf "$version_dir"
  fi

  mkdir -p "$version_dir"

  local auth_header=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth_header=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  info "Downloading ${RELEASE_TAG}..."
  local tmpfile
  tmpfile=$(mktemp)
  curl -fsSL ${auth_header[@]+"${auth_header[@]}"} -o "$tmpfile" "$TARBALL_URL"

  info "Extracting to ${version_dir}..."
  tar xzf "$tmpfile" -C "$version_dir"
  rm -f "$tmpfile"

  info "Installing dependencies..."
  (cd "$version_dir" && bun install --frozen-lockfile)

  info "Creating CLI wrapper..."
  cat > "$version_dir/${SERVICE_NAME}" <<WRAPPER
#!/usr/bin/env bash
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink "\$0" || echo "\$0")")" && pwd)"
exec bun run "\$SCRIPT_DIR/src/cli.ts" "\$@"
WRAPPER
  chmod +x "$version_dir/${SERVICE_NAME}"

  ok "Installed ${RELEASE_TAG} to ${version_dir}"
}

# --- symlink management (atomic) ---

update_symlink() {
  local version_dir="${INSTALL_BASE}/${RELEASE_TAG}"
  local latest_link="${INSTALL_BASE}/latest"

  ln -sfn "$version_dir" "$latest_link"
  echo "$RELEASE_TAG" > "${INSTALL_BASE}/current-version"

  ok "Symlinked latest -> ${RELEASE_TAG}"
}

# --- prune old versions ---

prune_versions() {
  local versions=()
  for d in "${INSTALL_BASE}"/v*; do
    [ -d "$d" ] && versions+=("$(basename "$d")")
  done

  if [ ${#versions[@]} -eq 0 ]; then
    return
  fi

  IFS=$'\n' sorted=($(printf '%s\n' "${versions[@]}" | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | sed 's/^/v/'))
  unset IFS

  local count=${#sorted[@]}
  if [ "$count" -gt "$MAX_VERSIONS" ]; then
    local remove_count=$((count - MAX_VERSIONS))
    for ((i = 0; i < remove_count; i++)); do
      local old_version="${sorted[$i]}"
      info "Removing old version: ${old_version}"
      rm -rf "${INSTALL_BASE}/${old_version}"
    done
  fi
}

# --- CLI binary ---

install_cli() {
  mkdir -p "$BIN_DIR"
  ln -sf "${INSTALL_BASE}/latest/${SERVICE_NAME}" "${BIN_DIR}/${SERVICE_NAME}"
  ok "CLI linked: ${BIN_DIR}/${SERVICE_NAME}"

  if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
    warn "~/.local/bin is not in your PATH. Add it to your shell profile:"
    warn "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
}
