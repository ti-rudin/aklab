/**
 * Создаёт дефолтную запись Setting (singleton), если её ещё нет.
 *
 * Singleton в Strapi 5 — findOne возвращает null если ничего нет.
 * ДЕФОЛТЫ берутся из schema.json (threshold_percent=20, work_hours_start=9 и т.д.)
 * — но Strapi 5 на create требует явные значения, поэтому дублируем тут.
 */
import type { StrapiInstance } from '../types/strapi';

export async function seedSettings(strapi: StrapiInstance): Promise<void> {
  try {
    // Используем db.query вместо entityService — надёжнее для singleton,
    // entityService.findMany может не находить записи из-за draft/published state
    const existing = await strapi.db.query('api::setting.setting').findOne({});
    if (existing) {
      // Обновляем smtp_to если пустой
      if (!existing.smtp_to) {
        const defaultSmtpTo = process.env.SMTP_TO || 'a@rudin.ru';
        await strapi.db.query('api::setting.setting').update({
          where: { id: existing.id },
          data: { smtp_to: defaultSmtpTo },
        });
        strapi.log.info(`[seed] Setting smtp_to обновлён: ${defaultSmtpTo}`);
      }
      // Обновляем stop_words если пустой — пустой массив (фильтрация по property_type вместо стоп-слов)
      if (!existing.stop_words) {
        await strapi.db.query('api::setting.setting').update({
          where: { id: existing.id },
          data: { stop_words: [] },
        });
        strapi.log.info('[seed] Setting stop_words инициализирован пустым');
      }
      strapi.log.info('[seed] Setting уже существует — skip create');
      return;
    }

    await strapi.entityService.create('api::setting.setting', {
      data: {
        threshold_percent: 20,
        work_hours_start: 9,
        work_hours_end: 21,
        digest_time: '09:00',
        retention_months: 6,
        active_sources: ['fabrikant', 'torgi-gov', 'aggregator-bankrot', 'alfalot', 'etprf', 'sberbank-ast', 'invest-mosreg', 'investmoscow', 'roseltorg', 'm-ets'],
        smtp_to: process.env.SMTP_TO || 'a@rudin.ru',
        monitored_regions: ['moscow', 'mo', 'other'],
        stop_words: [],
      },
    });

    strapi.log.info('[seed] ✅ Setting создан с дефолтами (threshold=20%, digest=09:00)');
  } catch (err: any) {
    strapi.log.error(`[seed] Ошибка создания Setting: ${err.message}`);
    strapi.log.error(err);
  }
}
