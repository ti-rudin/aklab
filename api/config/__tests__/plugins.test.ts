import { describe, expect, it } from 'vitest';
import pluginsConfig from '../plugins';

describe('Strapi plugin runtime contract', () => {
  it('keeps the unused upload plugin disabled', () => {
    const env = Object.assign(
      (name: string) => `test-${name}`,
      { int: (_name: string, fallback: number) => fallback },
    );

    const config = pluginsConfig({ env } as never);

    expect(config.upload).toEqual({ enabled: false });
  });
});
