#!/usr/bin/env node

/**
 * Генерация changelog на основе git коммитов и PR-описаний.
 *
 * Usage: node scripts/generate-changelog.js <version>
 * Выход: JSON массив items [{text, type}] в stdout
 *
 * Источники:
 * 1. PR-описания (gh pr view для мерж-коммитов)
 * 2. Commit bodies (%B — полное описание коммита)
 * 3. Commit subjects (%s — заголовок)
 */

const { execSync } = require('child_process');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/generate-changelog.js <version>');
  process.exit(1);
}

const FALLBACK_ITEMS = JSON.stringify([
  { text: 'Улучшения стабильности и производительности', type: 'improvement' }
]);

const MAX_ITEMS = 10;

/**
 * Получить хеши двух последних [release] коммитов.
 */
function getReleaseHashes() {
  try {
    const log = execSync(
      'git log --grep="^\\\\\\\\[release\\\\\\\\]" -n 2 --format="%H"',
      { encoding: 'utf8' }
    ).trim();
    return log.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Получить коммиты между двумя релизами (subject + body).
 */
function getCommitsBetweenReleases() {
  const hashes = getReleaseHashes();
  if (hashes.length < 2) {
    // Первый рилиз — берём последние 30 коммитов
    try {
      return execSync(
        'git log --no-merges --format="%s%n%b%n---COMMIT_END---" -30',
        { encoding: 'utf8' }
      ).trim();
    } catch {
      return '';
    }
  }

  try {
    return execSync(
      `git log ${hashes[1]}..${hashes[0]} --no-merges --format="%s%n%b%n---COMMIT_END---"`,
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Получить PR-описания для мерж-коммитов между релизами.
 */
function getPRDescriptions() {
  const hashes = getReleaseHashes();
  if (hashes.length < 2) return [];

  try {
    // Найти мерж-коммиты (Merge pull request #N)
    const mergeLog = execSync(
      `git log ${hashes[1]}..${hashes[0]} --merges --format="%s" 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!mergeLog) return [];

    const prNumbers = [];
    for (const line of mergeLog.split('\n')) {
      const match = line.match(/Merge pull request #(\d+)/);
      if (match) prNumbers.push(match[1]);
    }

    if (prNumbers.length === 0) return [];

    // Получить описания PR через gh
    const descriptions = [];
    for (const prNum of prNumbers.slice(0, 5)) {
      try {
        const prBody = execSync(
          `gh pr view ${prNum} --json body,title --jq '.title + "\\n" + (.body // "")' 2>/dev/null`,
          { encoding: 'utf8', timeout: 10000 }
        ).trim();
        if (prBody && prBody.length > 20) {
          descriptions.push(prBody);
        }
      } catch {
        // gh может не быть на CI или PR не найден
      }
    }

    return descriptions;
  } catch {
    return [];
  }
}

/**
 * Конвертировать conventional commit в changelog item
 */
function commitToItem(commitMsg) {
  if (!commitMsg || commitMsg.includes('[release]') || commitMsg.length < 10) return null;

  // Парсим conventional commit: type(scope): description
  const match = commitMsg.match(/^(feat|fix|refactor|chore|docs|style|perf|test|deploy)(?:\(.+?\))?!?:\s*(.+)/i);
  if (match) {
    const type = match[1].toLowerCase();
    const desc = match[2].trim();

    let itemType;
    switch (type) {
      case 'feat': itemType = 'new'; break;
      case 'fix': itemType = 'fix'; break;
      default: itemType = 'improvement'; break;
    }

    return { text: translateDesc(desc), type: itemType };
  }

  return null;
}

/**
 * Извлечь пункты из PR-описания.
 * Ищем markdown списки (- или *) и заголовки (##).
 */
function extractItemsFromPR(prText) {
  const items = [];
  const lines = prText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Markdown list items: "- description" or "* description"
    const listMatch = trimmed.match(/^[-*]\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)/);
    if (listMatch) {
      const text = translateDesc(listMatch[2].trim());
      if (text.length > 10 && text.length < 200) {
        items.push({ text, type: guessTypeFromText(text) });
        continue;
      }
    }

    // Simpler list items: "- description"
    const simpleListMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (simpleListMatch) {
      const text = translateDesc(simpleListMatch[1].trim());
      if (text.length > 15 && text.length < 200 && !text.startsWith('#')) {
        items.push({ text, type: guessTypeFromText(text) });
      }
    }
  }

  return items;
}

/**
 * Угадать тип по тексту описания.
 */
function guessTypeFromText(text) {
  const lower = text.toLowerCase();
  if (/исправлен|фикс|fix|баг|ошибк|пофиксен/.test(lower)) return 'fix';
  if (/добавлен|нов|создан|реализован|feat/.test(lower)) return 'new';
  return 'improvement';
}

/**
 * Перевод описания коммита на русский.
 */
function isRussian(text) {
  return /[а-яА-ЯёЁ]/.test(text);
}

function translateDesc(desc) {
  if (!desc) return desc;
  if (isRussian(desc)) return capitalizeFirst(desc);

  const exact = TRANSLATIONS[desc.toLowerCase().trim()];
  if (exact) return exact;

  for (const [en, ru] of Object.entries(TRANSLATIONS)) {
    if (desc.toLowerCase().includes(en.toLowerCase())) {
      return ru;
    }
  }

  return capitalizeFirst(desc);
}

const TRANSLATIONS = {
  'sources microservices': 'Микросервисы парсеров',
  'health badges': 'Health badges на странице Источники',
  'per-source cron schedule': 'Per-source расписание парсинга',
  'update compact-doc': 'Обновление документации',
  'update plan2.md': 'Обновление плана',
  'describecron ts strict': 'Исправление TypeScript в describeCron',
  'sourcelistview sort=createdat': 'Исправление сортировки источников',
  'deploy-prod.sh check node_modules': 'Проверка node_modules в скрипте деплоя',
  'deploy-prod.sh copy changelog': 'Changelog копируется в dist после генерации',
  'source routes': 'Маршруты источников',
  'createrouter': 'Восстановление CRUD маршрутов',
  'auth: false': 'Публичный health endpoint',
  'changelog page': 'Страница changelog',
  'auto-generation': 'Автогенерация changelog',
  'inline-редактирование расписания': 'Inline-редактирование расписания',
  'docs/adding-source.md': 'Документация: инструкция добавления источника',
  'documentation page': 'Страница документации',
  'manual pipeline': 'Ручной запуск пайплайна',
  'queue polling': 'Поллинг очередей задач',
  'footer links': 'Ссылки в футере',
  'column sorting': 'Сортировка колонок',
  'monitored regions': 'Мониторинг регионов',
  'region filtering': 'Фильтрация по регионам',
  'alfalot area extraction': 'Извлечение площади в alfalot',
  'title-first priority': 'Приоритет заголовка при извлечении площади',
  'test user': 'Тестовый пользователь',
  'deploy script': 'Скрипт деплоя',
  'deploy-prod.sh': 'Скрипт деплоя на продакшен',
  'strapi 5': 'Strapi 5',
  'singleton': 'Singleton',
  'setting schema': 'Схема настроек',
  'm-ets': 'М-ЕТС',
  'roseltorg': 'Росэлторг',
  'invest-mosreg': 'Инвест МО',
  'investmoscow': 'Инвест Москва',
  'fabrikant': 'Фабрикант',
  'aggregator-bankrot': 'Агрегатор банкротств',
  'sberbank-ast': 'Сбербанк-АСТ',
  'etprf': 'ЕТП РФ',
  'torgi-gov': 'ГИС Торги',
  'property': 'объект',
  'properties': 'объекты',
  'parser': 'парсер',
  'parsers': 'парсеры',
  'analyzer': 'анализатор',
  'digest': 'дайджест',
  'price': 'цена',
  'area': 'площадь',
  'frontend': 'фронтенд',
  'backend': 'бэкенд',
  'anti-ban': 'антибан',
  'smart stop': 'умная остановка парсинга',
  'depth': 'глубина парсинга',
  'parse-handler': 'обработчик парсинга',
  'stealth': 'стелс-режим',
  'random delay': 'рандомная задержка',
  'ua rotation': 'ротация User-Agent',
  'retry': 'повторные попытки',
  'fix:': 'Исправлено:',
  'feat:': 'Новая функция:',
  'docs:': 'Документация:',
  'refactor:': 'Рефакторинг:',
};

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.text.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  const allItems = [];

  // 1. Коммиты (subject + body)
  const commitsText = getCommitsBetweenReleases();
  if (commitsText) {
    const lines = commitsText.split('\n');
    let currentSubject = '';

    for (const line of lines) {
      if (line === '---COMMIT_END---') {
        currentSubject = '';
        continue;
      }

      if (!currentSubject && line.trim()) {
        // Это subject
        currentSubject = line.trim();
        const item = commitToItem(currentSubject);
        if (item) allItems.push(item);
      }
      // Body игнорируем для коммитов (слишком технический)
    }
  }

  // 2. PR-описания (более содержательные)
  const prDescriptions = getPRDescriptions();
  for (const prText of prDescriptions) {
    const prItems = extractItemsFromPR(prText);
    allItems.push(...prItems);
  }

  // 3. Дедупликация и лимит
  const unique = deduplicate(allItems).slice(0, MAX_ITEMS);

  if (unique.length === 0) {
    process.stdout.write(FALLBACK_ITEMS);
    return;
  }

  process.stdout.write(JSON.stringify(unique));
}

main();
