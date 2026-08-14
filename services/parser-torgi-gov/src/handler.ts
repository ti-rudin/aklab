import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { TorgiGovParser } from './sources/torgi-gov';

const parser = new TorgiGovParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
