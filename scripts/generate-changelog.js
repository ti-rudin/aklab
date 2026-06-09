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

    // Конвертируем в пользовательский формат
    return { text: capitalizeFirst(desc), type: itemType };
  }

  // Не conventional commit — всё равно добавляем
  return { text: capitalizeFirst(commitMsg), type: 'improvement' };
}

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
