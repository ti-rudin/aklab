/**
 * Unit тесты для cron scheduler registration.
 *
 * Тестирует:
 * 1. pipeline:daily регистрируется (каждый час, проверяет digest_time)
 * 2. cleanup:old регистрируется на 03:00
 * 3. rescheduleSource — no-op
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock variables ────────────────────────────────────────
const {
  mockCronSchedule,
  mockRun,
  mockDigest,
} = vi.hoisted(() => {
  return {
    mockCronSchedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
    mockRun: vi.fn().mockResolvedValue({ created: 5, errors: [] }),
    mockDigest: vi.fn().mockResolvedValue({ sent: true, errors: [] }),
  };
});

// ─── Mock node-cron ────────────────────────────────────────────────
vi.mock('node-cron', () => ({
  default: { schedule: mockCronSchedule },
  schedule: mockCronSchedule,
}));

// ─── Mock pipeline service ──────────────────────────────────────
vi.mock('../../services/pipeline', () => ({
  getPipelineService: vi.fn().mockReturnValue({
    run: mockRun,
    analyze: vi.fn(),
    digest: mockDigest,
  }),
}));

// ─── Mock strapi ──────────────────────────────────────────────────
function createMockStrapi(overrides?: Partial<any>) {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    db: {
      query: vi.fn().mockReturnValue({
        findMany: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue({
          digest_time: '09:00',
          parse_depth: 20,
          retention_months: 6,
          digest_enabled: true,
          monitored_regions: ['moscow', 'mo'],
          pipeline_state: null,
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Cron Registration', () => {
  // ─── 1. pipeline:daily cron регистрируется ──────────────────────
  it('pipeline:daily cron регистрируется (каждый час, проверяет digest_time)', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // pipeline:daily → '0 * * * *' (каждый час, внутри проверяет digest_time)
    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 * * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'Europe/Moscow' })
    );

    expect(mockStrapi.log.info).toHaveBeenCalledWith(
      '[cron] Registered: pipeline:daily (at digest_time from settings)'
    );
  });

  // ─── 2. cleanup cron регистрируется ─────────────────────────────
  it('cleanup:old cron регистрируется на 03:00 ежедневно', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    expect(mockCronSchedule).toHaveBeenCalledWith(
      '0 3 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'Europe/Moscow' })
    );

    expect(mockStrapi.log.info).toHaveBeenCalledWith(
      '[cron] Registered: cleanup:old (daily 03:00 MSK)'
    );
  });

  // ─── 3. Всего 2 cron jobs (pipeline + cleanup) ─────────────────
  it('регистрирует ровно 2 cron jobs (pipeline + cleanup)', async () => {
    const mockStrapi = createMockStrapi();
    const { registerCrons } = await import('../../cron/index');

    registerCrons(mockStrapi as any);

    // Ровно 2 schedule вызова: pipeline:daily + cleanup:old
    expect(mockCronSchedule).toHaveBeenCalledTimes(2);
  });

  // ─── 4. rescheduleSource — no-op ────────────────────────────────
  it('rescheduleSource — no-op (не падает)', async () => {
    const mockStrapi = createMockStrapi();
    const { rescheduleSource } = await import('../../cron/index');

    // Не должен бросать ошибку
    expect(() => rescheduleSource(mockStrapi as any, { slug: 'test' })).not.toThrow();
  });
});
