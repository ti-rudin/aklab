/**
 * Focus Engine — оценка объектов по правилам (focus rules).
 *
 * scoreProperty(property, rules) → { score, tags, events[] }
 * scoreAllProperties(threshold?) → статистика по всем status='new'
 * scorePropertiesBatch(options?) → scoreAllProperties + фильтры (city/price)
 */

import type { StrapiInstance } from '../types/strapi';

interface FocusRule {
  id: number;
  name: string;
  condition_type: 'deviation_threshold' | 'has_field' | 'city_match' | 'custom';
  condition_value: string | null;
  score: number;
  tag: string;
  is_active: boolean;
  priority: number;
}

interface ScoreResult {
  score: number;
  tags: string[];
  events: Array<{ event_type: string; old_value?: string; new_value?: string }>;
}

/**
 * Безопасная оценка выражений через recursive-descent парсер.
 * Поддерживает: +, -, *, /, %, >, <, >=, <=, ==, !=, &&, ||, скобки.
 * Использует ТОЛЬКО whitelist-переменные. НЕ использует eval()/new Function().
 */
function safeEval(expression: string, vars: Record<string, number>): boolean {
  const allowedVars = new Set(Object.keys(vars));
  let pos = 0;
  const src = expression.trim();

  function peek(): string { return src[pos] ?? ''; }
  function consume(ch: string): void {
    if (src[pos] !== ch) throw new Error(`Expected '${ch}' at pos ${pos}`);
    pos++;
  }
  function skipWs(): void { while (pos < src.length && src[pos] === ' ') pos++; }

  // Токенизация: числа (включая десятичные и отрицательные), переменные, операторы
  function parseNumber(): number {
    skipWs();
    let start = pos;
    if (peek() === '-') { pos++; }
    while (pos < src.length && (src[pos] >= '0' && src[pos] <= '9' || src[pos] === '.')) pos++;
    if (pos === start || (pos === start + 1 && src[start] === '-'))
      throw new Error(`Expected number at pos ${start}`);
    return parseFloat(src.slice(start, pos));
  }

  function parseVariable(): number {
    skipWs();
    let start = pos;
    while (pos < src.length && (/[a-zA-Z_]/.test(src[pos]))) pos++;
    const name = src.slice(start, pos);
    if (!allowedVars.has(name)) throw new Error(`Unknown variable '${name}'`);
    const val = vars[name];
    return typeof val === 'number' ? val : (parseFloat(val as any) || 0);
  }

  // primary → NUMBER | VARIABLE | '(' expression ')'
  function primary(): number {
    skipWs();
    if (peek() === '(') {
      consume('(');
      const val = expression_();
      consume(')');
      return val;
    }
    // Определяем: число (цифра или минус перед цифрой) или переменная (буква)
    const ch = peek();
    if ((ch >= '0' && ch <= '9') || (ch === '-' && pos + 1 < src.length && src[pos + 1] >= '0' && src[pos + 1] <= '9')) {
      return parseNumber();
    }
    if (/[a-zA-Z_]/.test(ch)) {
      return parseVariable();
    }
    throw new Error(`Unexpected character '${ch}' at pos ${pos}`);
  }

  // multiplicative → unary (('*' | '/' | '%') unary)*
  function multiplicative(): number {
    skipWs();
    let left = primary();
    skipWs();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = peek(); pos++;
      const right = primary();
      if (op === '*') left *= right;
      else if (op === '/') left /= right;
      else left %= right;
      skipWs();
    }
    return left;
  }

  // additive → multiplicative (('+' | '-') multiplicative)*
  function additive(): number {
    skipWs();
    let left = multiplicative();
    skipWs();
    while (peek() === '+' || peek() === '-') {
      const op = peek(); pos++;
      const right = multiplicative();
      left = op === '+' ? left + right : left - right;
      skipWs();
    }
    return left;
  }

  // comparison → additive (('>' | '<' | '>=' | '<=' | '==' | '!=') additive)?
  function comparison(): number {
    skipWs();
    const left = additive();
    skipWs();
    // Проверяем двухсимвольные операторы
    if (pos + 1 < src.length) {
      const two = src[pos] + src[pos + 1];
      if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
        pos += 2;
        const right = additive();
        switch (two) {
          case '>=': return left >= right ? 1 : 0;
          case '<=': return left <= right ? 1 : 0;
          case '==': return left === right ? 1 : 0;
          case '!=': return left !== right ? 1 : 0;
        }
      }
    }
    if (peek() === '>' || peek() === '<') {
      const op = peek(); pos++;
      const right = additive();
      return op === '>' ? (left > right ? 1 : 0) : (left < right ? 1 : 0);
    }
    return left;
  }

  // logicalAnd → comparison ('&&' comparison)*
  function logicalAnd(): number {
    skipWs();
    let left = comparison();
    skipWs();
    while (pos + 1 < src.length && src[pos] === '&' && src[pos + 1] === '&') {
      pos += 2;
      const right = comparison();
      left = (left !== 0 && right !== 0) ? 1 : 0;
      skipWs();
    }
    return left;
  }

  // logicalOr → logicalAnd ('||' logicalAnd)*
  function logicalOr(): number {
    skipWs();
    let left = logicalAnd();
    skipWs();
    while (pos + 1 < src.length && src[pos] === '|' && src[pos + 1] === '|') {
      pos += 2;
      const right = logicalAnd();
      left = (left !== 0 || right !== 0) ? 1 : 0;
      skipWs();
    }
    return left;
  }

  // expression → logicalOr
  function expression_(): number {
    return logicalOr();
  }

  const result = expression_();
  skipWs();
  if (pos < src.length) {
    throw new Error(`Unexpected trailing characters at pos ${pos}: '${src.slice(pos)}'`);
  }
  return result !== 0;
}

/**
 * Оценить один объект по набору правил.
 */
export function scoreProperty(property: any, rules: FocusRule[]): ScoreResult {
  let score = 0;
  const tags: string[] = [];
  const events: ScoreResult['events'] = [];

  // Сортируем правила по приоритету (ascending — 1 = highest priority)
  const sorted = [...rules].filter(r => r.is_active).sort((a, b) => a.priority - b.priority);

  // Для deviation_threshold: собираем все matching, берём только с наивысшим приоритетом
  const matchingDeviation: FocusRule[] = [];

  for (const rule of sorted) {
    let matched = false;

    switch (rule.condition_type) {
      case 'deviation_threshold': {
        const threshold = Math.abs(Number(rule.condition_value));
        const deviation = Number(property.deviation_percent);
        if (!isNaN(deviation) && !isNaN(threshold) && deviation >= threshold) {
          matched = true;
          matchingDeviation.push(rule);
        }
        break;
      }

      case 'has_field': {
        const field = rule.condition_value as string;
        const value = property[field];

        if (field === 'first_seen_at') {
          // Специальный случай: только если в последние 24 часа
          if (value) {
            const firstSeen = new Date(value).getTime();
            const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
            if (firstSeen >= dayAgo) {
              matched = true;
            }
          }
        } else if (value != null && value !== undefined && value !== 0 && value !== '') {
          matched = true;
        }
        break;
      }

      case 'city_match': {
        const cities = (rule.condition_value || '').split(',').map(c => c.trim());
        if (property.city && cities.includes(property.city)) {
          matched = true;
        }
        break;
      }

      case 'custom': {
        try {
          const vars: Record<string, any> = {
            area_sqm: property.area_sqm,
            price: property.price,
            price_per_sqm: property.price_per_sqm,
            deviation_percent: property.deviation_percent,
            focus_score: property.focus_score,
            minimum_price: property.minimum_price,
          };
          if (safeEval(rule.condition_value || '', vars)) {
            matched = true;
          }
        } catch (err: any) {
          strapi.log.warn(`[focusEngine] custom rule '${rule.name}' eval error: ${err.message}`);
        }
        break;
      }
    }

    // deviation_threshold обрабатываем отдельно — только лучший match
    if (rule.condition_type !== 'deviation_threshold' && matched) {
      score += rule.score;
      if (!tags.includes(rule.tag)) {
        tags.push(rule.tag);
      }
    }
  }

  // deviation_threshold: берём только правило с наивысшим приоритетом (max priority number)
  if (matchingDeviation.length > 0) {
    // Наивысший приоритет = наибольший номер приоритета
    const best = matchingDeviation.reduce((a, b) =>
      a.priority > b.priority ? a : b
    );
    score += best.score;
    if (!tags.includes(best.tag)) {
      tags.push(best.tag);
    }
  }

  // Формируем события при изменении
  const oldScore = property.focus_score || 0;
  const oldTags: string[] = Array.isArray(property.tags) ? property.tags : [];

  const tagsChanged = JSON.stringify([...oldTags].sort()) !== JSON.stringify([...tags].sort());

  if (score !== oldScore) {
    events.push({
      event_type: 'score_changed',
      old_value: String(oldScore),
      new_value: String(score),
    });
  }

  if (tagsChanged) {
    // Событие для каждого нового тега
    const newTags = tags.filter(t => !oldTags.includes(t));
    for (const tag of newTags) {
      events.push({
        event_type: 'entered_focus',
        new_value: tag,
      });
    }
    // Событие для каждого убранного тега
    const removedTags = oldTags.filter(t => !tags.includes(t));
    for (const tag of removedTags) {
      events.push({
        event_type: 'left_focus',
        old_value: tag,
      });
    }
  }

  return { score, tags, events };
}

/**
 * Оценить все объекты со status='new', опционально с фильтрами.
 * Объединяет логику scoreAllProperties + фильтры из cron controller.
 */
export async function scorePropertiesBatch(options?: {
  city?: string[];
  priceFrom?: number;
  priceTo?: number;
  threshold?: number;
}): Promise<{ scored: number; in_focus: number; by_tag: Record<string, number> }> {
  const s = strapi as unknown as StrapiInstance;

  const rules: FocusRule[] = await s.entityService.findMany('api::focus-rule.focus-rule', {
    filters: { is_active: true },
    sort: { priority: 'asc' },
    limit: 100,
  });

  if (!rules || rules.length === 0) {
    strapi.log.warn('[focusEngine] No active focus rules found');
    return { scored: 0, in_focus: 0, by_tag: {} };
  }

  const minScore = options?.threshold || 0;

  // Строим WHERE с опциональными фильтрами
  const where: any = { status: 'new' };
  if (options?.city && Array.isArray(options.city) && options.city.length > 0) {
    where.city = { $in: options.city };
  }
  if (options?.priceFrom != null && !isNaN(options.priceFrom)) {
    where.price = { ...(where.price || {}), $gte: options.priceFrom };
  }
  if (options?.priceTo != null && !isNaN(options.priceTo)) {
    where.price = { ...(where.price || {}), $lte: options.priceTo };
  }

  // Пагинация: обрабатываем батчами
  const BATCH = 200;
  let offset = 0;
  let scored = 0;
  let inFocus = 0;
  const byTag: Record<string, number> = {};

  while (true) {
    const properties = await s.db.query('api::property.property').findMany({
      where,
      orderBy: { id: 'asc' },
      limit: BATCH,
      offset,
    });

    if (!properties || properties.length === 0) break;

    // Fetch current state to detect unchanged scores/tags
    const propIds = properties.map(p => p.id);
    const currentProps = await s.db.query('api::property.property').findMany({
      where: { id: { $in: propIds } },
      select: ['id', 'focus_score', 'tags'],
    });
    const currentMap = new Map(currentProps.map((p: any) => [p.id, p]));

    // Собираем все updates и events в массивы
    const updates: Array<{ id: number; score: number; tags: string[] }> = [];
    const allEvents: Array<{ event_type: string; old_value?: string; new_value?: string; property_id: number }> = [];

    for (const prop of properties) {
      const result = scoreProperty(prop, rules);

      updates.push({ id: prop.id, score: result.score, tags: result.tags });

      // Only add events if the score actually changed
      const current = currentMap.get(prop.id);
      if (current && current.focus_score !== result.score) {
        for (const evt of result.events) {
          allEvents.push({
            event_type: evt.event_type,
            old_value: evt.old_value || undefined,
            new_value: evt.new_value || undefined,
            property_id: prop.id,
          });
        }
      }

      scored++;
      if (result.score >= minScore) {
        inFocus++;
      }
      for (const tag of result.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    // Batch update focus_score + tags in a single transaction
    if (updates.length > 0) {
      await s.db.transaction(async () => {
        for (const u of updates) {
          await s.db.query('api::property.property').update({
            where: { id: u.id },
            data: { focus_score: u.score, tags: JSON.stringify(u.tags) },
          });
        }
      });
    }

    // Batch insert events in a single transaction
    if (allEvents.length > 0) {
      await s.db.transaction(async () => {
        for (const evt of allEvents) {
          await s.entityService.create('api::property-event.property-event', {
            data: {
              event_type: evt.event_type,
              old_value: evt.old_value || null,
              new_value: evt.new_value || null,
              property: evt.property_id,
            },
          });
        }
      });
    }

    if (properties.length < BATCH) break;
    offset += BATCH;
  }

  return { scored, in_focus: inFocus, by_tag: byTag };
}

/**
 * Обёртка для обратной совместимости — scoreAllProperties(threshold).
 */
export async function scoreAllProperties(threshold?: number) {
  return scorePropertiesBatch({ threshold });
}
