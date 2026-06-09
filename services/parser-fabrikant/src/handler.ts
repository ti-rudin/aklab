import { createParseHandler } from '@aklab/service-shared';
import { FabrikantParser } from './sources/fabrikant';

const parser = new FabrikantParser();
export const handleParseJob = createParseHandler(parser);
