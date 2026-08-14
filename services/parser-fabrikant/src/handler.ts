import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { FabrikantParser } from './sources/fabrikant';

const parser = new FabrikantParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
