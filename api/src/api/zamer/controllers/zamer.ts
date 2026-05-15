import { factories } from '@strapi/strapi';

/** Whitelist полей, разрешённых для create/update замера (C1/C2 fix) */
const ALLOWED_FIELDS = [
  'name', 'industry', 'staffTotal', 'companyUsers', 'branchesCount',
  'annualRevenueRub', 'itCapexMlnRub', 'itOpexMlnRub', 'itFotMlnRub',
  'itStaffTotal', 'itDependencyPct', 'ceoCfoKpiAvailability',
  'itMgmtPct', 'itOpsPct', 'itSupportPct', 'itDevPct', 'factors',
] as const;

/** Whitelist полей профиля, разрешённых в calculate endpoint (C1/C2 fix) */
const ALLOWED_PROFILE_FIELDS = [
  'industry', 'staffTotal', 'companyUsers', 'branchesCount',
  'annualRevenueRub', 'itCapexMlnRub', 'itOpexMlnRub', 'itFotMlnRub',
  'itStaffTotal', 'itDependencyPct', 'ceoCfoKpiAvailability',
  'itMgmtPct', 'itOpsPct', 'itSupportPct', 'itDevPct',
] as const;

/** Дефолтный размер страницы */
const DEFAULT_PAGE_SIZE = 25;

/** Возвращает только разрешённые ключи из объекта */
function pickAllowed(obj: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

export default factories.createCoreController('api::zamer.zamer', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Не авторизован');

    try {
      // H4: Пагинация
      const page = Math.max(1, Number(ctx.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || DEFAULT_PAGE_SIZE));
      const offset = (page - 1) * pageSize;

      // M2: populate owner
      const [zamers, total] = await Promise.all([
        strapi.db.query('api::zamer.zamer').findMany({
          where: { owner: user.id },
          orderBy: { createdAt: 'desc' },
          offset,
          limit: pageSize,
          populate: ['owner'],
        }),
        strapi.db.query('api::zamer.zamer').count({
          where: { owner: user.id },
        }),
      ]);

      ctx.send({
        data: zamers,
        meta: {
          pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total },
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error('[Zamer] find error:', message);
      ctx.internalServerError('Ошибка получения списка замеров');
    }
  },

  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Не авторизован');

    try {
      const { id } = ctx.params;
      const zamer = await strapi.db.query('api::zamer.zamer').findOne({
        where: { documentId: id },
        populate: ['owner'],
      });

      if (!zamer) return ctx.notFound('Замер не найден');
      if (zamer.owner?.id !== user.id) {
        return ctx.forbidden('Нет доступа к этому замеру');
      }

      ctx.send({ data: zamer });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error('[Zamer] findOne error:', message);
      ctx.internalServerError('Ошибка получения замера');
    }
  },

  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Не авторизован');

    try {
      const bodyData = ctx.request.body?.data ?? ctx.request.body;
      const safeData = pickAllowed(bodyData, ALLOWED_FIELDS);
      const zamer = await strapi.db.query('api::zamer.zamer').create({
        data: {
          ...safeData,
          owner: user.id,
        },
      });

      ctx.send({ data: zamer });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error('[Zamer] create error:', message);
      ctx.internalServerError('Ошибка создания замера');
    }
  },

  async update(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Не авторизован');

    try {
      const { id } = ctx.params;
      const existing = await strapi.db.query('api::zamer.zamer').findOne({
        where: { documentId: id },
        populate: ['owner'],
      });

      if (!existing) return ctx.notFound('Замер не найден');
      if (existing.owner?.id !== user.id) {
        return ctx.forbidden('Нет доступа к этому замеру');
      }

      const bodyData = ctx.request.body?.data ?? ctx.request.body;
      const safeData = pickAllowed(bodyData, ALLOWED_FIELDS);
      const updated = await strapi.db.query('api::zamer.zamer').update({
        where: { documentId: id },
        data: safeData,
      });

      ctx.send({ data: updated });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error('[Zamer] update error:', message);
      ctx.internalServerError('Ошибка обновления замера');
    }
  },

  async delete(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Не авторизован');

    try {
      const { id } = ctx.params;
      const existing = await strapi.db.query('api::zamer.zamer').findOne({
        where: { documentId: id },
        populate: ['owner'],
      });

      if (!existing) return ctx.notFound('Замер не найден');
      if (existing.owner?.id !== user.id) {
        return ctx.forbidden('Нет доступа к этому замеру');
      }

      await strapi.db.query('api::zamer.zamer').delete({
        where: { documentId: id },
      });

      ctx.send({ data: existing });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error('[Zamer] delete error:', message);
      ctx.internalServerError('Ошибка удаления замера');
    }
  },

  async calculate(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Не авторизован');

    try {
      const { id } = ctx.params;
      const body = ctx.request.body || {};

      // M4: Один findOne вместо двух
      const existing = await strapi.db.query('api::zamer.zamer').findOne({
        where: { documentId: id },
        populate: ['owner'],
      });

      if (!existing) return ctx.notFound('Замер не найден');
      if (existing.owner?.id !== user.id) {
        return ctx.forbidden('Нет доступа к этому замеру');
      }

      // Подготавливаем merged data для расчёта (без лишнего DB read)
      const profileUpdates = body.profile
        ? pickAllowed(body.profile, ALLOWED_PROFILE_FIELDS)
        : {};

      const mergedZamer = {
        ...existing,
        ...profileUpdates,
        factors: body.factors ?? existing.factors,
      };

      // Один вызов calculate
      const calculatorService = strapi.service('api::zamer.calculator');
      const results = calculatorService.computeAll(mergedZamer, mergedZamer.factors);

      // M4: Один update вместо двух
      await strapi.db.query('api::zamer.zamer').update({
        where: { documentId: id },
        data: { ...profileUpdates, results },
      });

      ctx.send({ data: { results } });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      strapi.log.error('[Zamer] calculate error:', message);
      ctx.internalServerError('Ошибка расчёта');
    }
  },
}));
