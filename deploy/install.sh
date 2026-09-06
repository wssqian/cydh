echo "服务未能及时就绪，回滚..." >&2
if [[ ${HAS_SYSTEMD} -eq 1 ]]; then
  systemctl --no-pager --full status "${SERVICE_NAME}" >&2 || true
  if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
    systemctl restart "${SERVICE_NAME}" || true
    echo "已回滚到 ${PREVIOUS_RELEASE}" >&2
  fi
else
  cat "${APP_ROOT}/service.log" 2>/dev/null | tail -30 >&2 || true
  if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
    bash "${APP_ROOT}/run-service.sh" restart || true
    echo "已回滚到 ${PREVIOUS_RELEASE}" >&2
  fi
fi
#!/usr/bin/env bash
# ===================================================================
#  次元导航 · CiYuan Nav — 一键安装器（自包含）
#  用法（root）:
#    curl -sSL https://raw.githubusercontent.com/wssqian/cydh/main/install.sh | sudo bash
#  或（本地）:
#    sudo bash install.sh
# ===================================================================
set -euo pipefail

# ---------- 默认值 ----------
APP_NAME="ciyuan-nav"
SERVICE_NAME="${APP_NAME}.service"
SERVICE_USER="${APP_NAME}"
APP_ROOT="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
PORT="${PORT:-80}"
GITHUB_OWNER="${GITHUB_OWNER:-wssqian}"
GITHUB_REPO="${GITHUB_REPO:-cydh}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
VERSION="${VERSION:-latest}"
SOURCE_URL=""
ADMIN_PASSWORD_FILE=""
COMMUNITY_PASSWORD_FILE=""
TRUST_PROXY_HOPS="${TRUST_PROXY_HOPS:-loopback}"
SIGNING_PUBLIC_KEY="${SIGNING_PUBLIC_KEY:-}"
SKIP_TESTS="${SKIP_TESTS:-}"

# ---------- 帮助 ----------
usage() {
  cat <<'USAGE_HELP'
Usage: sudo bash install.sh [options]
Deploys the latest (or a pinned) release of CiYuan Nav.

Options:
  --version <tag>           Release tag to install (default: latest)
  --source-url <url>        Clone source from a git repo instead of downloading a release bundle
  --github-owner <owner>    Update-source owner for the updater (default: wssqian)
  --github-repo <repo>      Update-source repo for the updater (default: cydh)
  --github-token <token>    Token to access a private source repo
  --admin-password-file <p> Required file with the admin password (>=16 chars)
  --community-password-file <p> Required file with the community password (>=16 chars)
  --signing-public-key <k>  Ed25519 public key for release signature verification (optional)
  --port <port>             HTTP listen port (default: 80)
  --skip-tests              Skip `npm test` during a source install
  -h, --help                Show this help
USAGE_HELP
}

# ---------- 解析参数 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?Missing version}"; shift 2 ;;
    --source-url) SOURCE_URL="${2:?Missing source URL}"; shift 2 ;;
    --github-owner) GITHUB_OWNER="${2:?Missing owner}"; shift 2 ;;
    --github-repo) GITHUB_REPO="${2:?Missing repo}"; shift 2 ;;
    --github-token) GITHUB_TOKEN="${2:?Missing token}"; shift 2 ;;
    --admin-password-file) ADMIN_PASSWORD_FILE="${2:?Missing file}"; shift 2 ;;
    --community-password-file) COMMUNITY_PASSWORD_FILE="${2:?Missing file}"; shift 2 ;;
    --signing-public-key) SIGNING_PUBLIC_KEY="${2:?Missing key}"; shift 2 ;;
    --port) PORT="${2:?Missing port}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "请以 root 或 sudo 运行。" >&2; exit 1
fi
if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "无效端口: ${PORT}" >&2; exit 1
fi
if [[ -z "${ADMIN_PASSWORD_FILE}" ]]; then
  echo "--admin-password-file 为必填项（包含管理员密码的文件）。" >&2; usage >&2; exit 1
fi
ADMIN_PASSWORD_FILE="$(readlink -f "${ADMIN_PASSWORD_FILE}")"
[[ -f "${ADMIN_PASSWORD_FILE}" ]] || { echo "管理员密码文件不存在: ${ADMIN_PASSWORD_FILE}" >&2; exit 1; }
IFS= read -r ADMIN_PASSWORD < "${ADMIN_PASSWORD_FILE}" || true
(( ${#ADMIN_PASSWORD} >= 8 )) || { echo "管理员密码至少 8 位。" >&2; exit 1; }
if [[ -z "${COMMUNITY_PASSWORD_FILE}" ]]; then
  echo "--community-password-file 为必填项（社区访问口令）。" >&2; usage >&2; exit 1
fi
COMMUNITY_PASSWORD_FILE="$(readlink -f "${COMMUNITY_PASSWORD_FILE}")"
[[ -f "${COMMUNITY_PASSWORD_FILE}" ]] || { echo "社区口令文件不存在: ${COMMUNITY_PASSWORD_FILE}" >&2; exit 1; }
IFS= read -r COMMUNITY_PASSWORD < "${COMMUNITY_PASSWORD_FILE}" || true
(( ${#COMMUNITY_PASSWORD} >= 8 )) || { echo "社区口令至少 8 位。" >&2; exit 1; }

for cmd in node npm tar curl git; do
  command -v "${cmd}" >/dev/null 2>&1 || { echo "缺少命令: ${cmd}" >&2; exit 1; }
done
# 检测 systemd（普通 Linux 服务器有；proot/Termux 容器通常没有）
HAS_SYSTEMD=0
command -v systemctl >/dev/null 2>&1 && HAS_SYSTEMD=1
echo ">> 检测 systemd: $([ $HAS_SYSTEMD -eq 1 ] && echo '有（systemd 模式）' || echo '无（nohup/proot 模式）')"

# ---------- 自动安装 Node.js 20（全新服务器通常未安装） ----------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  echo ">> 未检测到 Node.js 20，自动安装..."
  apt-get update -y
  apt-get install -y curl build-essential python3 2>/dev/null || true
  # 安装 NodeSource 的 Node 20 LTS
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null || true
  apt-get install -y nodejs
  node -v
fi

# ---------- 准备目录 ----------
id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
install -d -m 0755 "${APP_ROOT}" "${APP_ROOT}/releases"
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 "${DATA_DIR}"
install -d -o root -g "${SERVICE_USER}" -m 0750 "/etc/${APP_NAME}"

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
install -d -m 0755 "${RELEASE_DIR}"

# ---------- 获取源码/部署包 ----------
if [[ -n "${SOURCE_URL}" ]]; then
  # 模式 A：从 Git 仓库克隆源码（私有仓库需 --github-token）
  echo ">> 克隆源码: ${SOURCE_URL}"
  if [[ -n "${GITHUB_TOKEN}" ]]; then
    AUTH_URL="${SOURCE_URL/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"
    git clone --depth 1 "${AUTH_URL}" "${RELEASE_DIR}"
  else
    git clone --depth 1 --branch main "${SOURCE_URL}" "${RELEASE_DIR}"
  fi
  rm -rf "${RELEASE_DIR}/.git" "${RELEASE_DIR}/releases"
  cd "${RELEASE_DIR}"
  npm ci
  npm run lint
  [[ -z "${SKIP_TESTS}" ]] && npm test
  npm run build
  npm prune --omit=dev
else
  # 模式 B：从 cydh GitHub Releases 下载发布包（含 dist + package.json + lockfile）
  if [[ "${VERSION}" == "latest" ]]; then
    # 跟随 github.com/releases/latest 重定向解析最新 tag（走 github.com，避免 api/raw 子域被墙）
    REDIRECT_URL="$(curl -fsSI -o /dev/null -w '%{url_effective}' "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest" 2>/dev/null || true)"
    TAG="$(basename "${REDIRECT_URL}" 2>/dev/null || true)"
    [[ -z "${TAG}" || "${TAG}" == "latest" ]] && TAG="v0.1.0"
    ASSET_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${TAG}/${TAG#v}-deploy.tar.gz"
  else
    ASSET_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${VERSION}/${VERSION#v}-deploy.tar.gz"
  fi
  echo ">> 下载发布包: ${ASSET_URL}"
  curl -fsSL -o /tmp/cydh-deploy.tar.gz "${ASSET_URL}"
  tar -xzf /tmp/cydh-deploy.tar.gz -C "${RELEASE_DIR}"
  cd "${RELEASE_DIR}"
  npm ci --omit=dev || npm install --omit=dev
fi

# ---------- 写入环境配置 ----------
ESCAPED_ADMIN_PASSWORD="${ADMIN_PASSWORD//\\/\\\\}"
ESCAPED_ADMIN_PASSWORD="${ESCAPED_ADMIN_PASSWORD//\"/\\\"}"
ESCAPED_COMMUNITY_PASSWORD="${COMMUNITY_PASSWORD//\\/\\\\}"
ESCAPED_COMMUNITY_PASSWORD="${ESCAPED_COMMUNITY_PASSWORD//\"/\\\"}"
( umask 077; printf 'ADMIN_PASSWORD="%s"\nCOMMUNITY_PASSWORD="%s"\n' "${ESCAPED_ADMIN_PASSWORD}" "${ESCAPED_COMMUNITY_PASSWORD}" > "/etc/${APP_NAME}/environment.tmp" )
install -o root -g "${SERVICE_USER}" -m 0640 "/etc/${APP_NAME}/environment.tmp" "/etc/${APP_NAME}/environment"
rm -f "/etc/${APP_NAME}/environment.tmp"

# ---------- 服务启动 ----------
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"
NODE_BIN="$(command -v node)"
# 写环境文件（两种模式共用）
install -o root -g "${SERVICE_USER}" -m 0640 "/etc/${APP_NAME}/environment" "/etc/${APP_NAME}/environment" 2>/dev/null || true

if [[ ${HAS_SYSTEMD} -eq 1 ]]; then
  # ===== systemd 模式（普通 Linux 服务器） =====
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  cat > "/etc/systemd/system/${SERVICE_NAME}" <<SYS_UNIT_EOF
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
SYS_UNIT_EOF
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null
  systemctl restart "${SERVICE_NAME}"
else
  # ===== nohup 模式（proot/Termux 容器，无 systemd） =====
  echo ">> 使用 nohup 后台模式启动服务..."
  PID_FILE="${APP_ROOT}/service.pid"
  LOG_FILE="${APP_ROOT}/service.log"
  # 停旧进程
  if [[ -f "${PID_FILE}" ]]; then
    OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
    [[ -n "${OLD_PID}" ]] && kill "${OLD_PID}" 2>/dev/null || true
  fi
  # 写启动脚本（供手动管理）
  cat > "${APP_ROOT}/run-service.sh" <<RUN_SVC_EOF
#!/usr/bin/env bash
# 次元导航服务管理脚本（proot/Termux 容器用，替代 systemd）
# 用法: bash run-service.sh {start|stop|restart|status|logs}
APP_ROOT="${APP_ROOT}"
DATA_DIR="${DATA_DIR}"
CURRENT_LINK="${CURRENT_LINK}"
PORT="${PORT}"
GITHUB_OWNER="${GITHUB_OWNER}"
GITHUB_REPO="${GITHUB_REPO}"
GITHUB_TOKEN="${GITHUB_TOKEN}"
TRUST_PROXY_HOPS="${TRUST_PROXY_HOPS}"
SERVICE_USER="${SERVICE_USER}"
PID_FILE="\${APP_ROOT}/service.pid"
LOG_FILE="\${APP_ROOT}/service.log"
# 加载管理员/社区密码
[ -f "/etc/${APP_NAME}/environment" ] && . "/etc/${APP_NAME}/environment" 2>/dev/null || true
start() {
  if [[ -f "\${PID_FILE}" ]] && kill -0 "\$(cat "\${PID_FILE}" 2>/dev/null)" 2>/dev/null; then
    echo "服务已在运行 (PID \$(cat "\${PID_FILE}"))"; return 0
  fi
  nohup env NODE_ENV=production PORT="\${PORT}" NAV_DATA_DIR="\${DATA_DIR}"     GITHUB_OWNER="\${GITHUB_OWNER}" GITHUB_REPO="\${GITHUB_REPO}" GITHUB_TOKEN="\${GITHUB_TOKEN}"     ADMIN_PASSWORD="\${ADMIN_PASSWORD}" COMMUNITY_PASSWORD="\${COMMUNITY_PASSWORD}"     ADMIN_COOKIE_SECURE=true TRUST_PROXY_HOPS="\${TRUST_PROXY_HOPS}"     \$(command -v node) "\${CURRENT_LINK}/dist/server.cjs"     >> "\${LOG_FILE}" 2>&1 &
  echo \$! > "\${PID_FILE}"
  echo "服务已启动 (PID \$!)，日志: \${LOG_FILE}"
}
stop() {
  if [[ -f "\${PID_FILE}" ]]; then
    kill "\$(cat "\${PID_FILE}" 2>/dev/null)" 2>/dev/null && echo "服务已停止" || echo "服务未运行"
    rm -f "\${PID_FILE}"
  else
    echo "服务未运行"
  fi
}
restart() { stop; sleep 1; start; }
status() {
  if [[ -f "\${PID_FILE}" ]] && kill -0 "\$(cat "\${PID_FILE}" 2>/dev/null)" 2>/dev/null; then
    echo "运行中 (PID \$(cat "\${PID_FILE}"))"
    curl -fsS "http://127.0.0.1:\${PORT}/api/health" >/dev/null 2>&1 && echo "健康检查: 通过" || echo "健康检查: 未通过"
  else
    echo "未运行"
  fi
}
logs() { tail -50 "\${LOG_FILE}" 2>/dev/null || echo "无日志"; }
case "\${1:-status}" in
  start) start;; stop) stop;; restart) restart;; status) status;; logs) logs;; *) echo "用法: \$0 {start|stop|restart|status|logs}";;
esac
RUN_SVC_EOF
  chmod +x "${APP_ROOT}/run-service.sh"
  # 立即启动
  bash "${APP_ROOT}/run-service.sh" start
  # 开机自启提示（Termux 用 ~/.termux/boot，proot 手动）
  echo "  （开机自启：proot 容器请用 nohup 或 termux-services 手动配置）"
fi
# ---------- 健康检查 ----------
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    # 写入验签公钥（可选）
    if [[ -n "${SIGNING_PUBLIC_KEY}" ]]; then
      echo ">> 写入更新系统验签公钥..."
      NAV_DATA_DIR="${DATA_DIR}" SIGNING_PUBLIC_KEY="${SIGNING_PUBLIC_KEY}" node --input-type=module <<'KEY_NODE'
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';
const dbPath = path.join(process.env.NAV_DATA_DIR, 'nav.db');
if (existsSync(dbPath)) {
  const db = new Database(dbPath);
  try { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('updater_signature_public_key', process.env.SIGNING_PUBLIC_KEY); } finally { db.close(); }
}
KEY_NODE
    fi
    echo "=============================================="
    echo " 部署完成！"
    echo "   访问地址: http://127.0.0.1:${PORT}（域名反代见 README）"
    echo "   数据目录: ${DATA_DIR}"
    echo "   更新来源: ${GITHUB_OWNER}/${GITHUB_REPO}"
    echo "=============================================="
    exit 0
  fi
  sleep 1
done

echo "服务未能及时就绪，回滚..." >&2
systemctl --no-pager --full status "${SERVICE_NAME}" >&2 || true
if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
  ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
  systemctl restart "${SERVICE_NAME}" || true
  echo "已回滚到 ${PREVIOUS_RELEASE}" >&2
fi
exit 1