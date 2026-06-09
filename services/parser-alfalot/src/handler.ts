import type { Job } from '@aklab/sqlite-queue';
import { propertyExists, createProperty, logCron, updateSourceStats, logger } from '@aklab/service-shared';
import { AlfalotParser } from './sources/alfalot';

export interface ParseRequest {
  source: string; sourceId?: number; documentId?: string; correlationId?: string;
}

const parser = new AlfalotParser();

export async function handleParseJob(job: Job) {
  const req = job.data as ParseRequest;
  const corrId = req.correlationId || job.correlation_id || `parse-${Date.now()}`;
  const startedAt = new Date().toISOString();
  let processed = 0, created = 0, skipped = 0, errorMsg: string | undefined;

  try {
    const properties = await parser.parse();
    processed = properties.length;
    logger.info(`Parsed ${processed} from ${req.source}`, { correlationId: corrId });

    for (const prop of properties) {
      try {
        if (await propertyExists(req.source, prop.external_id)) { skipped++; continue; }
        await createProperty({
          source: req.source, external_id: prop.external_id, url: prop.url,
          title: prop.title, address: prop.address, city: prop.city,
          area_sqm: prop.area_sqm, price: prop.price, price_per_sqm: prop.price_per_sqm,
          property_type: prop.property_type, auction_type: prop.auction_type,
          published_at_source: prop.published_at, description: prop.description,
          contacts: prop.contacts,
        });
        created++;
      } catch (err: any) {
        logger.warn(`Failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
      }
    }
  } catch (err: any) {
    errorMsg = err.message;
    logger.error(`Parse failed: ${err.message}`, { correlationId: corrId });
    if (req.documentId) await updateSourceStats(req.documentId, { last_parse_status: 'error', last_parse_error: err.message, last_parsed_at: new Date().toISOString() }).catch(() => {});
    throw err;
  } finally {
    await logCron({ name: `parse-${req.source}`, started_at: startedAt, finished_at: new Date().toISOString(), items_processed: created, error: errorMsg }).catch(() => {});
  }

  if (req.documentId) {
    await updateSourceStats(req.documentId, {
      last_parse_status: 'success', last_parse_error: undefined, last_parsed_at: new Date().toISOString(),
      total_found: processed, total_created: created, parse_count: 1,
    }).catch((err: any) => { logger.warn(`Stats update failed: ${err.message}`); });
  }

  logger.info(`Done: ${created} created, ${skipped} skipped, ${processed} total`);
  return { processed, created, skipped };
}
