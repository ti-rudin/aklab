/**
 * source service — расширенный: lifecycle hooks для reschedule при изменении schedule.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::source.source', ({ strapi }) => ({
  async afterUpdate(event: any) {
    const { result, params } = event;
    // Проверяем, изменился ли schedule
    if (params?.data?.schedule !== undefined) {
      try {
        // Динамический импорт чтобы избежать circular dependency
        const { rescheduleSource } = await import('../../../cron/index');
        rescheduleSource(strapi, result);
        strapi.log.info(`[source] Rescheduled cron for ${result.slug}: ${result.schedule}`);
      } catch (err: any) {
        strapi.log.warn(`[source] Failed to reschedule ${result.slug}: ${err.message}`);
      }
    }
  },
}));
