/**
 * setting router
 *
 * Фаза 1: стандартные CRUD-маршруты через factories.createCoreRouter.
 * setting — singleType → будут сгенерированы find/update/delete
 * (без create/findOne, как и положено singleton'у).
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::setting.setting');
