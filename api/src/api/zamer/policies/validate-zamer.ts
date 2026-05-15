import type { Core } from '@strapi/strapi';

/** Поля, обязательных для создания замера */
const REQUIRED_FIELDS = ['name'] as const;

/** Максимальная длина строковых полей */
const STRING_LIMITS: Record<string, number> = {
  name: 255,
  industry: 255,
};

/** Допустимый диапазон для процентных полей */
const PERCENT_FIELDS = ['itDependencyPct', 'itMgmtPct', 'itOpsPct', 'itSupportPct', 'itDevPct'] as const;

/**
 * Политика валидации данных замера.
 * Подключается к POST/PUT роутам для проверки входных данных до контроллера.
 */
export default (policyContext: any, { strapi }: { strapi: Core.Strapi }) => {
  const body = policyContext.request.body?.data ?? policyContext.request.body;

  if (!body || typeof body !== 'object') {
    return false;
  }

  // Проверка обязательных полей (только для create)
  if (policyContext.request.method === 'POST') {
    for (const field of REQUIRED_FIELDS) {
      if (!body[field] || typeof body[field] !== 'string' || body[field].trim().length === 0) {
        strapi.log.warn(`[Policy] Отсутствует обязательное поле: ${field}`);
        return false;
      }
    }
  }

  // Проверка длины строковых полей
  for (const [field, limit] of Object.entries(STRING_LIMITS)) {
    if (body[field] !== undefined && typeof body[field] === 'string' && body[field].length > limit) {
      strapi.log.warn(`[Policy] Поле ${field} превышает лимит ${limit} символов`);
      return false;
    }
  }

  // Проверка процентных полей
  for (const field of PERCENT_FIELDS) {
    if (body[field] !== undefined) {
      const val = Number(body[field]);
      if (isNaN(val) || val < 0 || val > 100) {
        strapi.log.warn(`[Policy] Поле ${field} должно быть числом от 0 до 100`);
        return false;
      }
    }
  }

  // Проверка неотрицательных целочисленных полей
  const nonNegativeFields = ['staffTotal', 'companyUsers', 'branchesCount', 'annualRevenueRub', 'itCapexMlnRub', 'itOpexMlnRub', 'itFotMlnRub', 'itStaffTotal'];
  for (const field of nonNegativeFields) {
    if (body[field] !== undefined) {
      const val = Number(body[field]);
      if (isNaN(val) || val < 0 || !Number.isInteger(val)) {
        strapi.log.warn(`[Policy] Поле ${field} должно быть неотрицательным целым числом`);
        return false;
      }
    }
  }

  return true;
};
