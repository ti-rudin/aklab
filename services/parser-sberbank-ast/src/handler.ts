import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { SberbankAstParser } from './sources/sberbank-ast';

const parser = new SberbankAstParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
