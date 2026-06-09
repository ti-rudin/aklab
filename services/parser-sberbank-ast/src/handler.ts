import { createParseHandler } from '@aklab/service-shared';
import { SberbankAstParser } from './sources/sberbank-ast';

const parser = new SberbankAstParser();
export const handleParseJob = createParseHandler(parser);
