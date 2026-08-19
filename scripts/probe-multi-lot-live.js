#!/usr/bin/env node
/**
 * Readonly live probe for multi-lot audit (docs/plan-lots-audit.md).
 * Does NOT write to DB. Outputs JSON summary to stdout.
 *
 * Usage: node scripts/probe-multi-lot-live.js [--only=m-ets,alfalot,...]
 */
const { chromium } = require('playwright');

const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '')
  .replace('--only=', '')
  .split(',')
  .filter(Boolean);

function shouldRun(name) {
  return ONLY.length === 0 || ONLY.includes(name);
}

const URLS = {
  mets: process.env.M_ETS_BASE_URL || 'https://m-ets.ru',
  alfalot: process.env.ALFALOT_BASE_URL || 'https://ecosystem.alfalot.ru',
  aggregator: process.env.AGGREGATOR_BANKROT_BASE_URL || 'https://xn----etbpba5admdlad.xn--p1ai',
  sberbank: process.env.SBERBANK_AST_BASE_URL || 'https://utp.sberbank-ast.ru',
  investmoscow: process.env.INVESTMOSCOW_BASE_URL || 'https://investmoscow.ru',
  investMosreg: process.env.INVEST_MOSREG_BASE_URL || 'https://invest.mosreg.ru',
};

const METS_CATEGORIES = '34,35,36,37,38,39,40,41';

async function probeMets(context) {
  const page = await context.newPage();
  const base = URLS.mets.replace(/\/$/, '');
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);

  const lotUrls = [];
  for (let pageNum = 1; pageNum <= 5 && lotUrls.length < 40; pageNum++) {
    const apiUrl = `${base}/ajax/api/search?category=${METS_CATEGORIES}&page=${pageNum}`;
    const response = await page.evaluate(async (url) => {
      const resp = await fetch(url);
      return resp.json();
    }, apiUrl);
    if (!response?.data?.length) break;
    for (const item of response.data) {
      const href = await page.evaluate((htmlFragment) => {
        const doc = new DOMParser().parseFromString(htmlFragment, 'text/html');
        return doc.querySelector('a[href]')?.getAttribute('href') || '';
      }, item.data);
      if (!href) continue;
      const full = href.startsWith('http') ? href : `${base}/${href.replace(/^\//, '')}`;
      lotUrls.push(full);
    }
  }

  const samples = [];
  let maxInfoBlocks = 0;
  let multiBlockLotUrl = null;

  for (const lotUrl of lotUrls.slice(0, 25)) {
    try {
      await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500);
      const stats = await page.evaluate(() => {
        const infoBlocks = document.querySelectorAll('.lot-info-block.info-type_1');
        const lotSections = document.querySelectorAll('[data-lot-id]');
        const pricedBlocks = Array.from(infoBlocks).filter((block) => (
          Boolean(block.closest('[itemscope]')?.querySelector('meta[itemprop="price"]'))
        ));
        const regions = [];
        for (const block of Array.from(infoBlocks)) {
          for (const item of Array.from(block.querySelectorAll('.lot-info-item'))) {
            const label = (item.querySelector('.title')?.textContent || '').trim();
            if (label.includes('Регион местонахождения')) {
              regions.push((item.querySelector('.value')?.textContent || '').trim());
            }
          }
        }
        return {
          infoType1Count: infoBlocks.length,
          pricedBlockCount: pricedBlocks.length,
          dataLotIdSections: lotSections.length,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
          regions: [...new Set(regions)].filter(Boolean),
        };
      });
      maxInfoBlocks = Math.max(maxInfoBlocks, stats.infoType1Count);
      if (stats.infoType1Count > 1 && !multiBlockLotUrl) {
        multiBlockLotUrl = lotUrl;
      }
      if (stats.infoType1Count > 1 || stats.dataLotIdSections > 1) {
        samples.push({ lotUrl, ...stats });
      }
    } catch (err) {
      samples.push({ lotUrl, error: err.message });
    }
  }

  await page.close();
  const multiBlockPages = samples.filter((s) => s.infoType1Count > 1);
  const scopedOk = multiBlockPages.every((s) => s.pricedBlockCount === 1);
  return {
    slug: 'm-ets',
    scannedLotUrls: Math.min(25, lotUrls.length),
    maxInfoType1Blocks: maxInfoBlocks,
    multiBlockLotUrl,
    multiBlockSamples: samples,
    verdict: maxInfoBlocks <= 1
      ? 'ok — lot-URL renders single info-type_1 block'
      : scopedOk
        ? 'fix-scope confirmed — multi-lot trade exposes sibling blocks; itemscope meta price selects current lot'
        : 'fix-scope needed — multi-lot page without unique priced block',
  };
}

async function probeAlfalot(context) {
  const page = await context.newPage();
  const base = URLS.alfalot.replace(/\/$/, '');
  const searchUrl = `${base}/showcase/list?categories=1`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(4000);

  const lotLinks = await page.evaluate((origin) => {
    return Array.from(document.querySelectorAll('.lot-card .card-info > a.font-bold'))
      .map((a) => {
        const href = a.getAttribute('href') || '';
        return href.startsWith('http') ? href : `${origin}${href}`;
      })
      .slice(0, 20);
  }, base);

  const samples = [];
  let maxLocationBlocks = 0;

  for (const lotUrl of lotLinks.slice(0, 15)) {
    try {
      await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      const stats = await page.evaluate(() => ({
        locationBlocks: document.querySelectorAll('.location-block').length,
        lotInfoTabs: document.querySelectorAll('.tab-content[data-page="lot-info"]').length,
        addresses: Array.from(document.querySelectorAll('.location-block > p.address'))
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean),
      }));
      maxLocationBlocks = Math.max(maxLocationBlocks, stats.locationBlocks);
      if (stats.locationBlocks > 1 || stats.lotInfoTabs > 1) {
        samples.push({ lotUrl, ...stats });
      }
    } catch (err) {
      samples.push({ lotUrl, error: err.message });
    }
  }

  await page.close();
  return {
    slug: 'alfalot',
    scannedLotUrls: Math.min(15, lotLinks.length),
    maxLocationBlocks,
    multiBlockSamples: samples,
    verdict: maxLocationBlocks <= 1 && samples.length === 0
      ? 'ok — lot detail page is single-lot scoped'
      : 'fix-scope — multiple property blocks on lot detail',
  };
}

async function probeAggregator(context) {
  const page = await context.newPage();
  const base = URLS.aggregator.replace(/\/$/, '');
  const searchUrl = `${base}/search?trades-section%5B0%5D=commercial&history_only=0`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);

  const lotLinks = await page.evaluate(() => Array.from(document.querySelectorAll('h3.card__title a'))
    .map((a) => a.href)
    .slice(0, 20));

  const samples = [];
  let maxInfoPanels = 0;

  for (const lotUrl of lotLinks.slice(0, 15)) {
    try {
      await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      await page.waitForFunction(() => document.querySelector('#info'), { timeout: 15000 }).catch(() => null);
      const stats = await page.evaluate(() => {
        const infoPanels = document.querySelectorAll('#info');
        const regionRows = [];
        for (const row of Array.from(document.querySelectorAll('#info .panel__wrapper p'))) {
          const label = (row.querySelector('span.text-grey')?.textContent || '').trim();
          if (/регион/i.test(label)) {
            regionRows.push((row.querySelector('span.js-share-search')?.textContent || '').trim());
          }
        }
        return {
          infoPanelCount: infoPanels.length,
          regionValues: [...new Set(regionRows)].filter(Boolean),
        };
      });
      maxInfoPanels = Math.max(maxInfoPanels, stats.infoPanelCount);
      if (stats.infoPanelCount > 1 || stats.regionValues.length > 1) {
        samples.push({ lotUrl, ...stats });
      }
    } catch (err) {
      samples.push({ lotUrl, error: err.message });
    }
  }

  await page.close();
  return {
    slug: 'aggregator-bankrot',
    scannedLotUrls: Math.min(15, lotLinks.length),
    maxInfoPanels,
    multiBlockSamples: samples,
    verdict: maxInfoPanels <= 1 && samples.length === 0
      ? 'ok — lot detail has single #info panel'
      : 'fix-scope — multiple #info panels or region rows',
  };
}

async function probeSberbank(context) {
  const page = await context.newPage();
  const searchUrl = `${URLS.sberbank.replace(/\/$/, '')}/Property/List/BidListComReal`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);

  const xmlStats = await page.evaluate(() => {
    const input = document.getElementById('xmlData');
    if (!input?.value) return { error: 'no xmlData' };
    const xmlDoc = new DOMParser().parseFromString(input.value, 'text/xml');
    const rows = Array.from(xmlDoc.querySelectorAll('_source'));
    const byPurchase = new Map();
    for (const row of rows) {
      const purchaseId = row.querySelector('PurchaseId')?.textContent?.trim() || '';
      const bidName = row.querySelector('BidName')?.textContent?.trim() || '';
      const geo = row.querySelector('GeoDataAddress')?.textContent?.trim()
        || row.querySelector('textAddress')?.textContent?.trim() || '';
      if (!purchaseId) continue;
      const entry = byPurchase.get(purchaseId) || { count: 0, bids: [], geos: [] };
      entry.count += 1;
      if (bidName) entry.bids.push(bidName.slice(0, 80));
      if (geo) entry.geos.push(geo.slice(0, 80));
      byPurchase.set(purchaseId, entry);
    }
    const duplicates = [...byPurchase.entries()]
      .filter(([, v]) => v.count > 1)
      .slice(0, 5)
      .map(([purchaseId, v]) => ({ purchaseId, ...v }));
    return {
      rowCount: rows.length,
      uniquePurchaseIds: byPurchase.size,
      duplicatePurchaseSamples: duplicates,
    };
  });

  await page.close();
  const needsFix = (xmlStats.duplicatePurchaseSamples || []).length > 0;
  return {
    slug: 'sberbank-ast',
    ...xmlStats,
    verdict: needsFix
      ? 'fix-split? — same PurchaseId appears in multiple listing rows'
      : 'ok — listing XML row is 1:1 with purchase/lot identity',
  };
}

async function probeInvestmoscow() {
  const category = 'prodazha-dlya-biznesa-nezhiloe-pomeshchenie';
  const url = `${URLS.investmoscow.replace(/\/$/, '')}/tenders/${category}`;
  const resp = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (compatible; aklab-probe/1.0)',
    },
  });
  const html = await resp.text();
  const match = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    return { slug: 'investmoscow', error: 'no __NUXT_DATA__', verdict: 'inconclusive' };
  }
  const data = JSON.parse(match[1]);
  const tenderLike = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const keys = Object.keys(item);
    if (keys.includes('startPrice') && keys.includes('objectArea') && keys.includes('id')) {
      tenderLike.push({ index: i, keyCount: keys.length, hasAddressKey: keys.includes('address') });
    }
  }
  return {
    slug: 'investmoscow',
    httpStatus: resp.status,
    tenderCandidates: tenderLike.length,
    note: 'SSR payload: one tender entity → one external_id (investmoscow-{id}); no fetchDetails multi-lot path',
    verdict: 'ok — source limitation: 1 tender = 1 Property; multi-address bundle would be product decision',
  };
}

async function probeInvestMosreg() {
  const base = URLS.investMosreg.replace(/\/$/, '');
  const menuIds = [245, 287, 1008];
  const places = [];
  for (const menuId of menuIds) {
    const url = `${base}/aapi/map/places/?menu_id=${menuId}`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; aklab-probe/1.0)' },
    });
    if (!resp.ok) continue;
    const json = await resp.json();
    const batch = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    for (const place of batch.slice(0, 30)) {
      places.push({
        uid: place.uid || place.id,
        name: (place.name || '').slice(0, 60),
        fieldCount: Array.isArray(place.fields) ? place.fields.length : 0,
        addressFields: Array.isArray(place.fields)
          ? place.fields.filter((f) => /адрес/i.test(f.name || '')).map((f) => (f.value || '').slice(0, 60))
          : [],
      });
    }
  }
  const multiAddress = places.filter((p) => p.addressFields.length > 1);
  return {
    slug: 'invest-mosreg',
    sampledPlaces: places.length,
    multiAddressPlaces: multiAddress.length,
    multiAddressSamples: multiAddress.slice(0, 3),
    verdict: multiAddress.length === 0
      ? 'ok — API place uid/id is one map object with at most one address field'
      : 'review — place carries multiple address fields',
  };
}

(async () => {
  const results = { probedAt: new Date().toISOString(), probes: [] };
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'ru-RU',
  });

  try {
    if (shouldRun('m-ets')) {
      try { results.probes.push(await probeMets(context)); }
      catch (err) { results.probes.push({ slug: 'm-ets', error: err.message, verdict: 'probe_failed' }); }
    }
    if (shouldRun('alfalot')) {
      try { results.probes.push(await probeAlfalot(context)); }
      catch (err) { results.probes.push({ slug: 'alfalot', error: err.message, verdict: 'probe_failed' }); }
    }
    if (shouldRun('aggregator-bankrot')) {
      try { results.probes.push(await probeAggregator(context)); }
      catch (err) { results.probes.push({ slug: 'aggregator-bankrot', error: err.message, verdict: 'probe_failed' }); }
    }
    if (shouldRun('sberbank-ast')) {
      try { results.probes.push(await probeSberbank(context)); }
      catch (err) { results.probes.push({ slug: 'sberbank-ast', error: err.message, verdict: 'probe_failed' }); }
    }
  } finally {
    await browser.close();
  }

  if (shouldRun('investmoscow')) {
    try { results.probes.push(await probeInvestmoscow()); }
    catch (err) { results.probes.push({ slug: 'investmoscow', error: err.message, verdict: 'probe_failed' }); }
  }
  if (shouldRun('invest-mosreg')) {
    try { results.probes.push(await probeInvestMosreg()); }
    catch (err) { results.probes.push({ slug: 'invest-mosreg', error: err.message, verdict: 'probe_failed' }); }
  }

  console.log(JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
