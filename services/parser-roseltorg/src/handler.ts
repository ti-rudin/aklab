import { createParseHandler, createParserQueueHandler } from '@aklab/service-shared';
import { RoseltorgParser } from './sources/roseltorg';

const parser = new RoseltorgParser();
const parseHandler = createParseHandler(parser);
export const handleParseJob = createParserQueueHandler(parser, parseHandler);
