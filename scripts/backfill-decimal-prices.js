#!/usr/bin/env node
/**
 * Source-evidenced repair for historical decimal-price corruption.
 * Read-only by default. --apply requires absolute DB and a new backup.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SUPPORTED_SOURCES = new Set(['m-ets', 'sberbank-ast']);
const MAX_SOURCE_ROWS = 2_000;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function parseArgs(argv) {
  const options = { apply: false, dbPath: null, backupPath: null, source: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--db') options.dbPath = argv[++i] || null;
    else if (arg.startsWith('--db=')) options.dbPath = arg.slice(5);
    else if (arg === '--backup') options.backupPath = argv[++i] || null;
    else if (arg.startsWith('--backup=')) options.backupPath = arg.slice(9);
    else if (arg === '--source') options.source = argv[++i] || null;
    else if (arg.startsWith('--source=')) options.source = arg.slice(9);
    else if (arg === '--help' || arg === '-h') return { ...options, help: true };
    else fail('CLI_ARGUMENTS', 'Unknown CLI argument');
  }
  if (options.help) return options;
  if (!options.dbPath || !path.isAbsolute(options.dbPath)) fail('CLI_ARGUMENTS', 'Explicit absolute --db is required');
  if (!SUPPORTED_SOURCES.has(options.source)) fail('CLI_ARGUMENTS', 'Supported --source is required');
  if (options.apply && (!options.backupPath || !path.isAbsolute(options.backupPath))) fail('CLI_ARGUMENTS', 'Apply requires an absolute --backup path');
  if (options.backupPath && !path.isAbsolute(options.backupPath)) fail('CLI_ARGUMENTS', 'Backup path must be absolute');
  return options;
}
function parsePrice(value) {
  if (!value) return undefined;
  let v = String(value).replace(/[^\d,.]/g, '');
  if (!v || !/\d/.test(v)) return undefined;
  const commaCount = (v.match(/,/g) || []).length;
  const dotCount = (v.match(/\./g) || []).length;
  if (commaCount) v = v.replace(/\./g, '').replace(',', '.');
  else if (dotCount > 1 || (dotCount === 1 && v.length - v.lastIndexOf('.') - 1 === 3)) v = v.replace(/\./g, '');
  const result = Number(v);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}
function candidateCorrection(dbPrice, sourcePrice) {
  if (!Number.isFinite(dbPrice) || !Number.isFinite(sourcePrice) || dbPrice <= sourcePrice) return false;
  const ratio = dbPrice / sourcePrice;
  return [10, 100, 1000].some((factor) => Math.abs(ratio - factor) < 1e-9);
}
function sourcePriceFromHtml(source, html) {
  if (source === 'm-ets') {
    const match = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']price["']/i);
    return parsePrice(match?.[1]);
  }
  for (const field of ['CurrentAmount', 'purchAmount', 'Bids_BidPriceNotReq', 'Bids_BidMinPrice']) {
    const tag = new RegExp(`<${field}[^>]*>([^<]+)</${field}>`, 'i').exec(html);
    const byId = new RegExp(`id=["'][^"']*${field}[^"']*["'][^>]*>([^<]+)<`, 'i').exec(html);
    const price = parsePrice(tag?.[1] || byId?.[1]);
    if (price !== undefined) return price;
  }
  return undefined;
}
function backupDatabase(db, dbPath, backupPath) {
  const live = path.resolve(dbPath); const backup = path.resolve(backupPath);
  if (live === backup || fs.existsSync(backup) || !fs.existsSync(path.dirname(backup))) fail('BACKUP_INVALID', 'Backup path is invalid');
  db.prepare('VACUUM main INTO ?').run(backup);
  fs.chmodSync(backup, 0o600);
  const check = new Database(backup, { readonly: true, fileMustExist: true });
  try { if (check.pragma('integrity_check', { simple: true }) !== 'ok') fail('BACKUP_INVALID', 'Backup integrity verification failed'); } finally { check.close(); }
  return { integrity: 'ok', sha256: crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex') };
}
async function fetchPrices(rows, source) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext({ locale: 'ru-RU' }); const page = await context.newPage(); page.setDefaultNavigationTimeout(30_000);
    const results = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]; let sourcePrice; let reason = null;
      try { const response = await page.goto(row.url, { waitUntil: 'domcontentloaded' }); const html = await page.content(); sourcePrice = sourcePriceFromHtml(source, html); if (!response?.ok()) reason = `http_${response?.status() || 0}`; else if (sourcePrice === undefined) reason = 'source_price_not_found'; } catch { reason = 'source_fetch_failed'; }
      results.push({ ...row, sourcePrice: sourcePrice ?? null, reason, eligible: sourcePrice !== undefined && candidateCorrection(row.price, sourcePrice) });
      if ((i + 1) % 20 === 0 || i + 1 === rows.length) console.error(`[backfill] ${source}: checked ${i + 1}/${rows.length}`);
    }
    await context.close(); return results;
  } finally { await browser.close(); }
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return console.log('Usage: node scripts/backfill-decimal-prices.js --db=/absolute/data.db --source=m-ets|sberbank-ast [--apply --backup=/absolute/before.db]');
  const db = new Database(options.dbPath, { readonly: !options.apply, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('DB_INVALID', 'Live database integrity check failed');
    const rows = db.prepare('SELECT id, document_id AS documentId, external_id AS externalId, url, price FROM properties WHERE source = ? AND price IS NOT NULL AND url IS NOT NULL AND url <> ? ORDER BY id LIMIT ?').all(options.source, '', MAX_SOURCE_ROWS);
    if (rows.length >= MAX_SOURCE_ROWS) fail('ROW_LIMIT', 'Source row limit reached; refuse partial backfill');
    const checked = await fetchPrices(rows, options.source); const candidates = checked.filter((row) => row.eligible); let backup = null; let changed = 0;
    if (options.apply) { backup = backupDatabase(db, options.dbPath, options.backupPath); const statement = db.prepare('UPDATE properties SET price = ?, updated_at = ? WHERE id = ? AND price = ?'); const tx = db.transaction(() => candidates.map((row) => statement.run(row.sourcePrice, new Date().toISOString(), row.id, row.price).changes)); const results = tx(); changed = results.reduce((a, b) => a + b, 0); if (changed !== candidates.length) fail('CONCURRENT_WRITE', 'Row changed during backfill'); if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('POSTCONDITION_FAILED', 'Database integrity failed after backfill'); }
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'audit', source: options.source, scanned: rows.length, candidates: candidates.length, changed, unresolved: checked.filter((row) => row.reason).length, backup, candidates: candidates.map(({ id, externalId, price, sourcePrice }) => ({ id, externalId, dbPrice: price, sourcePrice })) }, null, 2));
  } finally { db.close(); }
}
if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.code || 'BACKFILL_FAILED' })); process.exitCode = 1; });
module.exports = { candidateCorrection, parseArgs, parsePrice, sourcePriceFromHtml };
