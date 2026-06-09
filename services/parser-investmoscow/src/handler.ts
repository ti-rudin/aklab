import { createParseHandler } from '@aklab/service-shared';
import { InvestmoscowParser } from './sources/investmoscow';

const parser = new InvestmoscowParser();
export const handleParseJob = createParseHandler(parser);
