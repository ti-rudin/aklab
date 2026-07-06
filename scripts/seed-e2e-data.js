/**
 * Seed test data for E2E tests.
 * Idempotent — checks for existing external_ids before inserting.
 * Run: ssh server + node /tmp/seed-test-data.js
 */
const path = require('path');
const dbPath = path.join(__dirname, '..', 'api', '.tmp', 'data.db');
const db = require(path.join(__dirname, '..', 'api', 'node_modules', 'better-sqlite3'))(dbPath);

function makeDocId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 25; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const now = Date.now();

const properties = [
  // Moscow — office (6)
  { title: 'Офис 120 м², Центр', address: 'г. Москва, ул. Тверская, д. 1', city: 'moscow', type: 'office', area: 120, price: 15000000, score: 85, dev: -45, status: 'new', tags: ['undervalued','msk_mo'], lat: 55.76, lng: 37.60 },
  { title: 'Офис 85 м², Арбат', address: 'г. Москва, ул. Арбат, д. 15', city: 'moscow', type: 'office', area: 85, price: 12000000, score: 72, dev: -30, status: 'new', tags: ['undervalued'], lat: 55.75, lng: 37.59 },
  { title: 'Офис 200 м², Марьино', address: 'г. Москва, ул. Братиславская, д. 3', city: 'moscow', type: 'office', area: 200, price: 25000000, score: 55, dev: -22, status: 'new', tags: ['undervalued','large_area'], lat: 55.66, lng: 37.75 },
  { title: 'Офис 60 м², Сокол', address: 'г. Москва, ул. Алабяна, д. 7', city: 'moscow', type: 'office', area: 60, price: 9500000, score: 40, dev: -10, status: 'in_progress', tags: [], lat: 55.80, lng: 37.51 },
  { title: 'Офис 150 м², Беговая', address: 'г. Москва, ул. Беговая, д. 22', city: 'moscow', type: 'office', area: 150, price: 32000000, score: 30, dev: 5, status: 'viewed', tags: [], lat: 55.77, lng: 37.54 },
  { title: 'Офис 90 м², Текстильщики', address: 'г. Москва, Волгоградский пр-т, д. 45', city: 'moscow', type: 'office', area: 90, price: 8000000, score: 65, dev: -35, status: 'new', tags: ['undervalued','auction'], min_price: 6000000, lat: 55.71, lng: 37.73 },

  // Moscow — warehouse (3)
  { title: 'Склад 500 м², МКАД', address: 'г. Москва, Новорязанская ул., д. 8', city: 'moscow', type: 'warehouse', area: 500, price: 45000000, score: 78, dev: -50, status: 'new', tags: ['undervalued','large_area','auction'], min_price: 35000000, lat: 55.78, lng: 37.66 },
  { title: 'Склад 300 м², Южный порт', address: 'г. Москва, ул. Южнопортовая, д. 12', city: 'moscow', type: 'warehouse', area: 300, price: 28000000, score: 60, dev: -25, status: 'in_progress', tags: ['undervalued'], lat: 55.71, lng: 37.68 },
  { title: 'Склад 180 м², Капотня', address: 'г. Москва, ул. Капотня, д. 5', city: 'moscow', type: 'warehouse', area: 180, price: 14000000, score: 35, dev: -5, status: 'viewed', tags: [], lat: 55.64, lng: 37.80 },

  // Moscow — retail (1)
  { title: 'Торговое 70 м², Арбат', address: 'г. Москва, Старый Арбат, д. 18', city: 'moscow', type: 'retail', area: 70, price: 20000000, score: 90, dev: -55, status: 'new', tags: ['undervalued','auction'], min_price: 15000000, lat: 55.75, lng: 37.59 },

  // MO (5)
  { title: 'Офис 100 м², Мытищи', address: 'МО, г. Мытищи, ул. Колонцова, д. 3', city: 'mo', type: 'office', area: 100, price: 7000000, score: 70, dev: -28, status: 'new', tags: ['undervalued','msk_mo'], lat: 55.91, lng: 37.76 },
  { title: 'Склад 400 м², Подольск', address: 'МО, г. Подольск, ул. Б. Серпуховская, д. 42', city: 'mo', type: 'warehouse', area: 400, price: 22000000, score: 62, dev: -32, status: 'new', tags: ['undervalued','large_area'], lat: 55.43, lng: 37.55 },
  { title: 'Торговое 150 м², Одинцово', address: 'МО, г. Одинцово, ул. Маршала Жукова, д. 5', city: 'mo', type: 'retail', area: 150, price: 18000000, score: 48, dev: -15, status: 'in_progress', tags: [], lat: 55.68, lng: 37.28 },
  { title: 'Свободного назн. 250 м², Химки', address: 'МО, г. Химки, ул. Ленинградская, д. 14', city: 'mo', type: 'free_purpose', area: 250, price: 16000000, score: 55, dev: -20, status: 'in_progress', tags: ['undervalued'], lat: 55.90, lng: 37.45 },
  { title: 'Производство 350 м², Люберцы', address: 'МО, г. Люберцы, ул. Красная, д. 21', city: 'mo', type: 'industrial', area: 350, price: 20000000, score: 42, dev: -12, status: 'viewed', tags: [], lat: 55.68, lng: 37.89 },

  // SPB (3)
  { title: 'Офис 110 м², Невский', address: 'г. Санкт-Петербург, Невский пр-т, д. 48', city: 'spb', type: 'office', area: 110, price: 14000000, score: 75, dev: -38, status: 'new', tags: ['undervalued'], lat: 59.93, lng: 30.36 },
  { title: 'Склад 280 м², Приморский', address: 'г. Санкт-Петербург, Шкиперский проток, д. 10', city: 'spb', type: 'warehouse', area: 280, price: 19000000, score: 58, dev: -22, status: 'in_progress', tags: ['undervalued'], lat: 59.98, lng: 30.24 },
  { title: 'Торговое 95 м², Васька', address: 'г. Санкт-Петербург, 10-я линия ВО, д. 25', city: 'spb', type: 'retail', area: 95, price: 11000000, score: 45, dev: -10, status: 'rejected', tags: [], lat: 59.94, lng: 30.28 },

  // Krasnodar (2)
  { title: 'Склад 220 м², Краснодар', address: 'г. Краснодар, ул. Красная, д. 100', city: 'krasnodar', type: 'warehouse', area: 220, price: 8500000, score: 50, dev: -18, status: 'new', tags: [], lat: 45.04, lng: 38.98 },
  { title: 'Офис 75 м², Краснодар', address: 'г. Краснодар, ул. Северная, д. 290', city: 'krasnodar', type: 'office', area: 75, price: 5500000, score: 38, dev: -8, status: 'rejected', tags: [], lat: 45.06, lng: 38.95 },

  // EKB (2)
  { title: 'Производство 450 м², Екатеринбург', address: 'г. Екатеринбург, ул. Малышева, д. 42', city: 'ekb', type: 'industrial', area: 450, price: 16000000, score: 68, dev: -40, status: 'new', tags: ['undervalued','large_area','auction'], min_price: 12000000 },
  { title: 'Свободного назн. 180 м², Екатеринбург', address: 'г. Екатеринбург, ул. Белинского, д. 56', city: 'ekb', type: 'free_purpose', area: 180, price: 7200000, score: 42, dev: -12, status: 'in_progress', tags: [] },

  // Other (3)
  { title: 'Торговое 130 м², Нижний Новгород', address: 'г. Нижний Новгород, ул. Б. Покровская, д. 15', city: 'other', type: 'retail', area: 130, price: 9000000, score: 52, dev: -20, status: 'new', tags: ['undervalued'] },
  { title: 'Производство 300 м², Тула', address: 'г. Тула, ул. Советская, д. 3', city: 'other', type: 'industrial', area: 300, price: 10000000, score: 44, dev: -15, status: 'viewed', tags: [] },
  { title: 'Свободного назн. 160 м², Калуга', address: 'г. Калуга, ул. Кирова, д. 8', city: 'other', type: 'free_purpose', area: 160, price: 6000000, score: 32, dev: 2, status: 'rejected', tags: [] },
];

const sources = ['fabrikant', 'torgi-gov', 'sberbank-ast', 'alfalot'];

const insert = db.prepare(`
  INSERT INTO properties (
    document_id, source, external_id, url, title, address, city, area_sqm,
    price, price_per_sqm, property_type, auction_type, status, is_undervalued,
    deviation_percent, focus_score, tags, minimum_price, latitude, longitude,
    description, created_at, updated_at, photos_downloaded
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?
  )
`);

let inserted = 0;
const checkExisting = db.prepare("SELECT id FROM properties WHERE external_id = ?");

const insertAll = db.transaction(() => {
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    const extId = `e2e-test-${String(i + 1).padStart(3, '0')}`;

    if (checkExisting.get(extId)) continue;

    const ppsqm = Math.round(p.price / p.area);
    const src = sources[i % sources.length];
    const docId = makeDocId();
    const url = `https://example.com/lot/${extId}`;
    const auctionType = p.min_price ? 'english' : null;
    const isUndervalued = p.dev < -20 ? 1 : 0;
    const tags = p.tags && p.tags.length ? JSON.stringify(p.tags) : '[]';

    insert.run(
      docId, src, extId, url, p.title, p.address, p.city, p.area,
      p.price, ppsqm, p.type, auctionType, p.status, isUndervalued,
      p.dev, p.score, tags, p.min_price || null, p.lat || null, p.lng || null,
      `Тестовый объект ${i + 1} для E2E тестов`, now, now, 0
    );
    inserted++;
  }
});

insertAll();

const total = db.prepare("SELECT COUNT(*) as cnt FROM properties").get();
console.log(`✅ Inserted ${inserted} test properties. Total in DB: ${total.cnt}`);
