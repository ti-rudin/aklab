# CI/CD для AKLAB — план

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Настроить CI/CD: тесты на PR, ручной деплой dev/prod через GitHub Actions, сборка на сервере.

**Architecture:** GitHub Actions запускает тесты при PR. Deploy — `workflow_dispatch` (ручной кнопкой). Сборка на сервере (как в tirobots). Secrets в GitHub Secrets.

**Tech Stack:** GitHub Actions, SSH, PM2, Playwright, Node.js

---

## Текущее состояние

- ❌ `.github/workflows/` не существует
- ✅ `scripts/deploy-prod.sh` — полный deploy pipeline с rollback
- ✅ `tests/e2e.spec.ts` — Playwright e2e тесты
- ✅ `scripts/smoke-test.js` — smoke тесты
- ✅ `scripts/check-env.js` — проверка env переменных
- ✅ PM2 ecosystem config на серверах
- ✅ Ветки: `main` (prod), `dev` (dev)

## Решения

- **Build location:** на сервере (SSH + git pull + npm run build)
- **Trigger:** PR → тесты автоматом. Deploy → `workflow_dispatch` вручную
- **Environments:** `dev` (192.168.11.151) и `prod` (213.184.136.221)
- **Tests:** smoke + e2e на каждом PR в `main` и `dev`
- **Rollback:** через существующий `deploy-prod.sh` (trap on error)

---

## Tasks

### Task 1: GitHub Secrets

**Objective:** Настроить SSH-ключи и переменные для CI

**Шаги:**
1. Сгенерировать SSH-ключ для CI: `ssh-keygen -t ed25519 -C "github-actions-aklab"`
2. Добавить публичный ключ на dev-сервер (`~/.ssh/authorized_keys`)
3. Добавить публичный ключ на prod-сервер (`~/.ssh/authorized_keys`)
4. Настроить GitHub Secrets:

| Secret | Dev | Prod |
|--------|-----|------|
| `DEPLOY_HOST` | `192.168.11.151` | `213.184.136.221` |
| `DEPLOY_USER` | `rudin` | `root` |
| `DEPLOY_SSH_KEY` | приватный ключ | приватный ключ |
| `DEPLOY_PORT` | `22` | `5733` |
| `DEPLOY_PATH` | `~/aklab` | `~/aklab` |

5. Настроить GitHub Environment `dev` и `prod` с protection rules (prod требует approval)

---

### Task 2: CI workflow — тесты на PR

**Objective:** Автоматические тесты при PR в `main` и `dev`

**Файл:** `.github/workflows/ci.yml`

```yaml
name: CI — Tests

on:
  pull_request:
    branches: [main, dev]
  push:
    branches: [main, dev]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-and-typecheck:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint --workspaces --if-present
      - run: cd api && npm run type-check 2>/dev/null || true
      - run: cd app && npm run type-check 2>/dev/null || true

  build:
    name: Build Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: cd lib/sqlite-queue && npm run build
      - run: cd services/_shared && npm run build
      - run: cd api && npm run build
      - run: cd app && npm run build

  smoke-on-server:
    name: Smoke Test (dev server)
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - name: Run smoke test on dev server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          port: ${{ secrets.DEPLOY_PORT }}
          script: |
            source ~/.nvm/nvm.sh
            cd ~/aklab
            set -a && source .env && set +a
            npm run smoke:local
```

---

### Task 3: Deploy workflow — dev

**Objective:** Ручной деплой на dev-сервер через GitHub UI

**Файл:** `.github/workflows/deploy-dev.yml`

```yaml
name: Deploy — Dev

on:
  workflow_dispatch:

concurrency:
  group: deploy-dev
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy to Dev
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          port: ${{ secrets.DEPLOY_PORT }}
          command_timeout: 10m
          script: |
            source ~/.nvm/nvm.sh
            cd ~/aklab
            git pull origin dev --ff-only

            # Build shared libs
            cd lib/sqlite-queue && npm run build && cd ../..
            cd services/_shared && npm run build && cd ../..

            # Build API (includes admin panel)
            cd api && npm run build && cd ..

            # Build frontend
            cd app && npm run build && cd ..

            # Restart PM2 services
            pm2 restart aklab-api aklab-app

      - name: Health check
        run: |
          sleep 15
          for i in 1 2 3 4 5; do
            STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 \
              'https://api-aklab-dev.tirobots.ru/_health' 2>/dev/null || echo "000")
            if [ "$STATUS" = "204" ]; then
              echo "✅ Health check passed"
              exit 0
            fi
            echo "⏳ Attempt $i: status=$STATUS, waiting 10s..."
            sleep 10
          done
          echo "❌ Health check failed after 5 attempts"
          exit 1

      - name: Smoke test
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          port: ${{ secrets.DEPLOY_PORT }}
          script: |
            source ~/.nvm/nvm.sh
            cd ~/aklab
            set -a && source .env && set +a
            npm run smoke:local
```

---

### Task 4: Deploy workflow — prod

**Objective:** Ручной деплой на prod через GitHub UI с approval

**Файл:** `.github/workflows/deploy-prod.yml`

```yaml
name: Deploy — Prod

on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type "deploy" to confirm'
        required: true

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  validate:
    name: Validate confirmation
    runs-on: ubuntu-latest
    steps:
      - name: Check confirmation
        run: |
          if [ "${{ inputs.confirm }}" != "deploy" ]; then
            echo "❌ Confirmation must be 'deploy'"
            exit 1
          fi

  deploy:
    name: Deploy to Prod
    runs-on: ubuntu-latest
    needs: validate
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST_PROD }}
          username: ${{ secrets.DEPLOY_USER_PROD }}
          key: ${{ secrets.DEPLOY_SSH_KEY_PROD }}
          port: ${{ secrets.DEPLOY_PORT_PROD }}
          command_timeout: 15m
          script: |
            source ~/.nvm/nvm.sh
            cd ~/aklab
            bash scripts/deploy-prod.sh --ci

      - name: Verify production
        run: |
          sleep 20
          for endpoint in \
            "https://aklab.tirobots.ru/" \
            "https://api-aklab.tirobots.ru/_health" \
            "https://api-aklab.tirobots.ru/admin"; do
            STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "$endpoint" 2>/dev/null || echo "000")
            echo "$endpoint → $STATUS"
            if [ "$STATUS" = "000" ] || [ "$STATUS" = "502" ] || [ "$STATUS" = "503" ]; then
              echo "❌ Production verification failed"
              exit 1
            fi
          done
          echo "✅ Production verification passed"
```

---

### Task 5: Branch protection rules

**Objective:** Настроить защиту веток в GitHub

**Настройки через GitHub UI (Settings → Branches):**

**Ветка `main`:**
- Require pull request before merging (1 approval)
- Require status checks: `lint-and-typecheck`, `build`
- Require branches to be up to date
- Do not allow bypassing the above settings

**Ветка `dev`:**
- Require status checks: `lint-and-typecheck`, `build`
- Allow force pushes (для dev допустимо)

---

### Task 6: Backup перед деплоем

**Objective:** Автоматический бэкап SQLite перед каждым деплоем, с выносом на отдельный носитель

**Текущее состояние:**
- `deploy-prod.sh` делает `sqlite3 .backup api/.tmp/data.db.bak` — но бэкап лежит рядом с БД (один диск)
- Dev-деплой не делает бэкап вообще

**Что сделать:**

1. Добавить бэкап в `deploy-dev.yml` (до build):
```yaml
- name: Backup DB
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.DEPLOY_HOST }}
    ...
    script: |
      cd ~/aklab
      BACKUP_DIR=~/aklab-backups
      mkdir -p $BACKUP_DIR
      TIMESTAMP=$(date +%Y%m%d_%H%M%S)
      sqlite3 api/.tmp/data.db ".backup $BACKUP_DIR/data-${TIMESTAMP}.db"
      # Хранить последние 7 бэкапов
      ls -t $BACKUP_DIR/data-*.db | tail -n +8 | xargs rm -f 2>/dev/null
      echo "✅ Backup: $BACKUP_DIR/data-${TIMESTAMP}.db"
```

2. В `deploy-prod.sh` добавить аналогичный бэкап в `~/aklab-backups/` (сейчас только `.bak` рядом с БД)

3. Опционально: scp бэкап на dev-сервер как off-site (dev = 192.168.11.151, prod = 213.184.136.221):
```bash
scp $BACKUP_DIR/data-${TIMESTAMP}.db rudin@192.168.11.151:~/prod-backups/
```

---

### Task 7: AI-генерация changelog

**Objective:** Заменить словарный `generate-changelog.js` на AI-генерацию через Xiaomi MiMo (как в Samurai)

**Текущее состояние:**
- `scripts/generate-changelog.js` — парсит conventional commits, маппит через словарь TRANSLATIONS
- Словарь не покрывает все термины, английские коммиты без перевода
- Changelog пишется в `app/public/changelog.json`, фронтенд читает `/changelog.json`

**Реализация:** Новый скрипт `scripts/generate-changelog-ai.js`

**API (как в Samurai):**
```
URL:    https://api.xiaomimimo.com/v1/chat/completions (OpenAI-compat)
Auth:   Authorization: Bearer $XIAOMIMIMO_API_KEY
Model:  mimo-v2.5-pro
Format: choices[0].message.content
```

**Env vars в `.env`:**
```
XIAOMIMIMO_API_KEY=sk-***
```

**Логика скрипта:**
```javascript
#!/usr/bin/env node
// scripts/generate-changelog-ai.js
// Usage: node scripts/generate-changelog-ai.js <version>
// Reads git commits between last [release] tag and HEAD
// Sends to Xiaomi MiMo for Russian translation + structuring
// Outputs JSON to stdout (same format as generate-changelog.js)

const { execSync } = require('child_process');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/generate-changelog-ai.js <version>');
  process.exit(1);
}

// 1. Get commits between last two [release] tags
function getCommits() {
  const tags = execSync('git log --oneline --grep="\\[release\\]" --format="%H" -2')
    .toString().trim().split('\n');
  if (tags.length < 2) {
    // No previous release — get all commits since first
    return execSync('git log --oneline --no-merges --format="%s"')
      .toString().trim().split('\n').filter(Boolean);
  }
  return execSync(`git log --oneline --no-merges --format="%s" ${tags[1]}..${tags[0]}`)
    .toString().trim().split('\n').filter(Boolean);
}

// 2. Call Xiaomi MiMo API
async function generateChangelog(commits) {
  const apiKey = process.env.XIAOMIMIMO_API_KEY;
  if (!apiKey) {
    console.error('XIAOMIMIMO_API_KEY not set');
    process.exit(1);
  }

  const prompt = `Ты — технический писатель. Преобразуй список git-коммитов в changelog для пользователей.

Правила:
- Каждый пункт → объект {text, type}
- type: "new" (feat), "fix" (fix), "improvement" (refactor/docs/chore/perf)
- Переводи на русский если на английском
- Убирай префиксы (feat:, fix:, chore:)
- Группируй связанные изменения
- Пропускай release-коммиты и мержи
- Пиши кратко и по делу

Коммиты:
${commits.map(c => '- ' + c).join('\n')}

Ответ — ТОЛЬКО валидный JSON массив:
[{"text": "описание", "type": "new|fix|improvement"}]`;

  const resp = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-pro',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parse JSON (handle markdown fences)
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse AI response:', e.message);
    console.error('Raw:', content);
    // Fallback to old generator
    return null;
  }
}

// 3. Main
async function main() {
  const commits = getCommits();
  if (commits.length === 0) {
    console.log('[]');
    return;
  }

  const items = await generateChangelog(commits);
  if (items) {
    console.log(JSON.stringify(items));
  } else {
    // Fallback to old generator
    const oldGen = execSync(`node scripts/generate-changelog.js ${version}`)
      .toString().trim();
    console.log(oldGen);
  }
}

main();
```

**Интеграция в deploy-prod.sh:**
```bash
# Step 9: Generate changelog — AI first, fallback to rule-based
CHANGELOG_ITEMS=$(node "$PROJECT_ROOT/scripts/generate-changelog-ai.js" "$NEW_VERSION" 2>/tmp/changelog-ai.log || echo '')
if [ -z "$CHANGELOG_ITEMS" ] || [ "$CHANGELOG_ITEMS" = '[]' ]; then
  CHANGELOG_ITEMS=$(node "$PROJECT_ROOT/scripts/generate-changelog.js" "$NEW_VERSION" 2>/tmp/changelog-gen.log || echo '')
fi
```

**Интеграция в deploy-dev workflow:**
```yaml
- name: Generate changelog
  uses: appleboy/ssh-action@v1
  with:
    host: ...
    script: |
      cd ~/aklab
      source ~/.nvm/nvm.sh
      VERSION=$(node -p "require('./package.json').version")
      node scripts/generate-changelog-ai.js "$VERSION" > /tmp/changelog-items.json
```

---

### Task 8: Email-уведомления о деплое

**Objective:** Отправлять email после каждого деплоя (успех/неудача) на `a@rudin.ru`

**Текущее состояние:**
- SMTP настроен: `smtp.yandex.ru:465`, `tirobots@yandex.ru` (пароль в `.env`)
- Получатель в БД: `andrew@7300399.ru` (таблица `setting`, поле `smtp_to`)
- Дайджест уже шлёт через nodemailer — переиспользуем тот же транспорт

**Реализация:** Скрипт `scripts/notify-deploy.sh` (запускается из workflow)

**Получатель:** `a@rudin.ru` (НЕ из БД — захардкодить в скрипте + secret `DEPLOY_NOTIFY_EMAIL`)

```bash
#!/bin/bash
# scripts/notify-deploy.sh
# Usage: ./scripts/notify-deploy.sh <status> <environment> <version> [changelog] [error_message]
# status: success | failure
# environment: dev | prod
# version: v1.0.37
# changelog: path to changelog.md or inline text (optional)
# error_message: optional

STATUS=$1
ENV=$2
VERSION=$3
CHANGELOG_FILE=${4:-""}
ERROR_MSG=${5:-""}
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Email settings from .env
source .env 2>/dev/null

# Read changelog if file provided
CHANGELOG_CONTENT=""
if [ -n "$CHANGELOG_FILE" ] && [ -f "$CHANGELOG_FILE" ]; then
  CHANGELOG_CONTENT=$(cat "$CHANGELOG_FILE" | head -30)
fi

if [ "$STATUS" = "success" ]; then
  SUBJECT="✅ AKLAB $ENV — $VERSION"
  BODY="Деплой $VERSION на $ENV выполнен успешно.\n\nВремя: $TIMESTAMP"
  if [ -n "$CHANGELOG_CONTENT" ]; then
    BODY="$BODY\n\n--- Changelog ---\n$CHANGELOG_CONTENT"
  fi
else
  SUBJECT="❌ AKLAB $ENV FAILED — $VERSION"
  BODY="Деплой $VERSION на $ENV провалился.\n\nВремя: $TIMESTAMP\nОшибка: $ERROR_MSG\n\nТребуется ручное вмешательство."
fi

node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: '${EMAIL_SMTP_HOST:-smtp.yandex.ru}',
  port: ${EMAIL_SMTP_PORT:-465},
  secure: true,
  auth: { user: '${EMAIL_SMTP_USER}', pass: '${EMAIL_SMTP_PASS}' }
});
transporter.sendMail({
  from: '${EMAIL_SMTP_USER}',
  to: '${DEPLOY_NOTIFY_EMAIL:-a@rudin.ru}',
  subject: '$(echo $SUBJECT)',
  text: '$(echo -e $BODY)'
}).then(() => console.log('Email sent')).catch(e => console.error('Email failed:', e.message));
"
```

**Вызов из workflows:**

В `deploy-dev.yml` и `deploy-prod.yml` добавить шаги:

```yaml
- name: Notify success
  if: success()
  uses: appleboy/ssh-action@v1
  with:
    host: ...
    script: |
      cd ~/aklab
      source ~/.nvm/nvm.sh
      CHANGELOG=$(git log --oneline -10 --no-merges)
      bash scripts/notify-deploy.sh success dev $(node -p "require('./package.json').version") "" "$CHANGELOG"

- name: Notify failure
  if: failure()
  uses: appleboy/ssh-action@v1
  with:
    host: ...
    script: |
      cd ~/aklab
      source ~/.nvm/nvm.sh
      bash scripts/notify-deploy.sh failure dev $(node -p "require('./package.json').version") "" "Deploy workflow failed"
```

**Новый secret:** `DEPLOY_NOTIFY_EMAIL` (дефолт: `a@rudin.ru`)

---

### Task 9: Deploy scripts alignment

**Objective:** Убедиться что `deploy-prod.sh` работает с `--ci` флагом

**Проверить:**
- `scripts/deploy-prod.sh` принимает `--ci` (или нет — тогда добавить)
- `--ci` = non-interactive mode (без подтверждений, без Telegram)
- Если не принимает — добавить простой флаг:

```bash
# В начале deploy-prod.sh
CI_MODE=false
for arg in "$@"; do
  case $arg in
    --ci) CI_MODE=true ;;
  esac
done
```

---

## Файлы которые изменятся

| Файл | Действие |
|------|----------|
| `.github/workflows/ci.yml` | Создать |
| `.github/workflows/deploy-dev.yml` | Создать |
| `.github/workflows/deploy-prod.yml` | Создать |
| `scripts/generate-changelog-ai.js` | Создать |
| `scripts/notify-deploy.sh` | Создать |
| `scripts/deploy-prod.sh` | Добавить бэкап в `~/aklab-backups/`, AI changelog, `--ci` |

## Верификация

1. **PR test:** Открыть PR в `dev` → должны запуститься `lint-and-typecheck` + `build`
2. **Deploy dev:** Нажать "Run workflow" на `deploy-dev.yml` → деплой + health check + smoke
3. **Deploy prod:** Нажать "Run workflow" на `deploy-prod.yml` → ввести "deploy" → approval → деплой + verify
4. **Branch protection:** Попробовать push в `main` напрямую → должен быть заблокирован

## Порядок выполнения

1. Task 1 (Secrets) — вручную в GitHub UI + добавить `XIAOMIMIMO_API_KEY` в `.env` на серверах
2. Task 6 (Backup) — добавить бэкап в workflows и deploy-prod.sh
3. Task 7 (AI changelog) — создать `generate-changelog-ai.js`, интегрировать в deploy-prod.sh
4. Task 8 (Email) — создать `notify-deploy.sh`, добавить вызов в workflows
5. Task 9 (deploy script alignment) — проверить/поправить `deploy-prod.sh` (--ci, backup, AI changelog)
6. Task 2 (ci.yml) — создать workflow
7. Task 3 (deploy-dev.yml) — создать workflow (с backup + email + changelog)
8. Task 4 (deploy-prod.yml) — создать workflow (с email, backup + changelog уже в deploy-prod.sh)
9. Task 5 (branch protection) — настроить в GitHub UI
