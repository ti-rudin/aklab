/**
 * Скрипт удаления дубликатов properties на проде.
 * Оставляет самый ранний (первый) объект из каждой группы source + external_id.
 * 
 * Запуск на сервере:
 *   cd ~/aklab && node scripts/dedup-properties.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'api', '.tmp', 'data.db');
const PHOTOS_BASE = path.join(__dirname, '..', 'api', 'data', 'photos');

const db = new Database(DB_PATH, { readonly: false });

// Находим дубликаты
const dups = db.prepare(`
  SELECT source, external_id, count(*) as cnt
  FROM properties
  GROUP BY source, external_id
  HAVING cnt > 1
  ORDER BY cnt DESC
`).all();

console.log(`Found ${dups.length} groups with duplicates`);

let totalDeleted = 0;
let photosDeleted = 0;

const deleteStmt = db.prepare('DELETE FROM properties WHERE document_id = ?');
const getDupsStmt = db.prepare(`
  SELECT document_id, id FROM properties
  WHERE source = ? AND external_id = ?
  ORDER BY id ASC
`);

const transaction = db.transaction(() => {
  for (const dup of dups) {
    const rows = getDupsStmt.all(dup.source, dup.external_id);
    // Оставляем первый (самый ранний), удаляем остальные
    const toDelete = rows.slice(1);

    for (const row of toDelete) {
      deleteStmt.run(row.document_id);
      totalDeleted++;

      // Удаляем фото с диска
      const photoDir = path.join(PHOTOS_BASE, row.document_id);
      if (fs.existsSync(photoDir)) {
        fs.rmSync(photoDir, { recursive: true, force: true });
        photosDeleted++;
      }
    }
  }
});

transaction();

console.log(`Deleted ${totalDeleted} duplicate properties`);
console.log(`Deleted ${photosDeleted} photo directories`);

// Проверяем остатки
const remaining = db.prepare('SELECT count(*) as cnt FROM properties').get();
const unique = db.prepare('SELECT count(DISTINCT source || external_id) as cnt FROM properties').get();
console.log(`Remaining: ${remaining.cnt} properties (${unique.cnt} unique)`);

db.close();
