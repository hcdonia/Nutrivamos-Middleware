# Nutrivamos × Meta Commerce Checkout Bridge

A client-side script that lets Meta Commerce (Instagram & Facebook Shops) check out on the Nutrivamos Squarespace site. When a customer taps "Buy" on Meta, they land on `nutrivamos.com/checkout` with their cart pre-populated and any offer code applied automatically.

## How it works

1. Meta sends customers to `https://www.nutrivamos.com/checkout?products=<variant-uuid>:<qty>,...&coupon=<code>`
2. Squarespace serves its normal checkout page
3. Our injected script (added to Squarespace Code Injection → Header) detects the Meta params and:
   - Fetches the latest product catalog from GitHub
   - Looks up each Meta variant UUID → Squarespace `itemId` + `sku`
   - POSTs each item to Squarespace's internal cart endpoint
   - Applies the coupon code if provided
   - Reloads `/checkout` with the cart now populated

There is **no Vercel, no server, and no hosting cost.** The whole system is the inject script + a JSON file on GitHub.

## One-time setup

### 1. Create a Squarespace API key

1. Squarespace dashboard → Settings → Advanced → Developer Tools → API Keys
2. Generate a new key with **Products: Read** permission
3. Copy `.env.example` to `.env` and paste the key in:
   ```
   SQUARESPACE_API_KEY=your_key_here
   ```

### 2. Generate the catalog

```bash
node scripts/fetch-catalog.js
```

This pulls every product variant from your Squarespace store and writes `catalog.json`. Re-run this any time you add, remove, or rename products in Squarespace.

### 3. Push to GitHub

The catalog needs to be hosted somewhere the inject script can fetch it. We use the GitHub raw URL:

```
https://raw.githubusercontent.com/hcdonia/Nutrivamos-Middleware/main/catalog.json
```

Push the project to that repo:

```bash
git init
git remote add origin https://github.com/hcdonia/Nutrivamos-Middleware.git
git add .
git commit -m "Initial setup"
git push -u origin main
```

If you fork or rename the repo, update `CATALOG_URL` at the top of `squarespace-inject.js` to match.

### 4. Paste the inject script into Squarespace

1. Open `squarespace-inject.js` in this repo
2. Copy the **entire** file (including the `<script>` and `</script>` tags)
3. In Squarespace: Settings → Advanced → Code Injection → **HEADER**
4. Paste at the bottom of the Header field
5. Save

### 5. Submit the URL to Meta Commerce Manager

In Meta Commerce Manager → Settings → Checkout, enter:

```
https://www.nutrivamos.com/checkout
```

Meta will automatically run a test with sample products from your catalog. As long as those products exist in `catalog.json`, the test will pass.

## Updating the catalog (fully automatic)

You don't have to do anything. A GitHub Actions workflow ([`.github/workflows/sync-catalog.yml`](.github/workflows/sync-catalog.yml)) runs every 15 minutes:

1. Calls the Squarespace API to fetch the latest catalog
2. Compares it to `catalog.json` in the repo
3. If anything changed (new product, new variant, renamed item, etc.), it commits and pushes the update automatically
4. The Squarespace inject script picks up the new catalog from the GitHub raw URL on the next page load

So when you add a product to your Squarespace store, it will appear in the Meta-checkout flow within ~15 minutes with zero manual work.

**One-time setup for the auto-sync:**

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `SQUARESPACE_API_KEY`
4. Value: paste your Squarespace API key
5. Save

That's it. The workflow starts running on its 15-minute schedule automatically.

**Want to trigger a sync manually?** Go to the repo → **Actions** tab → **Sync Squarespace Catalog** → **Run workflow** button. Updates within ~30 seconds.

**Want to run the sync locally instead** (e.g. to preview changes before they go live)?

```bash
node scripts/fetch-catalog.js
git add catalog.json
git commit -m "Update catalog"
git push
```

## File overview

| File | Purpose |
|---|---|
| `squarespace-inject.js` | The script you paste into Squarespace Code Injection |
| `catalog.json` | Variant lookup table — keyed by Meta variant UUID (auto-updated) |
| `scripts/fetch-catalog.js` | Pulls the catalog from the Squarespace API |
| `.github/workflows/sync-catalog.yml` | GitHub Actions workflow that auto-syncs every 15 min |
| `.env.example` | Template for the API key (real `.env` is gitignored) |
| `.gitignore` | Keeps `.env` and other local files out of git |

## Verified endpoints

The script uses two Squarespace internal endpoints (verified by inspecting the live nutrivamos.com network traffic):

**Add to cart:**
```
POST /api/commerce/shopping-cart/entries?crumb=<csrf>
Headers: Content-Type, x-requested-with, add-to-cart-id (uuid)
Body:    { itemId, sku, quantity, additionalFields: "null" }
```

**Apply coupon:**
```
POST /api/3/commerce/cart/<cartToken>/codes
Headers: Content-Type, x-csrf-token: <crumb>
Body:    { giftOrPromoCode: "<code>" }
```

These are undocumented Squarespace endpoints. If Squarespace ever changes them, the inject script will need to be updated. To debug if that happens: open nutrivamos.com → DevTools → Network → manually add a product to cart → inspect the request and update the script.

## Troubleshooting

**The Meta test fails with "cart is empty":**
- Check that the products Meta is testing with exist in `catalog.json`. If you recently added them to Squarespace, re-run `node scripts/fetch-catalog.js && git push`.
- Verify the script is pasted in the **Header** Code Injection (not Footer)
- Open `https://www.nutrivamos.com/checkout?products=<known-uuid>:1` in incognito and check the browser console for `[meta-checkout]` errors

**Coupon doesn't auto-apply:**
- The script will fall back to displaying the code on the loading overlay so the customer can copy/paste it. No further action needed.
- If you want auto-apply to work, make sure the coupon is created in Squarespace as a promo code (not a gift card)

**A normal customer's checkout page gets stuck on "Loading your cart":**
- Should be impossible — the script only activates when `?products=` is in the URL. If it does happen, check Code Injection in Squarespace and verify the script is the version from this repo.

## Cost

$0/month. Squarespace plan you already have, free GitHub repo, no Vercel.
