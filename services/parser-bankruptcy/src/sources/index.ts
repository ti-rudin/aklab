/**
 * Маппинг source → парсер.
 */

import type { SourceParser } from './types';
import { FedresursParser } from './fedresurs';
import { FabrikantParser } from './fabrikant';
import { TorgiGovParser } from './torgi-gov';

const parsers: Record<string, SourceParser> = {
  fedresurs: new FedresursParser(),
  fabrikant: new FabrikantParser(),
  'torgi-gov': new TorgiGovParser(),
};

export function getSourceParser(source: string): SourceParser | null {
  return parsers[source] || null;
}

export function getAvailableSources(): string[] {
  return Object.keys(parsers);
}
