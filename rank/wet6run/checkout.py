import os
import json
from .generate import ensure_dir

def pipeline(domain, outdir):
    c_dir = os.path.join(outdir, "commercial")
    catalog_path = os.path.join(c_dir, "catalog.json")
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    items = {x["sku"]: {"title": x["title"], "price": x["price"]} for x in catalog}
    order_ep = os.environ.get("ORDER_ENDPOINT", "")
    html = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Checkout | Real World Certs</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="icon" href="/assets/favicon.svg">
  <script>
    const catalog = """ + json.dumps(items, ensure_ascii=False) + """;
    function getParam(name) {
      const url = new URL(window.location.href);
      return url.searchParams.get(name);
    }
    function format(n) {
      return '$' + Math.round(n);
    }
    function applyPromo(price, code) {
      if (!code) return price;
      // Basic code: SAVE10 = 10% off
      if (code.toUpperCase() === 'SAVE10') return Math.round(price * 0.9);
      return price;
    }
    function init() {
      const sku = getParam('sku');
      const code = getParam('code');
      const item = catalog[sku];
      if (!item) {
        document.getElementById('details').innerHTML = '<p>Invalid SKU</p>';
        return;
      }
      const base = item.price;
      const total = applyPromo(base, code);
      document.getElementById('course').textContent = item.title;
      document.getElementById('price').textContent = format(base);
      document.getElementById('total').textContent = format(total);
      document.getElementById('sku').textContent = sku;
    }
    function completePurchase() {
      const sku = document.getElementById('sku').textContent;
      const itemName = document.getElementById('course').textContent;
      const totalText = document.getElementById('total').textContent;
      const total = parseFloat(totalText.replace('$',''));
      const email = document.getElementById('email').value;
      const code = new URL(window.location.href).searchParams.get('code') || '';
      if (window.gtag) {
        gtag('event', 'purchase', { value: total, currency: 'USD', items: [{ item_id: sku, item_name: itemName, price: total }] });
      }
      if (window.fbq) {
        fbq('track', 'Purchase', { value: total, currency: 'USD', contents: [{ id: sku, quantity: 1 }] });
      }
      if (window.ttq) {
        ttq.track('CompletePayment', { value: total });
      }
      const ep = '""" + order_ep + """';
      if (ep) {
        const payload = {
          sku: sku,
          title: itemName,
          price: Math.round(total),
          currency: 'USD',
          promo_code: code,
          transaction_id: 'txn_' + Date.now(),
          email: email,
          page: window.location.href,
          source: 'website',
          timestamp: new Date().toISOString()
        };
        fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function(){
          const status = document.getElementById('status');
          status.textContent = 'Payment received. Confirmation sent.';
          status.style.color = '#2d6a4f';
        }).catch(function(){
          const status = document.getElementById('status');
          status.textContent = 'Payment simulated. Thank you!';
          status.style.color = '#2d6a4f';
        });
        return;
      }
      const status = document.getElementById('status');
      status.textContent = 'Payment simulated. Thank you!';
      status.style.color = '#2d6a4f';
    }
    document.addEventListener('DOMContentLoaded', init);
  </script>
</head>
<body>
  <header class="site-header hero">
    <div class="brand"><div class="logo"></div><div class="hero"><h1>Checkout</h1><p class="stats">Secure checkout • Instant access • 7-day refund</p></div></div>
  </header>
  <section class="container box" id="details">
    <div class="row">
      <div style="flex:2">
        <h2 id="course"></h2>
        <p>SKU: <span id="sku"></span></p>
        <p>Price: <strong id="price"></strong></p>
        <div class="row" style="margin-top:10px">
          <input id="promo" class="input" type="text" placeholder="Promo code (e.g., SAVE10)">
          <button class="btn" onclick="window.location.href='?sku=' + document.getElementById('sku').textContent + '&code=' + document.getElementById('promo').value">Apply</button>
        </div>
      </div>
      <div style="flex:1">
        <h3>Total</h3>
        <p><strong id="total"></strong></p>
        <input id="email" class="input" type="email" placeholder="Email for receipt">
        <button class="btn" onclick="completePurchase()">Complete Purchase</button>
        <p id="status" class="stats"></p>
      </div>
    </div>
  </section>
</body>
</html>"""
    ch_dir = os.path.join(outdir, "checkout")
    ensure_dir(ch_dir)
    with open(os.path.join(ch_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    return {"path": os.path.join(ch_dir, "index.html")}
