import { createParseHandler } from '@aklab/service-shared';
import { EtprfParser } from './sources/etprf';

const parser = new EtprfParser();
export const handleParseJob = createParseHandler(parser);
