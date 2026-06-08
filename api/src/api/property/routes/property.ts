/**
 * property router
 *
 * Фаза 1: стандартные CRUD-маршруты через factories.createCoreRouter.
 * Без этого файла Strapi 5 не регистрирует /api/properties — loadAPIs
 * видит routes=[] и router не подключает content-type.
 *
 * Фаза 5+ может добавить кастомные маршруты (например,
 * /api/properties/undervalued, /api/properties/stats) через
 * extend в config: { ... }.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::property.property');
