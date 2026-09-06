#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ciyuan-nav"
SERVICE_NAME="${APP_NAME}.service"
SERVICE_USER="ciyuan-nav"
APP_ROOT="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
PORT="80"
DB_BACKUP=""
SCRAPER_URL=""
SCRAPER_PROXY_URL=""
SCRAPER_TIMEOUT_MS="15000"
SCRAPER_MIN_INTERVAL_MS="300000"
SCRAPER_ICON_CONCURRENCY="2"
SCRAPER_MAX_HTML_BYTES="3145728"
SCRAPER_MAX_ICON_BYTES="2097152"
PUBLIC_CATALOG_CACHE_MAX_BYTES="4194304"
NODE_MAX_OLD_SPACE_MB="256"
ADMIN_PASSWORD_FILE=""
COMMUNITY_PASSWORD_FILE=""
TRUST_PROXY_HOPS="loopback"
SOURCE_URL=""
GITHUB_OWNER="wssqian"
GITHUB_REPO="cydh"
GITHUB_TOKEN=""
SIGNING_PUBLIC_KEY=""
SKIP_TESTS=""
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/install-linux.sh --admin-password-file /path/to/password.txt [--port PORT] [--db-backup /path/to/nav.db] [--scraper-url URL] [--scraper-proxy-url URL] [--node-max-old-space-mb MB]

Installs a release under /opt/ciyuan-nav, keeps SQLite data in
/var/lib/ciyuan-nav, and runs the app as a systemd service.

Options:
  --port PORT              HTTP listen port (default: 80)
  --db-backup PATH         Import a validated portable SQLite backup
  --scraper-url URL        Persistently override and validate the scraper source URL
  --scraper-proxy-url URL  Use an HTTP/HTTPS proxy while validating and running scraper requests
  --node-max-old-space-mb MB
                           Node.js old-space limit for the production service (default: 256)
  --admin-password-file PATH
                           Required file containing a unique administrator password of at least 8 characters
  --community-password-file PATH
                           Required file containing a unique community access password (gates /pixiv、/bangumi、/manga、/galgame) of at least 8 characters
  --trust-proxy-hops VALUE Trust local reverse proxy by default (`loopback`); use 1-3 for known proxy hops or 0 for direct HTTP only
  --source-url URL         Clone source from a Git repository instead of the local checkout (public or private; token via --github-token)
  --github-owner OWNER     Update-source repository owner for the updater (default: wssqian)
  --github-repo REPO       Update-source repository name for the updater (default: cydh)
  --github-token TOKEN     Token for private update-source repository (optional for public repos)
  --signing-public-key KEY Ed25519 public key for release-package signature verification (written to settings)
  --skip-tests             Skip `npm test` during install (faster first deploy)
  --help                   Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:?Missing port value}"
      shift 2
      ;;
    --db-backup)
      DB_BACKUP="${2:?Missing database backup path}"
      shift 2
      ;;
    --scraper-url)
      SCRAPER_URL="${2:?Missing scraper source URL}"
      shift 2
      ;;
    --scraper-proxy-url)
      SCRAPER_PROXY_URL="${2:?Missing scraper proxy URL}"
      shift 2
      ;;
    --node-max-old-space-mb)
      NODE_MAX_OLD_SPACE_MB="${2:?Missing Node.js memory limit value}"
      shift 2
      ;;
    --admin-password-file)
      ADMIN_PASSWORD_FILE="${2:?Missing administrator password file path}"
      shift 2
      ;;
    --community-password-file)
      COMMUNITY_PASSWORD_FILE="${2:?Missing community password file path}"
      shift 2
      ;;
    --trust-proxy-hops)
      TRUST_PROXY_HOPS="${2:?Missing trusted proxy hop count}"
      shift 2
      ;;
    --source-url)
      SOURCE_URL="${2:?Missing source repository URL}"
      shift 2
      ;;
    --github-owner)
      GITHUB_OWNER="${2:?Missing github owner}"
      shift 2
      ;;
    --github-repo)
      GITHUB_REPO="${2:?Missing github repo}"
      shift 2
      ;;
    --github-token)
      GITHUB_TOKEN="${2:?Missing github token}"
      shift 2
      ;;
    --signing-public-key)
      SIGNING_PUBLIC_KEY="${2:?Missing signing public key}"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo or as root." >&2
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Invalid port: ${PORT}" >&2
  exit 1
fi

if [[ "${TRUST_PROXY_HOPS}" != "loopback" ]] && ! [[ "${TRUST_PROXY_HOPS}" =~ ^[0-3]$ ]]; then
  echo "Invalid trusted proxy setting: ${TRUST_PROXY_HOPS}" >&2
  exit 1
fi

if ! [[ "${NODE_MAX_OLD_SPACE_MB}" =~ ^[0-9]+$ ]] || (( NODE_MAX_OLD_SPACE_MB < 64 || NODE_MAX_OLD_SPACE_MB > 4096 )); then
  echo "Invalid Node.js memory limit: ${NODE_MAX_OLD_SPACE_MB}" >&2
  exit 1
fi

if [[ -z "${ADMIN_PASSWORD_FILE}" ]]; then
  echo "--admin-password-file is required for production deployment." >&2
  exit 1
fi
ADMIN_PASSWORD_FILE="$(readlink -f "${ADMIN_PASSWORD_FILE}")"
if [[ ! -f "${ADMIN_PASSWORD_FILE}" ]]; then
  echo "Administrator password file not found: ${ADMIN_PASSWORD_FILE}" >&2
  exit 1
fi
IFS= read -r ADMIN_PASSWORD < "${ADMIN_PASSWORD_FILE}" || true
if (( ${#ADMIN_PASSWORD} < 8 )); then
  echo "Administrator password must be at least 16 characters." >&2
  exit 1
fi

if [[ -z "${COMMUNITY_PASSWORD_FILE}" ]]; then
  echo "--community-password-file is required for production deployment (gates /pixiv、/bangumi、/manga、/galgame)." >&2
  exit 1
fi
COMMUNITY_PASSWORD_FILE="$(readlink -f "${COMMUNITY_PASSWORD_FILE}")"
if [[ ! -f "${COMMUNITY_PASSWORD_FILE}" ]]; then
  echo "Community password file not found: ${COMMUNITY_PASSWORD_FILE}" >&2
  exit 1
fi
IFS= read -r COMMUNITY_PASSWORD < "${COMMUNITY_PASSWORD_FILE}" || true
if (( ${#COMMUNITY_PASSWORD} < 8 )); then
  echo "Community password must be at least 16 characters and differ from the bundled default." >&2
  exit 1
fi
if [[ "${COMMUNITY_PASSWORD}" == "gugugaga" ]]; then
  echo "Community password must not be the bundled default (gugugaga)." >&2
  exit 1
fi

for command in node npm systemctl tar curl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

if [[ -n "${DB_BACKUP}" ]]; then
  DB_BACKUP="$(readlink -f "${DB_BACKUP}")"
  if [[ ! -f "${DB_BACKUP}" ]]; then
    echo "Database backup not found: ${DB_BACKUP}" >&2
    exit 1
  fi
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

install -d -m 0755 "${APP_ROOT}" "${APP_ROOT}/releases"
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 "${DATA_DIR}"
install -d -o root -g "${SERVICE_USER}" -m 0750 "/etc/${APP_NAME}"
ESCAPED_ADMIN_PASSWORD="${ADMIN_PASSWORD//\\/\\\\}"
ESCAPED_ADMIN_PASSWORD="${ESCAPED_ADMIN_PASSWORD//\"/\\\"}"
ESCAPED_COMMUNITY_PASSWORD="${COMMUNITY_PASSWORD//\\/\\\\}"
ESCAPED_COMMUNITY_PASSWORD="${ESCAPED_COMMUNITY_PASSWORD//\"/\\\"}"
( umask 077; printf 'ADMIN_PASSWORD="%s"\nCOMMUNITY_PASSWORD="%s"\n' "${ESCAPED_ADMIN_PASSWORD}" "${ESCAPED_COMMUNITY_PASSWORD}" > "/etc/${APP_NAME}/environment.tmp" )
install -o root -g "${SERVICE_USER}" -m 0640 \
  "/etc/${APP_NAME}/environment.tmp" "/etc/${APP_NAME}/environment"
rm -f "/etc/${APP_NAME}/environment.tmp"

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
install -d -m 0755 "${RELEASE_DIR}"

if [[ -n "${SOURCE_URL}" ]]; then
  # 从 Git 仓库直接拉取源码（新设备免上传）
  echo "Cloning source from ${SOURCE_URL}..."
  git clone --depth 1 --branch main "${SOURCE_URL}" "${RELEASE_DIR}"
  rm -rf "${RELEASE_DIR}/.git"
  # 保留 releases 目录避免嵌套
  rm -rf "${RELEASE_DIR}/releases"
else
  # 默认：打包当前源码目录（兼容本地部署）
  tar -C "${SOURCE_DIR}" \
    --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./data' \
    --exclude='./backups' \
    --exclude='./.git' \
    --exclude='./.env' \
    --exclude='./.env.local' \
    -cf - . | tar -C "${RELEASE_DIR}" -xf -
fi

cd "${RELEASE_DIR}"
npm ci
npm run lint
if [[ -z "${SKIP_TESTS}" ]]; then
  npm test
else
  echo "Skipping tests (--skip-tests)"
fi
npm run build
npm prune --omit=dev

run_scraper_check() {
  local database_path="${DATA_DIR}/nav.db"
  local -a scraper_args=(--database "${database_path}")

  if [[ -n "${DB_BACKUP}" ]]; then
    database_path="${DB_BACKUP}"
    scraper_args=(--database "${database_path}")
  fi

  if [[ -n "${SCRAPER_URL}" ]]; then
    scraper_args+=(--url "${SCRAPER_URL}")
  fi
  if [[ -n "${SCRAPER_PROXY_URL}" ]]; then
    scraper_args+=(--proxy-url "${SCRAPER_PROXY_URL}")
  fi

  echo "Validating scraper source and parser before activation..."
  SCRAPER_TIMEOUT_MS="${SCRAPER_TIMEOUT_MS}" \
  SCRAPER_MAX_HTML_BYTES="${SCRAPER_MAX_HTML_BYTES}" \
  node dist/check-scraper.cjs "${scraper_args[@]}"
}

if [[ -n "${DB_BACKUP}" ]]; then
  DB_FILE="${DB_BACKUP}" node --input-type=module <<'NODE'
import Database from 'better-sqlite3';

const database = new Database(process.env.DB_FILE, { readonly: true, fileMustExist: true });
try {
  const result = database.pragma('quick_check', { simple: true });
  if (result !== 'ok') {
    throw new Error(`quick_check returned ${String(result)}`);
  }
} finally {
  database.close();
}
NODE
fi

run_scraper_check

if systemctl is-active --quiet "${SERVICE_NAME}"; then
  systemctl stop "${SERVICE_NAME}"
fi

if [[ -n "${DB_BACKUP}" ]]; then
  for suffix in "" "-wal" "-shm" "-journal"; do
    if [[ -f "${DATA_DIR}/nav.db${suffix}" ]]; then
      mv "${DATA_DIR}/nav.db${suffix}" "${DATA_DIR}/nav.db.pre-import-${RELEASE_ID}${suffix}.bak"
    fi
  done
  install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0640 \
    "${DB_BACKUP}" "${DATA_DIR}/nav.db.incoming"
  mv -f "${DATA_DIR}/nav.db.incoming" "${DATA_DIR}/nav.db"
fi

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${SERVICE_NAME}" <<EOF
[Unit]
Description=CiYuan Nav resource navigator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${CURRENT_LINK}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=NAV_DATA_DIR=${DATA_DIR}
Environment=NODE_OPTIONS=--max-old-space-size=${NODE_MAX_OLD_SPACE_MB}
Environment=SCRAPER_TIMEOUT_MS=${SCRAPER_TIMEOUT_MS}
Environment=SCRAPER_MIN_INTERVAL_MS=${SCRAPER_MIN_INTERVAL_MS}
Environment=SCRAPER_ICON_CONCURRENCY=${SCRAPER_ICON_CONCURRENCY}
Environment=SCRAPER_MAX_HTML_BYTES=${SCRAPER_MAX_HTML_BYTES}
Environment=SCRAPER_MAX_ICON_BYTES=${SCRAPER_MAX_ICON_BYTES}
Environment=PUBLIC_CATALOG_CACHE_MAX_BYTES=${PUBLIC_CATALOG_CACHE_MAX_BYTES}
Environment="SCRAPER_URL=${SCRAPER_URL}"
Environment="SCRAPER_PROXY_URL=${SCRAPER_PROXY_URL}"
Environment=GITHUB_OWNER=${GITHUB_OWNER}
Environment=GITHUB_REPO=${GITHUB_REPO}
Environment="GITHUB_TOKEN=${GITHUB_TOKEN}"
Environment=ADMIN_COOKIE_SECURE=true
Environment=TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS}
EnvironmentFile=/etc/${APP_NAME}/environment
ExecStart=${NODE_BIN} ${CURRENT_LINK}/dist/server.cjs
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"

for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    echo "HTTP API is healthy. Rechecking scraper source with the activated data configuration..."
    if NAV_DATA_DIR="${DATA_DIR}" SCRAPER_URL="${SCRAPER_URL}" SCRAPER_PROXY_URL="${SCRAPER_PROXY_URL}" SCRAPER_TIMEOUT_MS="${SCRAPER_TIMEOUT_MS}" SCRAPER_MAX_HTML_BYTES="${SCRAPER_MAX_HTML_BYTES}" node dist/check-scraper.cjs; then
      # 写入更新系统签名公钥（发布包更新验签用）
      if [[ -n "${SIGNING_PUBLIC_KEY}" ]]; then
        echo "Configuring update-system signing public key..."
        NAV_DATA_DIR="${DATA_DIR}" SIGNING_PUBLIC_KEY="${SIGNING_PUBLIC_KEY}" node --input-type=module <<'NODE'
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dataDir = process.env.NAV_DATA_DIR;
const dbPath = path.join(dataDir, 'nav.db');
const key = process.env.SIGNING_PUBLIC_KEY ?? '';
if (!existsSync(dbPath)) {
  console.error('nav.db not found at', dbPath);
  process.exit(1);
}
const db = new Database(dbPath);

try {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run('updater_signature_public_key', key);
  console.log('Signing public key written.');
} finally {
  db.close();
}
NODE
      fi
      echo "Deployment complete: http://127.0.0.1:${PORT}"
      echo "Persistent database directory: ${DATA_DIR}"
      echo "Update source: ${GITHUB_OWNER}/${GITHUB_REPO}"
      exit 0
    fi
    break
  fi
  sleep 1
done

echo "Service did not become healthy in time." >&2
systemctl --no-pager --full status "${SERVICE_NAME}" >&2 || true

if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
  ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
  systemctl restart "${SERVICE_NAME}" || true
  echo "Application release symlink was rolled back to ${PREVIOUS_RELEASE}." >&2
fi

exit 1
