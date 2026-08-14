import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { EtprfParser } from './sources/etprf';

const parser = new EtprfParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
