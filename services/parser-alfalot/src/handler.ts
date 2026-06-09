import { createParseHandler } from '@aklab/service-shared';
import { AlfalotParser } from './sources/alfalot';

const parser = new AlfalotParser();
export const handleParseJob = createParseHandler(parser);
