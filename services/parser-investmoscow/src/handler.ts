import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { InvestmoscowParser } from './sources/investmoscow';

const parser = new InvestmoscowParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
