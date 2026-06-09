import { createParseHandler } from '@aklab/service-shared';
import { TorgiGovParser } from './sources/torgi-gov';

const parser = new TorgiGovParser();
export const handleParseJob = createParseHandler(parser);
