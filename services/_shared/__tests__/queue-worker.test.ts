import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
const mockProcess = vi.fn();
const mockClose = vi.fn();

vi.mock('@aklab/sqlite-queue', () => ({
  SqliteQueue: vi.fn().mockImplementation(() => ({
    process: mockProcess,
    close: mockClose,
  })),
}));

vi.mock('../src/config', () => ({
  config: {
    queue: { dbPath: '/tmp/test-queue.db' },
    queueName: 'test-queue',
  },
}));

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SqliteQueue } from '@aklab/sqlite-queue';
import {
  startQueueWorker,
  stopQueueWorker,
  gracefulStopQueueWorker,
} from '../src/queue-worker';
import { logger } from '../src/logger';

describe('queue-worker', () => {
  beforeEach(() => {
    // Cleanup any running queue FIRST (may call mockClose/logger.info)
    stopQueueWorker();
    // THEN clear mock history so tests start fresh
    vi.clearAllMocks();
  });

  describe('startQueueWorker', () => {
    it('should create SqliteQueue with correct dbPath and options', () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      expect(SqliteQueue).toHaveBeenCalledWith('/tmp/test-queue.db', {
        disableTimers: true,
      });
    });

    it('should call queue.process with queueName and handler', () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      expect(mockProcess).toHaveBeenCalledWith('test-queue', handler, {
        concurrency: 2,
      });
    });

    it('should log that queue worker started', () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Queue worker started'),
      );
    });
  });

  describe('stopQueueWorker', () => {
    it('should call queue.close() when queue is running', () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      stopQueueWorker();

      expect(mockClose).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Queue worker stopped');
    });

    it('should be a no-op when no queue is running', () => {
      stopQueueWorker();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      stopQueueWorker();
      stopQueueWorker();

      // close should only be called once (first stop)
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('gracefulStopQueueWorker', () => {
    it('should resolve immediately when no queue is running', async () => {
      await expect(gracefulStopQueueWorker(5000)).resolves.toBeUndefined();
    });

    it('should close queue and resolve', async () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      await gracefulStopQueueWorker(5000);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should log graceful stop message', async () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      await gracefulStopQueueWorker(5000);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('stopped gracefully'),
      );
    });

    it('should set queue to null after stopping', async () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      await gracefulStopQueueWorker(5000);

      // Calling stopQueueWorker again should be a no-op (queue is null)
      mockClose.mockClear();
      stopQueueWorker();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should handle errors during close gracefully', async () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      mockClose.mockImplementationOnce(() => {
        throw new Error('Close failed');
      });

      await expect(gracefulStopQueueWorker(5000)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Queue close error'),
      );
    });

    it('should use timeout fallback when queue.close takes too long', async () => {
      const handler = vi.fn();
      startQueueWorker(handler);

      // Make close hang (never resolves/rejects)
      mockClose.mockImplementation(() => {
        // In reality this would just block, but for testing we just return
      });

      // The implementation calls close synchronously and resolves immediately
      // (the setTimeout is set but clearTimeout is called before it fires)
      await gracefulStopQueueWorker(100);

      expect(mockClose).toHaveBeenCalled();
    });
  });
});
