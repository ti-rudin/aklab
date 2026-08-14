import { describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import { FedresursParser } from '../sources/fedresurs';

describe('Fedresurs transport failure contract', () => {
  it('rejects Python client failure instead of reporting a successful empty parse', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error('client unavailable'));
    });

    await expect(new FedresursParser().parse(1)).rejects.toThrow('client unavailable');
  });
});
