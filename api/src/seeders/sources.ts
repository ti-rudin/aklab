/**
 * Создаёт дефолтные источники парсинга, если их ещё нет.
 */
import type { StrapiInstance } from '../types/strapi';

export async function seedSources(strapi: StrapiInstance): Promise<void> {
  const defaults = [
    {
      name: 'Фабрикант',
      slug: 'fabrikant',
      url: 'https://www.fabrikant.ru/procedure/search/sales',
      parser: 'fabrikant' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 3 * * *',
      health_port: 1345,
    },
    {
      name: 'Федресурс',
      slug: 'fedresurs',
      url: 'https://bankrot.fedresurs.ru',
      parser: 'fedresurs' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: false, // Qrator 403 — отложен
      schedule: '0 3 * * *',
      health_port: 1347,
    },
    {
      name: 'ГИС Торги',
      slug: 'torgi-gov',
      url: 'https://torgi.gov.ru/new/public/lots/reg',
      parser: 'torgi-gov' as const,
      auction_type: 'privatization' as const,
      region: 'Москва и МО',
      is_active: true,
      schedule: '0 3 * * *',
      health_port: 1346,
    },
    {
      name: 'Агрегатор банкрот',
      slug: 'aggregator-bankrot',
      url: 'https://xn----etbpba5admdlad.xn--p1ai',
      parser: 'aggregator-bankrot' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 4 * * *',
      health_port: 1348,
    },
    {
      name: 'Alfalot',
      slug: 'alfalot',
      url: 'https://ecosystem.alfalot.ru/showcase/list?categories=1',
      parser: 'alfalot' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 4 * * *',
      health_port: 1349,
    },
    {
      name: 'ЕТП РФ',
      slug: 'etprf',
      url: 'https://sale.etprf.ru/Notification',
      parser: 'etprf' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1350,
    },
    {
      name: 'Сбербанк-АСТ',
      slug: 'sberbank-ast',
      url: 'https://utp.sberbank-ast.ru/Property/List/BidListComReal',
      parser: 'sberbank-ast' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1351,
    },
    {
      name: 'Инвест МО',
      slug: 'invest-mosreg',
      url: 'https://invest.mosreg.ru',
      parser: 'invest-mosreg' as const,
      auction_type: 'marketplace' as const,
      region: 'Московская область',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1352,
    },
    {
      name: 'Инвест Москва',
      slug: 'investmoscow',
      url: 'https://investmoscow.ru',
      parser: 'investmoscow' as const,
      auction_type: 'marketplace' as const,
      region: 'Москва',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1353,
    },
    {
      name: 'Росэлторг',
      slug: 'roseltorg',
      url: 'https://roseltorg.ru',
      parser: 'roseltorg' as const,
      auction_type: 'marketplace' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 6 * * *',
      health_port: 1354,
    },
    {
      name: 'М-ЕТС',
      slug: 'm-ets',
      url: 'https://m-ets.ru',
      parser: 'm-ets' as const,
      auction_type: 'marketplace' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 6 * * *',
      health_port: 1355,
    },
  ];

  for (const src of defaults) {
    try {
      const existing = await strapi.entityService.findMany('api::source.source', {
        filters: { slug: src.slug },
        limit: 1,
      });

      if (existing && existing.length > 0) {
        strapi.log.info(`[seed] Source "${src.name}" уже существует — skip`);
        continue;
      }

      await strapi.entityService.create('api::source.source', { data: src });
      strapi.log.info(`[seed] ✅ Source "${src.name}" создан`);
    } catch (err: any) {
      strapi.log.error(`[seed] Ошибка создания source "${src.name}": ${err.message}`);
    }
  }
}
