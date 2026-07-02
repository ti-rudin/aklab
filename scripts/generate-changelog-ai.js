#!/usr/bin/env node

/**
 * AI-генерация changelog через Xiaomi MiMo (Anthropic messages API).
 *
 * Usage: node scripts/generate-changelog-ai.js <version>
 * Выход: JSON массив items [{text, type}] в stdout
 *
 * Источники для AI:
 * 1. Git коммиты между [release] тегами
 * 2. PR-описания (gh pr view для мерж-коммитов)
 *
 * Fallback: если AI не ответил — запускает generate-changelog.js
 */

const { execSync } = require('child_process');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/generate-changelog-ai.js <version>');
  process.exit(1);
}

// --- 1. Получить коммиты между последними [release] тегами ---

function getReleaseHashes() {
  try {
    const log = execSync('git log --grep="^\\\\\\\\[release\\\\\\\\]" -n 2 --format="%H"', {
      encoding: 'utf-8',
    }).trim();
    return log.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getCommits() {
  const tags = getReleaseHashes();

  if (tags.length < 2) {
    return execSync('git log --oneline --no-merges --format="%s" -30', {
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);
  }

  return execSync(`git log --no-merges --format="%s" ${tags[1]}..${tags[0]}`, {
    encoding: 'utf-8',
  }).trim().split('\n').filter(Boolean);
}

// --- 1b. Получить PR-описания ---

function getPRDescriptions() {
  const tags = getReleaseHashes();
  if (tags.length < 2) return [];

  try {
    const mergeLog = execSync(
      `git log ${tags[1]}..${tags[0]} --merges --format="%s" 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!mergeLog) return [];

    const descriptions = [];
    for (const line of mergeLog.split('\n')) {
      const match = line.match(/Merge pull request #(\d+)/);
      if (!match) continue;

      try {
        const prBody = execSync(
          `gh pr view ${match[1]} --json body,title --jq '.title + "\\n" + (.body // "")' 2>/dev/null`,
          { encoding: 'utf8', timeout: 10000 }
        ).trim();
        if (prBody && prBody.length > 20) {
          descriptions.push(`PR #${match[1]}:\n${prBody}`);
        }
      } catch {
        // gh не доступен или PR не найден
      }
    }

    return descriptions;
  } catch {
    return [];
  }
}

// --- 2. Вызвать Xiaomi MiMo API (Anthropic messages format) ---

async function generateChangelog(commits, prDescriptions) {
  const apiKey = process.env.XIAOMIMIMO_API_KEY;
  if (!apiKey) {
    console.error('XIAOMIMIMO_API_KEY not set — skipping AI generation');
    return null;
  }

  let prompt = `Ты — технический писатель. Преобразуй данные о релизе в changelog для конечных пользователей.

Правила:
- Каждый пункт → объект {text, type}
- type: "new" (новый функционал), "fix" (исправления), "improvement" (улучшения)
- Пиши на русском, кратко и по делу
- Убирай технические детали (ветки, коммиты, CI/CD)
- Группируй связанные изменения
- Пропускай release-коммиты, bump version, обновление документации
- Минимум 3 пункта, максимум 10

`;

  if (commits.length > 0) {
    prompt += `Git коммиты:\n${commits.map(c => '- ' + c).join('\n')}\n\n`;
  }

  if (prDescriptions.length > 0) {
    prompt += `Описания PR (более подробные):\n${prDescriptions.join('\n\n')}\n\n`;
  }

  prompt += `Ответ — ТОЛЬКО валидный JSON массив без пояснений:\n[{"text": "описание изменения", "type": "new|fix|improvement"}]`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch('https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'mimo-v2.5-pro',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      console.error(`AI API error: ${resp.status} ${resp.statusText} — ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await resp.json();
    // Anthropic format: content может содержать thinking + text блоки
    const textBlock = data.content?.find((b) => b.type === 'text');
    const content = textBlock?.text || '';

    if (!content) {
      console.error('AI returned empty response');
      return null;
    }

    // Парсинг JSON (учитываем markdown fences)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').trim();
    }

    const items = JSON.parse(jsonStr);

    if (!Array.isArray(items)) {
      console.error('AI response is not an array');
      return null;
    }

    for (const item of items) {
      if (!item.text || !['new', 'fix', 'improvement'].includes(item.type)) {
        console.error('Invalid item:', JSON.stringify(item));
        return null;
      }
    }

    return items;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('AI API timeout (30s)');
    } else {
      console.error('AI generation failed:', e.message);
    }
    return null;
  }
}

// --- 3. Fallback на rule-based генератор ---

function fallbackGenerate() {
  try {
    const oldGen = execSync(`node ${path.join(__dirname, 'generate-changelog.js')} ${version}`, {
      encoding: 'utf-8',
    }).trim();
    return oldGen;
  } catch (e) {
    console.error('Fallback generator failed:', e.message);
    return '[]';
  }
}

// --- 4. Main ---

async function main() {
  const commits = getCommits();
  const prDescriptions = getPRDescriptions();

  if (commits.length === 0 && prDescriptions.length === 0) {
    console.log('[]');
    return;
  }

  // Пробуем AI (с PR-описаниями)
  const aiItems = await generateChangelog(commits, prDescriptions);

  if (aiItems && aiItems.length >= 3) {
    console.log(JSON.stringify(aiItems));
    return;
  }

  // AI дал мало пунктов — пробуем fallback
  if (aiItems && aiItems.length > 0 && aiItems.length < 3) {
    console.error(`AI returned only ${aiItems.length} items — merging with fallback`);
    try {
      const fallbackItems = JSON.parse(fallbackGenerate());
      // Объединяем: AI-пункты первыми, потом fallback (дедупликация по text)
      const seen = new Set(aiItems.map(i => i.text.toLowerCase().slice(0, 50)));
      const merged = [...aiItems];
      for (const item of fallbackItems) {
        const key = item.text.toLowerCase().slice(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
      console.log(JSON.stringify(merged.slice(0, 10)));
      return;
    } catch {
      // Fallback тоже сломался — возвращаем что есть от AI
      console.log(JSON.stringify(aiItems));
      return;
    }
  }

  // Fallback
  console.log(fallbackGenerate());
}

main();
