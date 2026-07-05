/**
 * Unit тесты для cron scheduler registration.
 *
 * Тестирует:
 * 1. registerCrons регистрирует cron jobs для каждого active source
 * 2. Неактивные sources не попадают в getActiveSources (фильтр в query)
 * 3. analyze cron регистрируется на 08:00
 * 4. digest cron регистрируется
 * 5. cleanup cron регистрируется
 * 6. score merged into analyze (no separate cron)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock variables ────────────────────────────────────────
const {
  mockCronSchedule,
  mockAddToQueue,
  mockGetQueueService,
  mockAnalyze,
  mockDigest,
} = vi.hoisted(() => {
  return {
    mockCronSchedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
    mockAddToQueue: vi.fn(),
    mockGetQueueService: vi.fn(),
    mockAnalyze: vi.fn().mockResolvedValue({ undervalued: 2, errors: [] }),
    mockDigest: vi.fn().mockResolvedValue({ sent: true, errors: [] }),
  };
});

// ─── Mock node-cron ────────────────────────────────────────────────
vi.mock('node-cron', () => ({
  default: { schedule: mockCronSchedule },
  schedule: mockCronSchedule,
}));

// ─── Mock queueService ────────────────────────────────────────────
vi.mock('../../services/queueService', () => ({
  getQueueService: mockGetQueueService,
}));

// ─── Mock pipeline service ──────────────────────────────────────
vi.mock('../../services/pipeline', () => ({
  getPipelineService: vi.fn().mockReturnValue({
    analyze: mockAnalyze,
    digest: mockDigest,
  }),
}));

// ─── Mock strapi ──────────────────────────────────────────────────
function createMockStrapi(overrides?: Partial<any>) {
  const defaultSources = [
    { slug: 'fabrikant', schedule: '0 3 * * *', id: 1, documentId: 'doc1', name: 'Fabrikant', is_active: true },
    { slug: 'torgi-gov', schedule: '0 4 * * *', id: 2, documentId: 'doc2', name: 'Torgi-gov', is_active: true },
  ];

  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    entityService: {
      findMany: vi.fn().mockResolvedValue(defaultSources),
    },
    db: {
      query: vi.fn().mockReturnValue({
        findMany: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue({
          digest_time: '09:00',
          retention_months: 6,
          smtp_to: 'test@example.com',
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetQueueService.mockReturnValue({
    addToQueue: mockAddToQueue,
  });
});

describe('Cron Registration', () => {
  // ─── 1. Регистрация cron jobs для active sources ─────────────────
  it('registerCrons регистрирует cron jobs для каждого active source', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // Ждём async IIFE для загрузки sources
    await vi.waitFor(() => {
      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith(
        'api::source.source',
        expect.objectContaining({ filters: { is_active: true } })
      );
    });

    // Даём microtask queue завершить IIFE
    await new Promise(r => setTimeout(r, 10));

    // Должны быть вызваны schedule для fabrikant и torgi-gov + 4 системных cron
    const scheduleCalls = mockCronSchedule.mock.calls.map(c => c[0]);
    expect(scheduleCalls).toContain('0 3 * * *'); // fabrikant
    expect(scheduleCalls).toContain('0 4 * * *'); // torgi-gov
    // Общее: 2 source + analyze + digest + cleanup = 5
    expect(scheduleCalls.length).toBeGreaterThanOrEqual(5);
  });

  // ─── 2. Неактивные sources не регистрируются ────────────────────
  it('не регистрирует cron jobs если sources пустой массив', async () => {
    const mockStrapi = createMockStrapi({
      entityService: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    await vi.waitFor(() => {
      expect(mockStrapi.log.info).toHaveBeenCalledWith(
        '[cron] No active sources — no parse jobs registered'
      );
    });
  });

  // ─── 3. analyze cron регистрируется на 08:00 ────────────────────
  it('analyze:properties cron регистрируется на 08:00', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // analyze:properties → '0 8 * * *'
    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 8 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'Europe/Moscow' })
    );

    expect(mockStrapi.log.info).toHaveBeenCalledWith(
      '[cron] Registered: analyze:properties (daily 08:00 MSK)'
    );
  });

  // ─── 4. digest cron регистрируется ──────────────────────────────
  it('digest:morning cron регистрируется (каждый час, проверяет digest_time)', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // digest:morning → '0 * * * *' (каждый час, внутри проверяет digest_time)
    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 * * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'Europe/Moscow' })
    );

    expect(mockStrapi.log.info).toHaveBeenCalledWith(
      '[cron] Registered: digest:morning (dynamic from Setting.digest_time)'
    );
  });

  // ─── 5. cleanup cron регистрируется ─────────────────────────────
  it('cleanup:old cron регистрируется на 03:00 ежедневно', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // cleanup:old → '0 3 * * *'
    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 3 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'Europe/Moscow' })
    );

    expect(mockStrapi.log.info).toHaveBeenCalledWith(
      '[cron] Registered: cleanup:old (daily 03:00 MSK)'
    );
  });

  // ─── 6. score merged into analyze — no separate cron ──────────────
  it('score:properties не регистрируется отдельно (встроен в analyze)', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // Score cron '5 8 * * *' больше не регистрируется
    const scheduleCalls = mockCronSchedule.mock.calls.map(c => c[0]);
    expect(scheduleCalls).not.toContain('5 8 * * *');
  });

  // ─── 7. Ошибка загрузки sources логируется ─────────────────────
  it('логирует ошибку если загрузка sources упала', async () => {
    const mockStrapi = createMockStrapi({
      entityService: {
        findMany: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      },
    });
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    await vi.waitFor(() => {
      expect(mockStrapi.log.error).toHaveBeenCalledWith(
        '[cron] Failed to register source crons: DB connection lost'
      );
    });
  });
});
