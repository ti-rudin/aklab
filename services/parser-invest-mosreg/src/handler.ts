import { createParseHandler } from '@aklab/service-shared';
import { InvestMosregParser } from './sources/invest-mosreg';

const parser = new InvestMosregParser();
export const handleParseJob = createParseHandler(parser);
