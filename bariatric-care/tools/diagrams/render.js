/**
 * Renders each diagram's SVG to a 2x PNG with Chromium.
 *
 * 2x because these are embedded in a Word document at roughly 6.5 inches wide
 * and printed; at 1x the 9pt annotation text turns to mush on paper.
 *
 *   node tools/diagrams/render.js            # all
 *   node tools/diagrams/render.js d1 d3      # by name prefix
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const OUT = path.join(__dirname, '..', '..', 'docs', 'assets');
const SCALE = 2;

const MODULES = ['./diagrams-core.js', './diagrams-product.js', './diagrams-arch.js', './diagrams-access.js', './diagrams-domain.js'];

function collect() {
  const out = [];
  for (const m of MODULES) {
    let mod;
    try { mod = require(m); } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && e.message.includes(m.replace('./', ''))) continue;
      throw e;
    }
    for (const k of Object.keys(mod)) out.push(mod[k]());
  }
  return out;
}

(async () => {
  const filter = process.argv.slice(2);
  const all = collect();
  const picked = filter.length ? all.filter((d) => filter.some((f) => d.name.startsWith(f))) : all;
  if (!picked.length) { console.error('no diagrams matched', filter); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: SCALE });

  for (const d of picked) {
    await page.setViewportSize({ width: d.w, height: d.h });
    // data: URL rather than a temp file so nothing is left behind on failure.
    await page.goto('data:image/svg+xml;base64,' + Buffer.from(d.svg).toString('base64'));
    const file = path.join(OUT, d.name + '.png');
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: d.w, height: d.h } });
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`${d.name.padEnd(26)} ${d.w}x${d.h} @${SCALE}x  ${kb} KB`);
  }
  await browser.close();
})();
