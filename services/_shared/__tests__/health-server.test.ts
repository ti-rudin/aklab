import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('express', () => {
  const handlers: Record<string, Record<string, Function>> = { get: {} };
  const mockApp = {
    get: vi.fn((path: string, handler: Function) => {
      handlers.get[path] = handler;
    }),
    listen: vi.fn((port: number, host: string, cb: Function) => {
      cb();
      return { close: vi.fn() };
    }),
  };
  const express = vi.fn(() => mockApp);
  // Attach handlers so tests can access them
  (express as any).__handlers = handlers;
  (express as any).__mockApp = mockApp;
  return { default: express };
});

vi.mock('../src/config', () => ({
  config: {
    port: 1340,
    serviceName: 'test-service',
  },
}));

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import express from 'express';
import { startHealthServer } from '../src/health-server';
import { logger } from '../src/logger';

describe('health-server', () => {
  const mockExpress = express as any;
  const handlers = mockExpress.__handlers;
  const mockApp = mockExpress.__mockApp;

  it('should register /health and /ready endpoints', () => {
    // The module is already loaded at import time, so routes were registered then.
    // Note: vi.clearAllMocks() is NOT called before this test since the registration
    // only happens once at module load time.
    expect(mockApp.get).toHaveBeenCalledWith('/health', expect.any(Function));
    expect(mockApp.get).toHaveBeenCalledWith('/ready', expect.any(Function));
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', () => {
      const mockReq = {};
      const mockRes = { json: vi.fn() };

      handlers.get['/health'](mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          service: 'test-service',
        }),
      );
      expect(mockRes.json.mock.calls[0][0].timestamp).toBeDefined();
    });
  });

  describe('GET /ready', () => {
    it('should return 200 with status ok', () => {
      const mockReq = {};
      const mockRes = { json: vi.fn() };

      handlers.get['/ready'](mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          service: 'test-service',
        }),
      );
      expect(mockRes.json.mock.calls[0][0].timestamp).toBeDefined();
    });
  });

  describe('startHealthServer', () => {
    it('should start listening on correct port and host', async () => {
      (mockApp.listen as any).mockClear();
      await startHealthServer();

      expect(mockApp.listen).toHaveBeenCalledWith(
        1340,
        '127.0.0.1',
        expect.any(Function),
      );
    });

    it('should log that server is listening', async () => {
      (logger.info as any).mockClear();
      await startHealthServer();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Health server listening'),
      );
    });

    it('should resolve the promise after listening', async () => {
      await expect(startHealthServer()).resolves.toBeUndefined();
    });
  });
});
