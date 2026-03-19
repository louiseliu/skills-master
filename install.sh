#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="chrlsio"
REPO_NAME="agent-skills"
REPO="${REPO_OWNER}/${REPO_NAME}"
RELEASE_TAG="v0.1.0"

if [[ $# -gt 0 ]]; then
  echo "This installer does not accept arguments."
  echo "Use the versioned URL to install a specific version."
  exit 1
fi

log() {
  echo "[AgentSkills installer] $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd mktemp
require_cmd uname

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Darwin) OS="macos" ;;
  Linux) OS="linux" ;;
  *)
    echo "Unsupported OS: $OS_RAW"
    exit 1
    ;;
esac

case "$ARCH_RAW" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

RELEASE_API="https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}"

curl_args=(
  -fsSL
  -H "Accept: application/vnd.github+json"
  -H "User-Agent: agentskills-installer"
)
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

log "Fetching release metadata from ${RELEASE_API}"
release_json="$(curl "${curl_args[@]}" "${RELEASE_API}")" || {
  echo "Failed to fetch release metadata. Check repository/tag availability." >&2
  exit 1
}

extract_download_urls() {
  sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\)".*/\1/p'
}

asset_urls="$(printf '%s' "$release_json" | extract_download_urls)"

if [[ -z "${asset_urls}" ]]; then
  echo "No downloadable assets found in this release."
  exit 1
fi

filter_arch_urls() {
  local input="$1"
  local arch="$2"
  if [[ "$arch" == "arm64" ]]; then
    printf '%s\n' "$input" | grep -E -i 'arm64|aarch64' || true
  else
    printf '%s\n' "$input" | grep -E -i 'x64|x86_64|amd64|intel' || true
  fi
}

pick_first_line() {
  sed -n '1p'
}

pick_asset() {
  local os="$1"
  local arch="$2"
  local urls="$3"
  local candidates=""
  local by_arch=""

  case "$os" in
    macos)
      candidates="$(printf '%s\n' "$urls" | grep -E -i '\.dmg($|\?)' || true)"
      ;;
    linux)
      if command -v dpkg >/dev/null 2>&1; then
        candidates="$(printf '%s\n' "$urls" | grep -E -i '\.deb($|\?)' || true)"
      elif command -v rpm >/dev/null 2>&1; then
        candidates="$(printf '%s\n' "$urls" | grep -E -i '\.rpm($|\?)' || true)"
      else
        candidates="$(printf '%s\n' "$urls" | grep -E -i '\.AppImage($|\?)' || true)"
      fi

      # Fallback chain if preferred format is missing.
      if [[ -z "$candidates" ]]; then
        candidates="$(printf '%s\n' "$urls" | grep -E -i '\.deb($|\?)' || true)"
      fi
      if [[ -z "$candidates" ]]; then
        candidates="$(printf '%s\n' "$urls" | grep -E -i '\.rpm($|\?)' || true)"
      fi
      if [[ -z "$candidates" ]]; then
        candidates="$(printf '%s\n' "$urls" | grep -E -i '\.AppImage($|\?)' || true)"
      fi
      ;;
    *)
      echo "Unsupported OS for asset selection: $os" >&2
      return 1
      ;;
  esac

  [[ -z "$candidates" ]] && return 1

  by_arch="$(filter_arch_urls "$candidates" "$arch")"
  if [[ -n "$by_arch" ]]; then
    printf '%s\n' "$by_arch" | pick_first_line
    return 0
  fi

  # Selecting a mismatched architecture package on macOS/Linux is usually incorrect.
  if [[ "$arch" == "arm64" ]]; then
    if [[ "$os" == "linux" ]]; then
      echo "No Linux ARM64 artifact found in this release." >&2
      return 1
    fi
    if [[ "$os" == "macos" ]]; then
      echo "No macOS ARM64 artifact found in this release." >&2
      return 1
    fi
  fi

  printf '%s\n' "$candidates" | pick_first_line
}

asset_url="$(pick_asset "$OS" "$ARCH" "$asset_urls")" || {
  echo "Failed to select an installable asset for ${OS}/${ARCH}."
  exit 1
}

filename="$(basename "$asset_url")"
tmp_dir="$(mktemp -d)"
artifact_path="${tmp_dir}/${filename}"

log "Detected platform: ${OS}/${ARCH}"
log "Selected asset: ${asset_url}"

log "Downloading asset to ${artifact_path}"
curl -fL "$asset_url" -o "$artifact_path"

install_macos_dmg() {
  local dmg_path="$1"
  local mount_point
  mount_point="$(hdiutil attach "$dmg_path" -nobrowse | awk 'END {print $NF}')"

  if [[ -z "$mount_point" || ! -d "$mount_point" ]]; then
    echo "Failed to mount dmg."
    exit 1
  fi

  local app_path=""
  for maybe_app in "$mount_point"/*.app; do
    if [[ -d "$maybe_app" ]]; then
      app_path="$maybe_app"
      break
    fi
  done

  if [[ -z "$app_path" ]]; then
    hdiutil detach "$mount_point" >/dev/null 2>&1 || true
    echo "No .app found inside dmg."
    exit 1
  fi

  log "Installing $(basename "$app_path") to /Applications"
  cp -R "$app_path" /Applications/
  hdiutil detach "$mount_point" >/dev/null 2>&1 || true
}

install_linux_file() {
  local file_path="$1"
  case "$file_path" in
    *.deb)
      log "Installing .deb package (sudo may be required)"
      sudo dpkg -i "$file_path" || sudo apt-get install -f -y
      ;;
    *.rpm)
      log "Installing .rpm package (sudo may be required)"
      sudo rpm -i "$file_path"
      ;;
    *.AppImage)
      mkdir -p "${HOME}/.local/bin"
      local target="${HOME}/.local/bin/agentskills.AppImage"
      log "Installing AppImage to ${target}"
      cp "$file_path" "$target"
      chmod +x "$target"
      log "Run with: ${target}"
      ;;
    *)
      echo "Unsupported Linux artifact format: $file_path"
      exit 1
      ;;
  esac
}

case "$OS" in
  macos)
    install_macos_dmg "$artifact_path"
    ;;
  linux)
    install_linux_file "$artifact_path"
    ;;
esac

log "Installation complete."
