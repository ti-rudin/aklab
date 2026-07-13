import { createParseHandler } from '@aklab/service-shared';
import { FedresursParser } from './sources/fedresurs';

const parser = new FedresursParser();
export const handleParseJob = createParseHandler(parser);
