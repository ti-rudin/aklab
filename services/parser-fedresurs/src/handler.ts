import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { FedresursParser } from './sources/fedresurs';

const parser = new FedresursParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
