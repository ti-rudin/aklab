#!/bin/bash
# scripts/health-watchdog.sh
# Периодический health-check с email-алертами при смене состояния.
#
# Запускает node scripts/health-check.js, отслеживает переходы healthy→unhealthy
# и unhealthy→healthy, отправляет email через nodemailer.
#
# Usage:
#   Ручной запуск:  ./scripts/health-watchdog.sh
#   Cron (каждые 5 мин):
#     */5 * * * * cd /home/rudin/aklab && ./scripts/health-watchdog.sh >> /tmp/aklab-health.log 2>&1
#
# Файл состояния: /tmp/aklab-health-status
#   "ok"   — последняя проверка успешна
#   "fail" — последняя проверка провалена

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
STATE_FILE="/tmp/aklab-health-status"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log() {
  echo "[$TIMESTAMP] $*"
}

# ─── Загружаем .env ────────────────────────────────────────────────────
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
else
  log "⚠️  .env не найден — email-уведомления будут пропущены"
fi

# ─── Email settings ────────────────────────────────────────────────────
SMTP_HOST="${EMAIL_SMTP_HOST:-smtp.yandex.ru}"
SMTP_PORT="${EMAIL_SMTP_PORT:-465}"
SMTP_USER="${EMAIL_SMTP_USER:-}"
SMTP_PASS="${EMAIL_SMTP_PASS:-}"
NOTIFY_EMAIL="${DEPLOY_NOTIFY_EMAIL:-a@rudin.ru}"

# ─── Запуск health-check ──────────────────────────────────────────────
HEALTH_OUTPUT=""
HEALTH_EXIT=0

HEALTH_OUTPUT=$(cd "$PROJECT_ROOT" && node scripts/health-check.js 2>&1) || HEALTH_EXIT=$?

# Определяем текущий статус
if [ "$HEALTH_EXIT" -eq 0 ]; then
  CURRENT_STATUS="ok"
else
  CURRENT_STATUS="fail"
fi

log "Health check exit=$HEALTH_EXIT → status=$CURRENT_STATUS"

# ─── Читаем предыдущий статус ─────────────────────────────────────────
PREVIOUS_STATUS=""
if [ -f "$STATE_FILE" ]; then
  PREVIOUS_STATUS=$(cat "$STATE_FILE")
fi

# ─── Логика смены состояния ────────────────────────────────────────────
# Обновляем state file
echo "$CURRENT_STATUS" > "$STATE_FILE"

# Если статус не изменился — ничего не отправляем
if [ "$CURRENT_STATUS" = "$PREVIOUS_STATUS" ]; then
  log "Статус не изменился ($CURRENT_STATUS) — email не отправляем"
  exit 0
fi

# Смена состояния — нужно отправить email
log "Смена состояния: $PREVIOUS_STATUS → $CURRENT_STATUS"

# Если .env не настроен или нет SMTP credentials — логируем и выходим
if [ -z "$SMTP_USER" ] || [ -z "$SMTP_PASS" ]; then
  log "⚠️  SMTP credentials не настроены — email пропущен"
  exit 0
fi

# ─── Проверяем nodemailer ─────────────────────────────────────────────
if ! node -e "require('nodemailer')" 2>/dev/null; then
  log "⚠️  nodemailer не найден — email пропущен"
  exit 0
fi

# ─── Формируем email ──────────────────────────────────────────────────
if [ "$CURRENT_STATUS" = "fail" ]; then
  SUBJECT="🔴 AKLAB Alert: сервис(ы) недоступны"
  BODY="Обнаружены недоступные сервисы AKLAB.

Время: $TIMESTAMP

--- Результат health-check ---
$HEALTH_OUTPUT

Проверьте логи и перезапустите сервисы при необходимости."
else
  SUBJECT="✅ AKLAB: все сервисы восстановлены"
  BODY="Все сервисы AKLAB снова доступны.

Время: $TIMESTAMP

--- Результат health-check ---
$HEALTH_OUTPUT"
fi

# ─── Пишем тело во временный файл ─────────────────────────────────────
BODY_FILE=$(mktemp /tmp/health-watchdog-XXXXXX.txt)
echo "$BODY" > "$BODY_FILE"

# ─── Отправляем email через nodemailer ─────────────────────────────────
log "Отправляем email: $SUBJECT"

node -e "
const nodemailer = require('nodemailer');
const fs = require('fs');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '${SMTP_HOST}',
  port: parseInt(process.env.SMTP_PORT || '${SMTP_PORT}'),
  secure: true,
  auth: { user: process.env.SMTP_USER || '${SMTP_USER}', pass: process.env.SMTP_PASS || '${SMTP_PASS}' }
});
const body = fs.readFileSync('${BODY_FILE}', 'utf8');
transporter.sendMail({
  from: process.env.SMTP_USER || '${SMTP_USER}',
  to: '${NOTIFY_EMAIL}',
  subject: '${SUBJECT}',
  text: body
}).then(() => {
  console.log('✅ Email sent to ${NOTIFY_EMAIL}');
}).catch(e => {
  console.error('❌ Email failed:', e.message);
  process.exit(1);
});
" || log "❌ Не удалось отправить email"

rm -f "$BODY_FILE"

log "Done"
