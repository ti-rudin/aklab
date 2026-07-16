import type { Core } from '@strapi/strapi';
import { runSeeders } from './seeders';
import { getQueueService } from './services/queueService';
import { registerCrons } from './cron';
import { getPipelineService } from './services/pipeline';
import type { StrapiInstance } from './types/strapi';

export default {
  /**
   * Runs before the application is initialized.
   * Инициализирует QueueService (открывает queue.db через @aklab/sqlite-queue).
   * Если БД не создана — она создастся автоматически при первом обращении.
   */
  register() {
    try {
      getQueueService();
      strapi.log?.info?.('[register] QueueService initialized');
    } catch (err: any) {
      // strapi.log может быть ещё не доступен — fallback в console
      // eslint-disable-next-line no-console
      console.error(`[register] QueueService init failed: ${err?.message || err}`);
    }
  },

  /**
   * Bootstrap: seed'ы (admin + test user) + регистрация cron-задач.
   * Логика вынесена в src/seeders/index.ts (по образцу tirobots).
   * Cron-задачи — в src/cron/index.ts (Фаза 0: stub, наполнится в Фазе 3).
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Startup validation: проверяем критичные secrets
    const requiredEnvVars = ['ADMIN_JWT_SECRET', 'API_TOKEN_SALT', 'JWT_SECRET'];
    const missing = requiredEnvVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}. Check api/.env`);
    }

    try {
      await runSeeders(strapi as any);
    } catch (err: any) {
      strapi.log.error(`[bootstrap] runSeeders failed: ${err.message}`);
    }

    try {
      registerCrons(strapi as any);
    } catch (err: any) {
      strapi.log.error(`[bootstrap] registerCrons failed: ${err.message}`);
    }

    // Pipeline recovery never clears a persisted active lifecycle on restart:
    // external workers can still own live queue leases for that run.
    try {
      const pipeline = getPipelineService(strapi as any);
      const state = await pipeline.getState();
      if (state.status === 'running' || state.status === 'cancelling') {
        strapi.log.warn(`[bootstrap] Recovering persisted pipeline lifecycle: status=${state.status}, run_id=${state.run_id || 'missing'}`);
        await pipeline.recoverAfterRestart();
      }
    } catch (err: any) {
      strapi.log.error(`[bootstrap] Pipeline recovery failed: ${err.message}`);
    }
  },
};
