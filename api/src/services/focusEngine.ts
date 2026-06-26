/**
 * Focus Engine — оценка объектов по правилам (focus rules).
 *
 * scoreProperty(property, rules) → { score, tags, events[] }
 * scoreAllProperties(threshold?) → статистика по всем status='new'
 */

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
        const threshold = -Math.abs(Number(rule.condition_value));
        const deviation = Number(property.deviation_percent);
        if (!isNaN(deviation) && !isNaN(threshold) && deviation <= threshold) {
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
          // Безопасная оценка: fields as variables
          const fields = ['area_sqm', 'price', 'price_per_sqm', 'deviation_percent',
            'focus_score', 'minimum_price', 'property_type', 'city', 'status',
            'auction_type', 'source'];
          const values = fields.map(f => property[f]);
          const fn = new Function(...fields, `return (${rule.condition_value})`);
          if (fn(...values)) {
            matched = true;
          }
        } catch (err: any) {
          // Невалидное выражение — пропускаем
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
 * Оценить все объекты со status='new', опционально с порогом.
 * Возвращает статистику.
 */
export async function scoreAllProperties(threshold?: number): Promise<{
  scored: number;
  in_focus: number;
  by_tag: Record<string, number>;
}> {
  const rules: FocusRule[] = await (strapi as any).entityService.findMany('api::focus-rule.focus-rule', {
    filters: { is_active: true },
    sort: { priority: 'asc' },
    limit: 100,
  });

  if (!rules || rules.length === 0) {
    strapi.log.warn('[focusEngine] No active focus rules found');
    return { scored: 0, in_focus: 0, by_tag: {} };
  }

  const minScore = threshold || 0;

  // Пагинация: обрабатываем батчами
  const BATCH = 200;
  let offset = 0;
  let scored = 0;
  let inFocus = 0;
  const byTag: Record<string, number> = {};

  while (true) {
    const properties = await (strapi as any).db.query('api::property.property').findMany({
      where: { status: 'new' },
      orderBy: { id: 'asc' },
      limit: BATCH,
      offset,
    });

    if (!properties || properties.length === 0) break;

    for (const prop of properties) {
      const result = scoreProperty(prop, rules);

      // Обновляем объект
      await (strapi as any).db.query('api::property.property').update({
        where: { id: prop.id },
        data: {
          focus_score: result.score,
          tags: result.tags,
        },
      });

      // Записываем события
      for (const evt of result.events) {
        await (strapi as any).entityService.create('api::property-event.property-event', {
          data: {
            event_type: evt.event_type,
            old_value: evt.old_value || null,
            new_value: evt.new_value || null,
            property: prop.id,
          },
        });
      }

      scored++;
      if (result.score >= minScore) {
        inFocus++;
      }
      for (const tag of result.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    if (properties.length < BATCH) break;
    offset += BATCH;
  }

  return { scored, in_focus: inFocus, by_tag: byTag };
}
