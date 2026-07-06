/**
 * Создаёт дефолтные правила фокуса (focus rules), если их ещё нет.
 */
import type { StrapiInstance } from '../types/strapi';

export async function seedFocusRules(strapi: StrapiInstance): Promise<void> {
  const rules = [
    { name: 'Недооценённость −20-30%', condition_type: 'deviation_threshold', condition_value: '-30', score: 30, tag: 'undervalued', priority: 1 },
    { name: 'Недооценённость −30-50%', condition_type: 'deviation_threshold', condition_value: '-50', score: 50, tag: 'undervalued', priority: 2 },
    { name: 'Недооценённость −50%+', condition_type: 'deviation_threshold', condition_value: '-100', score: 70, tag: 'undervalued', priority: 3 },
    { name: 'Торги (минимальная цена)', condition_type: 'has_field', condition_value: 'minimum_price', score: 20, tag: 'has_minimum_price', priority: 4 },
    { name: 'Новый объект', condition_type: 'has_field', condition_value: 'first_seen_at', score: 10, tag: 'new', priority: 5 },
    { name: 'Большая площадь', condition_type: 'custom', condition_value: 'area_sqm > 500', score: 5, tag: 'large_area', priority: 6 },
    { name: 'Москва/МО', condition_type: 'city_match', condition_value: 'moscow,mo', score: 5, tag: 'moscow_mo', priority: 7 },
  ];

  for (const rule of rules) {
    try {
      const existing = await strapi.entityService.findMany('api::focus-rule.focus-rule', {
        filters: { name: rule.name },
        limit: 1,
      });

      if (existing && existing.length > 0) {
        strapi.log.info(`[seed] Focus rule "${rule.name}" уже существует — skip`);
        continue;
      }

      await strapi.entityService.create('api::focus-rule.focus-rule', {
        data: {
          ...rule,
          is_active: true,
          description: null,
        },
      });
      strapi.log.info(`[seed] ✅ Focus rule "${rule.name}" создан`);
    } catch (err: any) {
      strapi.log.error(`[seed] Ошибка создания focus rule "${rule.name}": ${err.message}`);
    }
  }
}
