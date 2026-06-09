import { createParseHandler } from '@aklab/service-shared';
import { AggregatorBankrotParser } from './sources/aggregator-bankrot';

const parser = new AggregatorBankrotParser();
export const handleParseJob = createParseHandler(parser);
