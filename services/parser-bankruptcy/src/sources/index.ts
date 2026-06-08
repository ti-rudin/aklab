/**
 * Маппинг source → парсер.
 */

import type { SourceParser } from './types';
import { FedresursParser } from './fedresurs';
import { FabrikantParser } from './fabrikant';

const parsers: Record<string, SourceParser> = {
  fedresurs: new FedresursParser(),
  fabrikant: new FabrikantParser(),
};

export function getSourceParser(source: string): SourceParser | null {
  return parsers[source] || null;
}

export function getAvailableSources(): string[] {
  return Object.keys(parsers);
}
