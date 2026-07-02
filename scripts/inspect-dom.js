#!/usr/bin/env node
/**
 * DOM inspector — проверяет реальные селекторы на сайтах парсеров.
 * Запускать на сервере: node inspect-dom.js
 */
const { chromium } = require('playwright');

const SITES = [
  { name: 'm-ets', url: 'https://m-ets.ru', waitFor: 8000 },
  { name: 'invest-mosreg', url: 'https://invest.mosreg.ru/investicyonnaya-karta/obekty', waitFor: 8000 },
  { name: 'roseltorg', url: 'https://roseltorg.ru', waitFor: 8000 },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const site of SITES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== ${site.name} (${site.url}) ===`);
    
    try {
      const page = await browser.newPage();
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(site.waitFor);
      
      const title = await page.title();
      console.log(`Title: ${title}`);
      
      // Ищем карточки по разным селекторам
      const selectors = [
        '.card', '.lot-card', '.trade-card', '.search-result',
        '.list-item', 'article', 'tr', '[class*="card"]', '[class*="lot"]',
        '[class*="item"]', '[class*="product"]', '[class*="offer"]',
        '.table tbody tr', 'table tr', '.results li', '.catalog-item',
        '[data-id]', '[data-lot]', '[data-item]',
      ];
      
      for (const sel of selectors) {
        try {
          const count = await page.locator(sel).count();
          if (count > 0) {
            const sample = await page.locator(sel).first().textContent();
            console.log(`  ${sel}: ${count} elements | sample: ${(sample || '').trim().slice(0, 100)}`);
          }
        } catch {}
      }
      
      // Ссылки на лоты/объекты
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 50) }))
          .filter(l => /lot|trade|offer|property|object|catalog|item|detail/i.test(l.href))
          .slice(0, 10);
      });
      if (links.length > 0) {
        console.log('  Relevant links:');
        links.forEach(l => console.log(`    ${l.href} — ${l.text}`));
      }
      
      // Все class-ы на странице
      const classes = await page.evaluate(() => {
        const all = new Set();
        document.querySelectorAll('*').forEach(el => {
          el.classList.forEach(c => { if (c.length > 2) all.add(c); });
        });
        return [...all].sort().slice(0, 50);
      });
      console.log(`  CSS classes (top 50): ${classes.join(', ')}`);
      
      await page.close();
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }

  await browser.close();
})();
