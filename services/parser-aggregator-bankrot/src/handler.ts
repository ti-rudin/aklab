import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { AggregatorBankrotParser } from './sources/aggregator-bankrot';

const parser = new AggregatorBankrotParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
