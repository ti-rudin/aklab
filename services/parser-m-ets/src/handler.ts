import { createParseHandler } from '@aklab/service-shared';
import { MetsParser } from './sources/m-ets';

const parser = new MetsParser();
export const handleParseJob = createParseHandler(parser);
