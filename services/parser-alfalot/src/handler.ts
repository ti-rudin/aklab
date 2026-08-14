import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { AlfalotParser } from './sources/alfalot';

const parser = new AlfalotParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
