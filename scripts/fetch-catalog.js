// Fetches all products from the Squarespace Commerce API and writes catalog.json,
// keyed by variant UUID — the format Meta Commerce sends in checkout URLs.
//
// Usage:
//   1. Copy .env.example to .env and fill in SQUARESPACE_API_KEY
//   2. node scripts/fetch-catalog.js
//   3. git add catalog.json && git commit && git push
//
// The inject script on the Squarespace site fetches catalog.json from the GitHub
// raw URL on page load, so a git push is all that's needed to update the catalog.

const fs = require('fs');
const path = require('path');

// Load .env if present
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
} catch {}

const API_KEY = process.env.SQUARESPACE_API_KEY;
if (!API_KEY) {
  console.error('ERROR: SQUARESPACE_API_KEY not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const BASE_URL = 'https://api.squarespace.com/1.0/commerce/products';

async function fetchAll() {
  const all = [];
  let cursor = null;
  while (true) {
    const url = cursor ? `${BASE_URL}?cursor=${encodeURIComponent(cursor)}` : BASE_URL;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'nutrivamos-catalog-fetcher/1.0',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    all.push(...data.products);
    console.log(`  fetched ${data.products.length} products (running total: ${all.length})`);
    if (!data.pagination || !data.pagination.hasNextPage) break;
    cursor = data.pagination.nextPageCursor;
  }
  return all;
}

function buildCatalog(products) {
  // Output shape: { "<variant_uuid>": { itemId, sku, name } }
  // Keyed by variant UUID because that's what Meta Commerce sends in the
  // checkout URL (?products=<variant_uuid>:qty,...).
  const catalog = {};
  for (const p of products) {
    if (!p.isVisible) continue;
    for (const v of (p.variants || [])) {
      const attrSummary = Object.values(v.attributes || {}).join(' / ');
      const name = attrSummary ? `${p.name} — ${attrSummary}` : p.name;
      catalog[v.id] = {
        itemId: p.id,
        sku: v.sku,
        name,
      };
    }
  }
  return catalog;
}

(async () => {
  console.log('Fetching Squarespace catalog...');
  const products = await fetchAll();
  console.log(`\nTotal products: ${products.length}`);

  const catalog = buildCatalog(products);
  const variantCount = Object.keys(catalog).length;
  console.log(`Total visible variants: ${variantCount}\n`);

  const outPath = path.join(__dirname, '..', 'catalog.json');
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Wrote ${outPath}`);
  console.log('\nVariants in catalog:');
  for (const [uuid, entry] of Object.entries(catalog)) {
    console.log(`  ${entry.sku.padEnd(12)} ${entry.name}`);
  }
  console.log('\nNext steps:');
  console.log('  git add catalog.json');
  console.log('  git commit -m "Update catalog"');
  console.log('  git push');
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
