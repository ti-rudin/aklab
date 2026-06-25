#!/bin/bash
# scripts/notify-deploy.sh
# Email-уведомление о результатах деплоя
#
# Usage: ./scripts/notify-deploy.sh <status> <environment> <version> [changelog_file] [error_message]
# status:    success | failure
# environment: dev | prod
# version:   v1.0.37
# changelog_file: путь к файлу с changelog (опционально)
# error_message:  текст ошибки (опционально)

set -euo pipefail

STATUS=${1:?Usage: notify-deploy.sh <status> <env> <version> [changelog_file] [error]}
ENV=${2:?}
VERSION=${3:?}
CHANGELOG_FILE=${4:-""}
ERROR_MSG=${5:-""}
TIMESTAMP=$(TZ=Europe/Moscow date '+%Y-%m-%d %H:%M:%S МСК')

# Загружаем .env если есть
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  source "$SCRIPT_DIR/../.env"
  set +a
fi

# Email settings
SMTP_HOST="${EMAIL_SMTP_HOST:-smtp.yandex.ru}"
SMTP_PORT="${EMAIL_SMTP_PORT:-465}"
SMTP_USER="${EMAIL_SMTP_USER:-}"
SMTP_PASS="${EMAIL_SMTP_PASS:-}"
NOTIFY_EMAIL="${DEPLOY_NOTIFY_EMAIL:-a@rudin.ru}"

if [ -z "$SMTP_USER" ] || [ -z "$SMTP_PASS" ]; then
  echo "⚠️ SMTP credentials not configured — skipping email notification"
  exit 0
fi

# Changelog content
CHANGELOG_CONTENT=""
if [ -n "$CHANGELOG_FILE" ] && [ -f "$CHANGELOG_FILE" ]; then
  CHANGELOG_CONTENT=$(cat "$CHANGELOG_FILE" | head -30)
fi

# Формируем тему и тело
if [ "$STATUS" = "success" ]; then
  SUBJECT="✅ AKLAB $ENV — $VERSION"
  BODY="Деплой $VERSION на $ENV выполнен успешно.\n\nВремя: $TIMESTAMP"
  if [ -n "$CHANGELOG_CONTENT" ]; then
    BODY="$BODY\n\n--- Изменения ---\n$CHANGELOG_CONTENT"
  fi
else
  SUBJECT="❌ AKLAB $ENV FAILED — $VERSION"
  BODY="Деплой $VERSION на $ENV провалился.\n\nВремя: $TIMESTAMP\nОшибка: $ERROR_MSG\n\nТребуется ручное вмешательство."
fi

# Отправляем через Node.js + nodemailer
node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: '${SMTP_HOST}',
  port: ${SMTP_PORT},
  secure: true,
  auth: { user: '${SMTP_USER}', pass: '${SMTP_PASS}' }
});
transporter.sendMail({
  from: '${SMTP_USER}',
  to: '${NOTIFY_EMAIL}',
  subject: $(python3 -c "import json; print(json.dumps('$SUBJECT'))"),
  text: $(python3 -c "import json; print(json.dumps('$(echo -e "$BODY")'))")
}).then(() => {
  console.log('✅ Email sent to ${NOTIFY_EMAIL}');
}).catch(e => {
  console.error('❌ Email failed:', e.message);
  process.exit(1);
});
"
