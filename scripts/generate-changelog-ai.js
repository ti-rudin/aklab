#!/usr/bin/env node

/**
 * AI-генерация changelog через Xiaomi MiMo (OpenAI-compat API).
 *
 * Usage: node scripts/generate-changelog-ai.js <version>
 * Выход: JSON массив items [{text, type}] в stdout
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

function getCommits() {
  try {
    const log = execSync('git log --oneline --grep="\\[release\\]" --format="%H" -2', {
      encoding: 'utf-8',
    }).trim();
    const tags = log.split('\n').filter(Boolean);

    if (tags.length < 2) {
      return execSync('git log --oneline --no-merges --format="%s" -30', {
        encoding: 'utf-8',
      }).trim().split('\n').filter(Boolean);
    }

    return execSync(`git log --oneline --no-merges --format="%s" ${tags[1]}..${tags[0]}`, {
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);
  } catch (e) {
    console.error('Failed to get commits:', e.message);
    return [];
  }
}

// --- 2. Вызвать Xiaomi MiMo API ---

async function generateChangelog(commits) {
  const apiKey = process.env.XIAOMIMIMO_API_KEY;
  if (!apiKey) {
    console.error('XIAOMIMIMO_API_KEY not set — skipping AI generation');
    return null;
  }

  const prompt = `Ты — технический писатель. Преобразуй список git-коммитов в changelog для пользователей.

Правила:
- Каждый пункт → объект {text, type}
- type: "new" (feat), "fix" (fix), "improvement" (refactor/docs/chore/perf)
- Переводи на русский если на английском
- Убирай префиксы (feat:, fix:, chore:)
- Группируй связанные изменения если нужно
- Пропускай release-коммиты и мержи
- Пиши кратко и по делу, для конечного пользователя

Коммиты:
${commits.map(c => '- ' + c).join('\n')}

Ответ — ТОЛЬКО валидный JSON массив без пояснений:
[{"text": "описание изменения", "type": "new|fix|improvement"}]`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`AI API error: ${resp.status} ${resp.statusText}`);
      return null;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';

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

    // Валидация структуры
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

  if (commits.length === 0) {
    console.log('[]');
    return;
  }

  // Пробуем AI
  const aiItems = await generateChangelog(commits);

  if (aiItems && aiItems.length > 0) {
    console.log(JSON.stringify(aiItems));
    return;
  }

  // Fallback
  console.log(fallbackGenerate());
}

main();
