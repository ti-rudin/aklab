import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { InvestMosregParser } from './sources/invest-mosreg';

const parser = new InvestMosregParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
