/**
 * Unit тесты для QueueService.
 *
 * Тестирует:
 * 1. addToQueue вызывает queue.add с правильными параметрами
 * 2. getDetailedStats возвращает статистику по всем очередям
 * 3. close() закрывает очередь и сбрасывает singleton
 * 4. process() регистрирует handler для очереди
 * 5. Ошибка при добавлении пробрасывается
 * 6. sendRequest маппит requestType → queueName корректно
 * 7. sendRequest бросает ошибку при неизвестном requestType
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks — vitest requirement: моки должны создаваться до vi.mock
const { mockAdd, mockAddAndWait, mockGetDetailedStats, mockProcess, mockClose, MockSqliteQueue } = vi.hoisted(() => {
  const mockAdd = vi.fn();
  const mockAddAndWait = vi.fn();
  const mockGetDetailedStats = vi.fn();
  const mockProcess = vi.fn();
  const mockClose = vi.fn();

  const MockSqliteQueue = vi.fn().mockImplementation(() => ({
    add: mockAdd,
    addAndWait: mockAddAndWait,
    getDetailedStats: mockGetDetailedStats,
    process: mockProcess,
    close: mockClose,
  }));

  return { mockAdd, mockAddAndWait, mockGetDetailedStats, mockProcess, mockClose, MockSqliteQueue };
});

vi.mock('@aklab/sqlite-queue', () => ({
  SqliteQueue: MockSqliteQueue,
}));

// Устанавливаем QUEUE_DB_PATH чтобы не создавать реальный файл
process.env.QUEUE_DB_PATH = ':memory:';

// Динамический импорт после моков
let QueueService: any;

beforeEach(async () => {
  vi.clearAllMocks();
  mockAdd.mockReset();
  mockAddAndWait.mockReset();
  mockGetDetailedStats.mockReset();
  mockProcess.mockReset();
  mockClose.mockReset();

  // Сбрасываем singleton перед каждым тестом
  // Импортируем заново для чистого singleton
  vi.resetModules();
  const mod = await import('../queueService');
  QueueService = mod.QueueService;
});

describe('QueueService', () => {
  // ─── 1. addToQueue ────────────────────────────────────────────────
  it('addToQueue вызывает queue.add с правильными параметрами', () => {
    mockAdd.mockReturnValue({ id: 1, queue: 'parse-bankruptcy' });

    const svc = new QueueService();
    const result = svc.addToQueue('parse-bankruptcy', { docId: 'abc' }, { priority: 5 });

    expect(mockAdd).toHaveBeenCalledWith('parse-bankruptcy', { docId: 'abc' }, { priority: 5 });
    expect(result).toEqual({ id: 1, queue: 'parse-bankruptcy' });
  });

  // ─── 2. getDetailedStats ──────────────────────────────────────────
  it('getDetailedStats возвращает статистику по всем очередям', async () => {
    const stats = {
      'parse-bankruptcy': { pending: 2, processing: 1, completed: 50 },
      'analyze-property': { pending: 0, processing: 0, completed: 30 },
      'digest-send': { pending: 0, processing: 0, completed: 10 },
    };
    mockGetDetailedStats.mockResolvedValue(stats);

    const svc = new QueueService();
    const result = await svc.getDetailedStats();

    expect(mockGetDetailedStats).toHaveBeenCalled();
    expect(result).toEqual(stats);
    expect(Object.keys(result)).toHaveLength(3);
  });

  // ─── 3. close() ──────────────────────────────────────────────────
  it('close() закрывает очередь и сбрасывает singleton', async () => {
    const svc = new QueueService();
    await svc.close();

    expect(mockClose).toHaveBeenCalled();
  });

  // ─── 4. process() ────────────────────────────────────────────────
  it('process() регистрирует handler для очереди', () => {
    const handler = vi.fn().mockResolvedValue({ done: true });
    mockProcess.mockReturnValue(undefined);

    const svc = new QueueService();
    svc.process('parse-bankruptcy', handler, { concurrency: 2 });

    expect(mockProcess).toHaveBeenCalledWith('parse-bankruptcy', handler, { concurrency: 2 });
  });

  // ─── 5. addToQueue — ошибка пробрасывается ──────────────────────
  it('addToQueue пробрасывает ошибку при неудачном добавлении', () => {
    mockAdd.mockImplementation(() => {
      throw new Error('SQLite disk full');
    });

    const svc = new QueueService();
    expect(() => svc.addToQueue('parse-bankruptcy', {})).toThrow('SQLite disk full');
  });

  // ─── 6. sendRequest маппит requestType → queueName ──────────────
  it('sendRequest маппит requestType в корректное имя очереди', async () => {
    mockAddAndWait.mockResolvedValue({ result: 'ok' });

    const svc = new QueueService();
    await svc.sendRequest('parse:bankruptcy:request', { docId: 'xyz' }, 5000, 'corr-1');

    expect(mockAddAndWait).toHaveBeenCalledWith('parse-bankruptcy', { docId: 'xyz' }, 5000, 'corr-1');
  });

  it('sendRequest маппит analyze:property:request → analyze-property', async () => {
    mockAddAndWait.mockResolvedValue({});

    const svc = new QueueService();
    await svc.sendRequest('analyze:property:request', { id: 42 });

    expect(mockAddAndWait).toHaveBeenCalledWith('analyze-property', { id: 42 }, 60000, undefined);
  });

  // ─── 7. sendRequest — неизвестный requestType ────────────────────
  it('sendRequest бросает UNKNOWN_REQUEST_TYPE для неизвестного типа', async () => {
    const svc = new QueueService();
    await expect(svc.sendRequest('unknown:type', {})).rejects.toMatchObject({
      errorCode: 'UNKNOWN_REQUEST_TYPE',
      requestType: 'unknown:type',
    });
  });

  // ─── 8. sendRequest — оборачивает ошибку очереди в QUEUE_ERROR ──
  it('sendRequest оборачивает внутреннюю ошибку в QUEUE_ERROR', async () => {
    mockAddAndWait.mockRejectedValue(new Error('Timeout'));

    const svc = new QueueService();
    await expect(svc.sendRequest('digest:send:request', {}, 1000, 'corr-x')).rejects.toMatchObject({
      errorCode: 'QUEUE_ERROR',
      message: 'Timeout',
      correlationId: 'corr-x',
      requestType: 'digest:send:request',
    });
  });

  // ─── 9. addAndWait — проксирует к queue.addAndWait ──────────────
  it('addAndWait проксирует вызов к queue.addAndWait', async () => {
    mockAddAndWait.mockResolvedValue({ status: 'done' });

    const svc = new QueueService();
    const result = await svc.addAndWait('my-queue', { x: 1 }, 30000, 'cid');

    expect(mockAddAndWait).toHaveBeenCalledWith('my-queue', { x: 1 }, 30000, 'cid');
    expect(result).toEqual({ status: 'done' });
  });
});
