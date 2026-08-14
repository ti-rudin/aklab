import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { MetsParser } from './sources/m-ets';

const parser = new MetsParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
