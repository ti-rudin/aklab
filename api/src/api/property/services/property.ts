/**
 * property service
 *
 * Фаза 1: stub — стандартные CRUD-операции Strapi.
 * Фаза 4+ может добавить кастомные методы (например, bulk import from parser).
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::property.property');
