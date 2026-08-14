import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ecosystem = require('../../ecosystem.config.js');
const services = require('../../services/services.json');

describe('production parser memory ceilings', () => {
  it('gives aggregator-bankrot a durable 1024M ceiling and keeps other parsers at 512M', () => {
    const parserApps = services.parsers.map((parser: { pm2_name: string }) =>
      ecosystem.apps.find((app: { name: string }) => app.name === parser.pm2_name),
    );

    const aggregator = parserApps.find(
      (app: { name: string }) => app.name === 'aklab-parser-aggregator-bankrot',
    );
    const otherParsers = parserApps.filter(
      (app: { name: string }) => app.name !== 'aklab-parser-aggregator-bankrot',
    );

    expect(aggregator?.max_memory_restart).toBe('1024M');
    expect(otherParsers).toHaveLength(services.parsers.length - 1);
    expect(otherParsers.every((app: { max_memory_restart: string }) => app.max_memory_restart === '512M')).toBe(true);
  });
});
