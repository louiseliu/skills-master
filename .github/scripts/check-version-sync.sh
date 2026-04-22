#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

die() {
  echo "[version-sync] ERROR: $*" >&2
  exit 1
}

extract_first() {
  local pattern="$1"
  local file="$2"
  local value
  value="$(python3 - "$pattern" "$file" <<'PY'
import pathlib
import re
import sys

pattern = sys.argv[1]
file_path = pathlib.Path(sys.argv[2])
text = file_path.read_text(encoding="utf-8")
match = re.search(pattern, text, flags=re.MULTILINE)
if not match:
    sys.exit(1)
print(match.group(1))
PY
)" || true
  [[ -n "$value" ]] || die "Failed to extract value from $file with pattern: $pattern"
  printf '%s' "$value"
}

APP_VERSION="$(extract_first '.*"version"\s*:\s*"([^"]+)".*' "src-tauri/tauri.conf.json")"
CARGO_VERSION="$(extract_first '^\s*version\s*=\s*"([^"]+)".*' "src-tauri/Cargo.toml")"
PACKAGE_VERSION="$(extract_first '.*"version"\s*:\s*"([^"]+)".*' "package.json")"
CASK_VERSION="$(extract_first '^\s*version\s*"([^"]+)".*' "Casks/skillsmaster.rb")"

[[ "$APP_VERSION" == "$CARGO_VERSION" ]] || die "Version mismatch: tauri.conf.json=$APP_VERSION, Cargo.toml=$CARGO_VERSION"
[[ "$APP_VERSION" == "$PACKAGE_VERSION" ]] || die "Version mismatch: tauri.conf.json=$APP_VERSION, package.json=$PACKAGE_VERSION"
[[ "$APP_VERSION" == "$CASK_VERSION" ]] || die "Version mismatch: tauri.conf.json=$APP_VERSION, Casks/skillsmaster.rb=$CASK_VERSION"

APP_TAG="v${APP_VERSION}"

README_EN_SH_TAG="$(extract_first '.*raw\.githubusercontent\.com/louiseliu/skills-master/(v[0-9]+\.[0-9]+\.[0-9]+)/install\.sh.*' "README.md")"
README_EN_PS_TAG="$(extract_first '.*raw\.githubusercontent\.com/louiseliu/skills-master/(v[0-9]+\.[0-9]+\.[0-9]+)/install\.ps1.*' "README.md")"
README_ZH_SH_TAG="$(extract_first '.*raw\.githubusercontent\.com/louiseliu/skills-master/(v[0-9]+\.[0-9]+\.[0-9]+)/install\.sh.*' "README.zh-CN.md")"
README_ZH_PS_TAG="$(extract_first '.*raw\.githubusercontent\.com/louiseliu/skills-master/(v[0-9]+\.[0-9]+\.[0-9]+)/install\.ps1.*' "README.zh-CN.md")"

[[ "$README_EN_SH_TAG" == "$APP_TAG" ]] || die "README.md install.sh tag mismatch: expected $APP_TAG, got $README_EN_SH_TAG"
[[ "$README_EN_PS_TAG" == "$APP_TAG" ]] || die "README.md install.ps1 tag mismatch: expected $APP_TAG, got $README_EN_PS_TAG"
[[ "$README_ZH_SH_TAG" == "$APP_TAG" ]] || die "README.zh-CN.md install.sh tag mismatch: expected $APP_TAG, got $README_ZH_SH_TAG"
[[ "$README_ZH_PS_TAG" == "$APP_TAG" ]] || die "README.zh-CN.md install.ps1 tag mismatch: expected $APP_TAG, got $README_ZH_PS_TAG"

INSTALL_SH_EXAMPLE_VERSION="$(extract_first '.*VERSION=([0-9]+\.[0-9]+\.[0-9]+)\s+bash.*' "install.sh")"
INSTALL_PS1_EXAMPLE_VERSION="$(extract_first '.*\$Version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)".*' "install.ps1")"

[[ "$INSTALL_SH_EXAMPLE_VERSION" == "$APP_VERSION" ]] || die "install.sh example version mismatch: expected $APP_VERSION, got $INSTALL_SH_EXAMPLE_VERSION"
[[ "$INSTALL_PS1_EXAMPLE_VERSION" == "$APP_VERSION" ]] || die "install.ps1 example version mismatch: expected $APP_VERSION, got $INSTALL_PS1_EXAMPLE_VERSION"

echo "[version-sync] OK: all version references are consistent at $APP_VERSION ($APP_TAG)"
