import { createParseHandler } from '@aklab/service-shared';
import { RoseltorgParser } from './sources/roseltorg';

const parser = new RoseltorgParser();
export const handleParseJob = createParseHandler(parser);
