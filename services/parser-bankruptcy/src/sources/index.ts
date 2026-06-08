/**
 * Маппинг source → парсер.
 */

import type { SourceParser } from './types';
import { FedresursParser } from './fedresurs';

const parsers: Record<string, SourceParser> = {
  fedresurs: new FedresursParser(),
};

export function getSourceParser(source: string): SourceParser | null {
  return parsers[source] || null;
}

export function getAvailableSources(): string[] {
  return Object.keys(parsers);
}
