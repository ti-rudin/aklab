#!/usr/bin/env node
/**
 * P0 integrity migration for properties(source, external_id).
 *
 * Default mode is audit-only. Apply mode creates a verified SQLite backup,
 * copies media before changing rows, moves relations, removes duplicate rows,
 * and then enforces the invariant in SQLite.
 *
 * Usage:
 *   node scripts/migrate-property-identity.js
 *   node scripts/migrate-property-identity.js --apply
 *   node scripts/migrate-property-identity.js --apply --db /absolute/path/data.db
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.join(ROOT, 'api', '.tmp', 'data.db');
const DEFAULT_PHOTOS_BASE = path.join(ROOT, 'api', 'data', 'photos');
const IDENTITY_INDEX = 'properties_source_external_id_unique';
const RELATION_TABLES = ['property_events', 'user_comments'];

function parseArgs(argv) {
  const options = { apply: false, dbPath: DEFAULT_DB_PATH, photosBase: DEFAULT_PHOTOS_BASE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--db') options.dbPath = path.resolve(argv[++i] || '');
    else if (arg.startsWith('--db=')) options.dbPath = path.resolve(arg.slice('--db='.length));
    else if (arg === '--photos-dir') options.photosBase = path.resolve(argv[++i] || '');
    else if (arg.startsWith('--photos-dir=')) options.photosBase = path.resolve(arg.slice('--photos-dir='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/migrate-property-identity.js [--apply] [--db PATH] [--photos-dir PATH]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((column) => column.name));
}

function requiredSchema(db) {
  if (!tableExists(db, 'properties')) throw new Error('Table properties does not exist');
  const columns = tableColumns(db, 'properties');
  for (const column of ['id', 'document_id', 'source', 'external_id']) {
    if (!columns.has(column)) throw new Error(`properties.${column} does not exist`);
  }
  return columns;
}

function getInvalidIdentityRows(db) {
  return db.prepare(`
    SELECT id, document_id, source, external_id
    FROM properties
    WHERE source IS NULL OR trim(source) = ''
       OR source <> trim(source)
       OR external_id IS NULL OR trim(external_id) = ''
       OR external_id <> trim(external_id)
    ORDER BY id ASC
  `).all();
}

function getDuplicateGroups(db) {
  return db.prepare(`
    SELECT source, external_id, COUNT(*) AS count
    FROM properties
    WHERE source IS NOT NULL AND trim(source) <> ''
      AND external_id IS NOT NULL AND trim(external_id) <> ''
    GROUP BY source, external_id
    HAVING COUNT(*) > 1
    ORDER BY source ASC, external_id ASC
  `).all();
}

function getRelationAudit(db) {
  const result = {};
  for (const table of RELATION_TABLES) {
    if (!tableExists(db, table)) {
      result[table] = { exists: false, hasPropertyId: false, rows: 0, orphaned: 0 };
      continue;
    }
    const hasPropertyId = tableColumns(db, table).has('property_id');
    if (!hasPropertyId) {
      result[table] = { exists: true, hasPropertyId: false, rows: 0, orphaned: 0 };
      continue;
    }
    const quoted = quoteIdentifier(table);
    const rows = db.prepare(`SELECT COUNT(*) AS count FROM ${quoted} WHERE property_id IS NOT NULL`).get().count;
    const orphaned = db.prepare(`
      SELECT COUNT(*) AS count
      FROM ${quoted} relation
      LEFT JOIN properties property ON property.id = relation.property_id
      WHERE relation.property_id IS NOT NULL AND property.id IS NULL
    `).get().count;
    result[table] = { exists: true, hasPropertyId: true, rows, orphaned };
  }
  return result;
}

function normalizeIndexSql(sql) {
  if (typeof sql !== 'string') return '';
  return sql
    .replace(/["'`\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim()
    .replace(/;$/, '')
    .toLowerCase();
}

function getIndexInfo(db) {
  const index = db.prepare(`PRAGMA index_list(${quoteIdentifier('properties')})`).all()
    .find((candidate) => candidate.name === IDENTITY_INDEX);
  if (!index) return { exists: false, valid: false, columns: [], partial: false, sql: null };
  const columns = db.prepare(`PRAGMA index_info(${quoteIdentifier(IDENTITY_INDEX)})`).all()
    .sort((a, b) => a.seqno - b.seqno)
    .map((column) => column.name);
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(IDENTITY_INDEX);
  const sql = definition?.sql || null;
  const expectedSql = normalizeIndexSql(`CREATE UNIQUE INDEX ${IDENTITY_INDEX} ON properties (source, external_id)`);
  const partial = Number(index.partial) === 1;
  return {
    exists: true,
    valid: Number(index.unique) === 1
      && !partial
      && columns.join(',') === 'source,external_id'
      && normalizeIndexSql(sql) === expectedSql,
    columns,
    partial,
    sql,
  };
}

function audit(db) {
  requiredSchema(db);
  return {
    invalidIdentityRows: getInvalidIdentityRows(db),
    duplicateGroups: getDuplicateGroups(db),
    relationAudit: getRelationAudit(db),
    identityIndex: getIndexInfo(db),
  };
}

function printAudit(report) {
  console.log(`Invalid identity rows: ${report.invalidIdentityRows.length}`);
  for (const row of report.invalidIdentityRows.slice(0, 10)) {
    console.log(`  - id=${row.id} document_id=${row.document_id} source=${JSON.stringify(row.source)} external_id=${JSON.stringify(row.external_id)}`);
  }
  if (report.invalidIdentityRows.length > 10) console.log('  - …');

  console.log(`Duplicate identity groups: ${report.duplicateGroups.length}`);
  for (const group of report.duplicateGroups.slice(0, 10)) {
    console.log(`  - ${group.source}/${group.external_id}: ${group.count}`);
  }
  if (report.duplicateGroups.length > 10) console.log('  - …');

  for (const [table, relation] of Object.entries(report.relationAudit)) {
    console.log(`Relation ${table}: exists=${relation.exists} property_id=${relation.hasPropertyId} rows=${relation.rows} orphaned=${relation.orphaned}`);
  }
  console.log(`Identity index ${IDENTITY_INDEX}: exists=${report.identityIndex.exists} valid=${report.identityIndex.valid} partial=${report.identityIndex.partial} columns=${report.identityIndex.columns.join(',') || '(none)'}`);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function copyDirectoryForKeeper(sourceDir, stagingDir, keeperDir, duplicateDocumentId) {
  const rewrittenPaths = new Map();
  if (!fs.existsSync(sourceDir)) return rewrittenPaths;

  fs.mkdirSync(stagingDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const sourceFile = path.join(sourceDir, entry.name);
    let targetName = entry.name;
    let stagedFile = path.join(stagingDir, targetName);
    let publicTarget = path.join(keeperDir, targetName);
    if (fs.existsSync(publicTarget) || fs.existsSync(stagedFile)) {
      const parsed = path.parse(entry.name);
      targetName = `${duplicateDocumentId}--${parsed.name}${parsed.ext}`;
      stagedFile = path.join(stagingDir, targetName);
      publicTarget = path.join(keeperDir, targetName);
      let suffix = 1;
      while (fs.existsSync(publicTarget) || fs.existsSync(stagedFile)) {
        targetName = `${duplicateDocumentId}--${parsed.name}-${suffix}${parsed.ext}`;
        stagedFile = path.join(stagingDir, targetName);
        publicTarget = path.join(keeperDir, targetName);
        suffix += 1;
      }
    }
    fs.copyFileSync(sourceFile, stagedFile, fs.constants.COPYFILE_EXCL);
    rewrittenPaths.set(`/photos/${duplicateDocumentId}/${entry.name}`, targetName);
  }
  return rewrittenPaths;
}

function stageMediaCopies(groups, photosBase) {
  // Keep every new byte outside api/data/photos until the database transaction
  // commits. A failed DB migration therefore cannot expose keeper files that do
  // not belong to a committed keeper row.
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(photosBase), '.property-identity-media-'));
  const cleanupDirs = [];
  const stagedKeeperDirectories = [];
  const mediaByKeeperId = new Map();
  try {
    for (const group of groups) {
      const [keeper, ...duplicates] = group.rows;
      const keeperDir = path.join(photosBase, keeper.document_id);
      const stagingDir = path.join(stagingRoot, keeper.document_id);
      const current = mediaByKeeperId.get(keeper.id) || { photoUrls: parseJsonArray(keeper.photo_urls), photos: parseJsonArray(keeper.photos), downloaded: Boolean(keeper.photos_downloaded) };
      for (const duplicate of duplicates) {
        const duplicateDir = path.join(photosBase, duplicate.document_id);
        const rewrites = copyDirectoryForKeeper(duplicateDir, stagingDir, keeperDir, duplicate.document_id);
        const duplicatePhotos = parseJsonArray(duplicate.photos).map((photo) => {
          if (typeof photo !== 'string') return photo;
          const targetName = rewrites.get(photo);
          if (targetName) return `/photos/${keeper.document_id}/${targetName}`;
          // Local photo paths are only valid under the duplicate's directory.
          // Do not retain a path that would become dangling after its row is removed.
          if (photo.startsWith(`/photos/${duplicate.document_id}/`)) return null;
          return photo;
        });
        current.photoUrls.push(...parseJsonArray(duplicate.photo_urls));
        current.photos.push(...duplicatePhotos);
        current.downloaded = current.downloaded || Boolean(duplicate.photos_downloaded);
        if (fs.existsSync(duplicateDir)) cleanupDirs.push(duplicateDir);
      }
      current.photoUrls = uniqueValues(current.photoUrls);
      current.photos = uniqueValues(current.photos);
      mediaByKeeperId.set(keeper.id, current);
      stagedKeeperDirectories.push({ stagingDir, keeperDir });
    }
    return { stagingRoot, cleanupDirs, stagedKeeperDirectories, mediaByKeeperId };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function publishStagedMedia(stagedMedia) {
  const createdFiles = [];
  try {
    for (const { stagingDir, keeperDir } of stagedMedia.stagedKeeperDirectories) {
      if (!fs.existsSync(stagingDir)) continue;
      fs.mkdirSync(keeperDir, { recursive: true });
      for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const stagedFile = path.join(stagingDir, entry.name);
        const targetFile = path.join(keeperDir, entry.name);
        // COPYFILE_EXCL prevents a post-staging concurrent writer from being
        // overwritten. The exact manifest makes compensation safe.
        fs.copyFileSync(stagedFile, targetFile, fs.constants.COPYFILE_EXCL);
        createdFiles.push(targetFile);
      }
    }
  } catch (error) {
    for (const targetFile of createdFiles.reverse()) {
      try { fs.rmSync(targetFile, { force: true }); } catch { /* best-effort compensation */ }
    }
    throw new Error(`Committed DB rows but could not publish staged media; source directories were retained and staged copies remain at ${stagedMedia.stagingRoot}: ${error.message}`);
  }

  fs.rmSync(stagedMedia.stagingRoot, { recursive: true, force: true });
  return createdFiles;
}

function loadDuplicateRows(db, duplicateGroups, propertyColumns) {
  const selectedColumns = ['id', 'document_id'];
  for (const column of ['photo_urls', 'photos', 'photos_downloaded']) {
    if (propertyColumns.has(column)) selectedColumns.push(column);
  }
  const select = selectedColumns.map(quoteIdentifier).join(', ');
  const getRows = db.prepare(`
    SELECT ${select}
    FROM properties
    WHERE source = ? AND external_id = ?
    ORDER BY id ASC
  `);
  return duplicateGroups.map((group) => ({
    ...group,
    rows: getRows.all(group.source, group.external_id),
  }));
}

function ensureRelationColumnsAndIndexes(db) {
  for (const table of RELATION_TABLES) {
    if (!tableExists(db, table)) continue;
    if (!tableColumns(db, table).has('property_id')) {
      db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN property_id INTEGER`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${table}_property_id_idx`)} ON ${quoteIdentifier(table)} (property_id)`);
  }
}

function ensureIdentityGuards(db) {
  const current = getIndexInfo(db);
  if (current.exists && !current.valid) {
    db.exec(`DROP INDEX ${quoteIdentifier(IDENTITY_INDEX)}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(IDENTITY_INDEX)} ON properties (source, external_id)`);

  // Triggers must be recreated rather than CREATE IF NOT EXISTS: an earlier
  // version only rejected blanks and would otherwise leave non-canonical
  // whitespace values writable.
  db.exec('DROP TRIGGER IF EXISTS properties_identity_required_insert');
  db.exec('DROP TRIGGER IF EXISTS properties_identity_required_update');
  db.exec(`
    CREATE TRIGGER properties_identity_required_insert
    BEFORE INSERT ON properties
    FOR EACH ROW
    WHEN NEW.source IS NULL OR trim(NEW.source) = '' OR NEW.source <> trim(NEW.source)
      OR NEW.external_id IS NULL OR trim(NEW.external_id) = '' OR NEW.external_id <> trim(NEW.external_id)
    BEGIN
      SELECT RAISE(ABORT, 'properties.source and properties.external_id must be non-empty and trimmed');
    END
  `);
  db.exec(`
    CREATE TRIGGER properties_identity_required_update
    BEFORE UPDATE OF source, external_id ON properties
    FOR EACH ROW
    WHEN NEW.source IS NULL OR trim(NEW.source) = '' OR NEW.source <> trim(NEW.source)
      OR NEW.external_id IS NULL OR trim(NEW.external_id) = '' OR NEW.external_id <> trim(NEW.external_id)
    BEGIN
      SELECT RAISE(ABORT, 'properties.source and properties.external_id must be non-empty and trimmed');
    END
  `);
}

function migrateDatabase(db, photosBase) {
  const propertyColumns = requiredSchema(db);
  const before = audit(db);
  if (before.invalidIdentityRows.length > 0) {
    throw new Error('Migration aborted: rows with missing or non-trimmed source/external_id need explicit manual remediation; no data was changed');
  }

  const groups = loadDuplicateRows(db, before.duplicateGroups, propertyColumns);
  // Staging is intentionally non-public and happens before the SQL
  // transaction. If staging fails, database rows and source directories remain
  // untouched; if SQL fails, the staging directory is removed below.
  const stagedMedia = stageMediaCopies(groups, photosBase);
  let committed = false;
  let createdMediaFiles = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    ensureRelationColumnsAndIndexes(db);
    const updateRelation = {};
    for (const table of RELATION_TABLES) {
      if (tableExists(db, table) && tableColumns(db, table).has('property_id')) {
        updateRelation[table] = db.prepare(`UPDATE ${quoteIdentifier(table)} SET property_id = ? WHERE property_id = ?`);
      }
    }
    const supportsMedia = propertyColumns.has('photo_urls') && propertyColumns.has('photos') && propertyColumns.has('photos_downloaded');
    const updateMedia = supportsMedia ? db.prepare(`
      UPDATE properties
      SET photo_urls = ?, photos = ?, photos_downloaded = ?
      WHERE id = ?
    `) : null;
    const deleteProperty = db.prepare('DELETE FROM properties WHERE id = ?');

    for (const group of groups) {
      const [keeper, ...duplicates] = group.rows;
      for (const duplicate of duplicates) {
        for (const table of Object.keys(updateRelation)) updateRelation[table].run(keeper.id, duplicate.id);
        deleteProperty.run(duplicate.id);
      }
      if (updateMedia) {
        const media = stagedMedia.mediaByKeeperId.get(keeper.id);
        if (media) updateMedia.run(JSON.stringify(media.photoUrls), JSON.stringify(media.photos), media.downloaded ? 1 : 0, keeper.id);
      }
    }

    // This runs under BEGIN IMMEDIATE, so an invalid named index is dropped and
    // recreated atomically with relation moves and duplicate deletion.
    ensureIdentityGuards(db);
    const after = audit(db);
    if (after.invalidIdentityRows.length || after.duplicateGroups.length || !after.identityIndex.valid) {
      throw new Error('Post-migration integrity check failed');
    }
    for (const [table, relation] of Object.entries(after.relationAudit)) {
      if (relation.orphaned > 0) throw new Error(`Post-migration relation check failed: ${table} has ${relation.orphaned} orphaned rows`);
    }
    // Publish while the SQL transaction is still open. If publication or COMMIT
    // fails, the catch below compensates every newly created public file before
    // exposing a rollback state; source duplicate dirs are retained.
    createdMediaFiles = publishStagedMedia(stagedMedia);
    db.exec('COMMIT');
    committed = true;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    for (const targetFile of createdMediaFiles.reverse()) {
      try { fs.rmSync(targetFile, { force: true }); } catch { /* best-effort compensation */ }
    }
    // Nothing has been published to api/data/photos before commit; clear the
    // non-public staging area so a failed DB operation leaves no keeper files.
    if (!committed) fs.rmSync(stagedMedia.stagingRoot, { recursive: true, force: true });
    throw error;
  }

  // Source duplicate directories are deleted only after both the DB commit and
  // the staged-media publication have succeeded.
  let cleanupFailures = 0;
  for (const duplicateDir of stagedMedia.cleanupDirs) {
    try {
      fs.rmSync(duplicateDir, { recursive: true, force: true });
    } catch (error) {
      cleanupFailures += 1;
      console.warn(`WARNING: DB migration committed, but orphaned duplicate photo dir was retained: ${duplicateDir} (${error.message})`);
    }
  }
  return { duplicateGroups: groups.length, duplicateRows: groups.reduce((total, group) => total + group.rows.length - 1, 0), copiedPhotoFiles: createdMediaFiles.length, copiedPhotoDirs: stagedMedia.cleanupDirs.length, cleanupFailures };
}

async function createBackup(db, dbPath) {
  const backupDir = path.join(path.dirname(dbPath), '.integrity-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `data.db.pre-property-identity-${timestamp}`);
  await db.backup(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error(`Backup verification failed: ${backupPath}`);
  }
  return backupPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.dbPath)) throw new Error(`Database not found: ${options.dbPath}`);

  const db = new Database(options.dbPath, { readonly: !options.apply });
  try {
    db.pragma('busy_timeout = 5000');
    console.log(`Mode: ${options.apply ? 'APPLY' : 'AUDIT ONLY'}`);
    console.log(`Database: ${options.dbPath}`);
    console.log(`Photos: ${options.photosBase}`);
    const report = audit(db);
    printAudit(report);

    if (!options.apply) {
      console.log('No changes made. Re-run with --apply only during a maintenance window after stopping API/workers.');
      return;
    }

    if (report.invalidIdentityRows.length > 0) {
      throw new Error('Apply refused because source/external_id is missing or non-trimmed for existing rows; inspect audit output and remediate explicitly');
    }
    const backupPath = await createBackup(db, options.dbPath);
    console.log(`Verified backup: ${backupPath}`);
    const result = migrateDatabase(db, options.photosBase);
    console.log(`Migration complete: duplicate groups=${result.duplicateGroups}, duplicate rows=${result.duplicateRows}, copied photo files=${result.copiedPhotoFiles}, copied photo dirs=${result.copiedPhotoDirs}, cleanup failures=${result.cleanupFailures}`);
    printAudit(audit(db));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Property identity migration failed: ${error.message}`);
  process.exitCode = 1;
});
