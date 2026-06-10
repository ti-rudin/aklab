#!/usr/bin/env node

/**
 * Генерация changelog на основе git коммитов между [release] тегами.
 *
 * Использование: node scripts/generate-changelog.js <version>
 * Выход: JSON массив items [{text, type}] в stdout
 *
 * Логика: находит коммиты между последним [release] и предыдущим,
 * конвертирует их в пользовательский формат.
 *
 * Формат коммитов: type(scope): description
 * Типы: feat → new, fix → fix, refactor/docs/chore → improvement
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

/**
 * Получить коммиты между двумя последними [release] коммитами.
 */
function getCommitsSinceLastRelease() {
  try {
    // Найти хеши двух последних release-коммитов
    const releaseHashes = execSync(
      'git log --grep="^\\\\[release\\\\]" -n 2 --format="%H"',
      { encoding: 'utf8' }
    ).trim().split('\n');

    if (releaseHashes.length < 2) {
      // Первый релиз — берём все коммиты до него
      return execSync(
        `git log ${releaseHashes[0]} --oneline --no-merges --format="%s"`,
        { encoding: 'utf8' }
      ).trim();
    }

    // Коммиты между предыдущим и текущим release
    const commits = execSync(
      `git log ${releaseHashes[1]}..${releaseHashes[0]} --oneline --no-merges --format="%s"`,
      { encoding: 'utf8' }
    ).trim();

    return commits;
  } catch {
    try {
      return execSync('git log -10 --format="%s"', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  }
}

/**
 * Конвертировать conventional commit в changelog item
 */
function commitToItem(commitMsg) {
  // Пропускаем release-коммиты
  if (commitMsg.includes('[release]')) return null;

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

  // Не conventional commit — пропускаем (обычно это release-коммиты)
  return null;
}

/**
 * Перевод описания коммита на русский.
 * Сначала проверяем словарь, потом — fallback на capitalizeFirst.
 */
function isRussian(text) {
  return /[а-яА-ЯёЁ]/.test(text);
}

function translateDesc(desc) {
  if (!desc) return desc;

  // Если уже на русском — возвращаем как есть
  if (isRussian(desc)) return capitalizeFirst(desc);

  // Точное совпадение
  const exact = TRANSLATIONS[desc.toLowerCase().trim()];
  if (exact) return exact;

  // Частичное совпадение — ищем ключ как подстроку
  for (const [en, ru] of Object.entries(TRANSLATIONS)) {
    if (desc.toLowerCase().includes(en.toLowerCase())) {
      return ru;
    }
  }

  return capitalizeFirst(desc);
}

// Словарь: английское описание → русское
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
  'fix:': 'Исправлено:',
  'feat:': 'Новая функция:',
  'docs:': 'Документация:',
  'refactor:': 'Рефакторинг:',
};

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function main() {
  const commitsText = getCommitsSinceLastRelease();

  if (!commitsText) {
    process.stdout.write(FALLBACK_ITEMS);
    return;
  }

  const commits = commitsText.split('\n').filter(Boolean);
  const items = commits
    .map(commitToItem)
    .filter(Boolean)
    .slice(0, 5); // Максимум 5 пунктов

  if (items.length === 0) {
    process.stdout.write(FALLBACK_ITEMS);
    return;
  }

  process.stdout.write(JSON.stringify(items));
}

main();
