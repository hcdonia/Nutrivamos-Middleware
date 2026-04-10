<script>
/*
 * Nutrivamos x Meta Commerce Checkout Bridge
 *
 * Lives in Squarespace Code Injection (Settings > Advanced > Code Injection > HEADER).
 * Runs on every page load.
 *
 * Flow:
 *   1. Meta sends customer to /checkout?products=<uuid>:<qty>,...&coupon=<code>
 *   2. Squarespace 302-redirects /checkout -> /cart when cart is empty, STRIPPING the query string
 *   3. So we stash the raw query string in sessionStorage on the FIRST hit (any page)
 *   4. On the subsequent /cart load, we recover it, POST items to Squarespace cart API,
 *      apply coupon if present, then redirect to /checkout.
 */
(function () {
  'use strict';

  var CATALOG_URL = 'https://raw.githubusercontent.com/hcdonia/Nutrivamos-Middleware/main/catalog.json';
  var CATALOG_CACHE_KEY = 'nutrivamos_meta_catalog_v1';
  var STASH_KEY = 'nutrivamos_meta_pending_v1';
  var FALLBACK_REDIRECT = '/shop';

  var rawSearch = window.location.search;
  var params = new URLSearchParams(rawSearch);

  if (params.has('products')) {
    // First hit: stash and continue. (Belt-and-suspenders in case Squarespace
    // ever starts redirecting /cart and we need to recover params on a follow-up page.)
    try { sessionStorage.setItem(STASH_KEY, rawSearch); } catch (e) {}
  } else {
    // No products in URL. Try to recover from sessionStorage, but only on /cart or /checkout.
    var path = window.location.pathname;
    if (!/^\/(cart|checkout)(\/|$)/.test(path)) return;
    var stashed = '';
    try { stashed = sessionStorage.getItem(STASH_KEY) || ''; } catch (e) {}
    if (!stashed) return;
    params = new URLSearchParams(stashed);
    if (!params.has('products')) return;
  }

  // Loading overlay
  var overlay = document.createElement('div');
  overlay.id = 'meta-checkout-overlay';
  overlay.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'width:100vw', 'height:100vh',
    'background:#fff', 'z-index:2147483647',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'color:#222', 'text-align:center', 'padding:20px'
  ].join(';');
  overlay.innerHTML =
    '<div style="font-size:18px;margin-bottom:16px;">Loading your cart...</div>' +
    '<div id="meta-checkout-status" style="font-size:14px;color:#666;"></div>';
  function setStatus(text) {
    var el = document.getElementById('meta-checkout-status');
    if (el) el.textContent = text;
  }
  function appendOverlayWhenReady() {
    if (document.body) document.body.appendChild(overlay);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(overlay); });
  }
  appendOverlayWhenReady();

  function getCrumb() {
    var m = document.cookie.match(/(?:^|;\s*)crumb=([^;]+)/);
    return m ? m[1] : '';
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function clearStash() {
    try { sessionStorage.removeItem(STASH_KEY); } catch (e) {}
  }

  function failHard(reason) {
    console.error('[meta-checkout]', reason);
    clearStash();
    window.location.replace(FALLBACK_REDIRECT);
  }

  function loadCatalog() {
    return fetch(CATALOG_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('catalog HTTP ' + res.status);
        return res.json();
      })
      .then(function (catalog) {
        try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog)); } catch (e) {}
        return catalog;
      })
      .catch(function (err) {
        console.warn('[meta-checkout] Catalog fetch failed, using cached fallback:', err);
        try {
          var cached = localStorage.getItem(CATALOG_CACHE_KEY);
          if (cached) return JSON.parse(cached);
        } catch (e) {}
        throw new Error('No catalog available (fetch failed and no cache)');
      });
  }

  function parseProducts(raw) {
    if (!raw) return [];
    return raw.split(',')
      .map(function (pair) {
        var parts = pair.split(':');
        var id = (parts[0] || '').trim();
        var qty = parseInt(parts[1], 10);
        return { id: id, qty: qty };
      })
      .filter(function (item) { return item.id && item.qty > 0; });
  }

  function addItemToCart(itemId, sku, qty) {
    var crumb = getCrumb();
    return fetch('/api/commerce/shopping-cart/entries?crumb=' + encodeURIComponent(crumb), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'add-to-cart-id': uuid()
      },
      body: JSON.stringify({
        itemId: itemId,
        sku: sku,
        quantity: qty,
        additionalFields: 'null'
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('add-to-cart HTTP ' + res.status);
      return res.json();
    });
  }

  function applyCoupon(cartToken, code) {
    var crumb = getCrumb();
    return fetch('/api/3/commerce/cart/' + encodeURIComponent(cartToken) + '/codes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'x-csrf-token': crumb
      },
      body: JSON.stringify({ giftOrPromoCode: code })
    }).then(function (res) {
      if (!res.ok) throw new Error('coupon HTTP ' + res.status);
      return res.json();
    });
  }

  var requestedItems = parseProducts(params.get('products'));
  var couponCode = (params.get('coupon') || '').trim();

  if (requestedItems.length === 0) return failHard('No valid items in products param');

  loadCatalog()
    .then(function (catalog) {
      var resolved = [];
      var unmapped = [];
      requestedItems.forEach(function (item) {
        var entry = catalog[item.id];
        if (entry) resolved.push({ itemId: entry.itemId, sku: entry.sku, qty: item.qty, name: entry.name });
        else unmapped.push(item.id);
      });
      if (unmapped.length) console.warn('[meta-checkout] Unmapped variant UUIDs:', unmapped);
      if (resolved.length === 0) return failHard('No requested items resolved against catalog');

      setStatus('Adding ' + resolved.length + ' item' + (resolved.length === 1 ? '' : 's') + ' to your cart...');

      var cartToken = null;
      var failed = [];
      var sequence = Promise.resolve();
      resolved.forEach(function (item) {
        sequence = sequence.then(function () {
          return addItemToCart(item.itemId, item.sku, item.qty)
            .then(function (response) {
              if (response && response.shoppingCart && response.shoppingCart.cartToken) {
                cartToken = response.shoppingCart.cartToken;
              }
            })
            .catch(function (err) {
              console.error('[meta-checkout] Failed to add', item.name, err);
              failed.push(item.name);
            });
        });
      });

      return sequence.then(function () {
        if (failed.length === resolved.length) {
          return failHard('All add-to-cart calls failed');
        }
        return cartToken;
      });
    })
    .then(function (cartToken) {
      if (cartToken === undefined) return;
      if (couponCode && cartToken) {
        setStatus('Applying discount code...');
        return applyCoupon(cartToken, couponCode)
          .then(function () {
            console.log('[meta-checkout] Coupon applied:', couponCode);
            return 'applied';
          })
          .catch(function (err) {
            console.warn('[meta-checkout] Coupon failed, will show as fallback:', err);
            return 'failed';
          });
      }
      return null;
    })
    .then(function (couponResult) {
      clearStash();
      try { history.replaceState({}, '', '/checkout'); } catch (e) {}

      if (couponResult === 'failed' && couponCode) {
        setStatus('Use code: ' + couponCode + ' at checkout');
        setTimeout(function () { window.location.replace('/checkout'); }, 2500);
        return;
      }

      window.location.replace('/checkout');
    })
    .catch(function (err) {
      failHard('Unexpected error: ' + (err && err.message ? err.message : err));
    });
})();
</script>
