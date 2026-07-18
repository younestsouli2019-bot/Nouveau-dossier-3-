import os
import json
import string
import random
from datetime import datetime, timedelta

def generate_booster_script(domain, outdir, recommendations=None):
    """
    Generates a JavaScript snippet (sales_booster.js) that can be injected 
    into an EXISTING website to add:
    1. Recent Sales Notifications (FOMO)
    2. Sticky Countdown Timer (Urgency)
    3. Exit Intent Popup (Discount)
    """
    if not os.path.exists(outdir):
        os.makedirs(outdir)
        
    # Defaults
    fomo_enabled = True
    fomo_interval = 15000
    timer_enabled = True
    timer_end = '23:59:59'
    exit_enabled = True
    exit_discount = 'SAVE10'
    banner_text = '⚡ FLASH SALE: 50% OFF ends in'
    sales_list = [
        { "name": "Alex from NY", "product": "AWS Solutions Architect" },
        { "name": "Sarah from London", "product": "PMP Certification" },
        { "name": "Mike from Toronto", "product": "Cisco CCNA" },
        { "name": "Jessica from Sydney", "product": "CompTIA Security+" },
        { "name": "David from Berlin", "product": "Azure Administrator" }
    ]
    # Apply agent recommendations if provided
    if recommendations and isinstance(recommendations.get("boosters"), dict):
        b = recommendations["boosters"]
        try:
            fomo_enabled = bool(b.get("fomo", {}).get("enabled", fomo_enabled))
            fomo_interval = int(b.get("fomo", {}).get("interval", fomo_interval))
        except Exception:
            pass
        try:
            timer_enabled = bool(b.get("timer", {}).get("enabled", timer_enabled))
            timer_end = str(b.get("timer", {}).get("end", timer_end))
            banner_text = str(b.get("timer", {}).get("bannerText", banner_text))
        except Exception:
            pass
        try:
            exit_enabled = bool(b.get("exitIntent", {}).get("enabled", exit_enabled))
            exit_discount = str(b.get("exitIntent", {}).get("discount", exit_discount))
        except Exception:
            pass
        sl = b.get("fomo", {}).get("sales")
        if isinstance(sl, list) and sl:
            sales_list = sl
    # Build JS with injected config
    sales_json = json.dumps(sales_list, ensure_ascii=False)
    tmpl = """(function() {
    // Sales Booster Configuration
    const CONFIG = {{
        fomo: {{ enabled: $FOMO_ENABLED, interval: $FOMO_INTERVAL }},
        timer: {{ enabled: $TIMER_ENABLED, end: '$TIMER_END' }}, // Ends tonight
        exitIntent: {{ enabled: $EXIT_ENABLED, discount: '$EXIT_DISCOUNT' }}
    }};

    // --- 1. Recent Sales Notifications (FOMO) ---
    const sales = $SALES_JSON;

    function showNotification() {{
        if (!CONFIG.fomo.enabled) return;
        const sale = sales[Math.floor(Math.random() * sales.length)];
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed; bottom:20px; left:20px; background:white; padding:15px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:9999; font-family:sans-serif; display:flex; align-items:center; gap:10px; animation: slideIn 0.5s ease-out;';
        el.innerHTML = '<span>🔥</span><div><strong>' + sale.name + '</strong><br><span style="font-size:0.9em;color:#666">just bought ' + sale.product + '</span></div>';
        document.body.appendChild(el);
        
        // Add styles if not present
        if (!document.getElementById('fomo-style')) {{
            const style = document.createElement('style');
            style.id = 'fomo-style';
            style.textContent = '@keyframes slideIn { from { transform: translateX(-100%); opacity:0; } to { transform: translateX(0); opacity:1; } }';
            document.head.appendChild(style);
        }}

        setTimeout(() => {{
            el.style.transition = 'opacity 0.5s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 500);
        }}, 5000);
    }}
    
    // Start FOMO loop
    setInterval(showNotification, CONFIG.fomo.interval);
    // Show first one quickly
    setTimeout(showNotification, 2000);


    // --- 2. Sticky Countdown Timer (Urgency) ---
    function initTimer() {
        if (!CONFIG.timer.enabled) return;
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed; top:0; left:0; width:100%; background:#e74c3c; color:white; text-align:center; padding:10px; font-weight:bold; z-index:10000; font-family:sans-serif;';
        el.innerHTML = '$BANNER_TEXT <span id="boost-timer">00:00:00</span> - Use Code: $EXIT_DISCOUNT';
        document.body.appendChild(el);
        // Push body down
        document.body.style.marginTop = '40px';

        function update() {{
            const now = new Date();
            const end = new Date();
            const [h, m, s] = CONFIG.timer.end.split(':');
            end.setHours(h, m, s, 0);
            if (now > end) end.setDate(end.getDate() + 1); // Next day
            
            const diff = end - now;
            const hh = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const mm = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const ss = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            document.getElementById('boost-timer').textContent = hh + ':' + mm + ':' + ss;
        }}
        setInterval(update, 1000);
        update();
    }}
    initTimer();


    // --- 3. Exit Intent Popup ---
    let exitShown = false;
    function initExitIntent() {
        if (!CONFIG.exitIntent.enabled) return;
        
        document.addEventListener('mouseleave', function(e) {
            if (e.clientY < 0 && !exitShown) {
                exitShown = true;
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:20000; display:flex; justify-content:center; align-items:center; font-family:sans-serif;';
                overlay.innerHTML = `
                    <div style="background:white; padding:40px; border-radius:12px; text-align:center; max-width:400px; position:relative;">
                        <span onclick="this.parentElement.parentElement.remove()" style="position:absolute; top:10px; right:15px; cursor:pointer; font-size:20px;">&times;</span>
                        <h2 style="margin-top:0; color:#e74c3c;">Wait! Don't leave empty handed.</h2>
                        <p>Take an extra <strong>10% OFF</strong> your first order.</p>
                        <div style="background:#eee; padding:10px; font-size:1.2em; border:2px dashed #ccc; margin:20px 0; font-family:monospace;">${CONFIG.exitIntent.discount}</div>
                        <button onclick="this.parentElement.parentElement.remove()" style="background:#2ecc71; color:white; border:none; padding:12px 24px; font-size:1em; border-radius:6px; cursor:pointer;">Use Discount Now</button>
                    </div>
                `;
                document.body.appendChild(overlay);
            }}
        }});
    }}
    initExitIntent();

})();"""
    tpl = string.Template(tmpl)
    script = tpl.safe_substitute(
        FOMO_ENABLED=str(fomo_enabled).lower(),
        FOMO_INTERVAL=fomo_interval,
        TIMER_ENABLED=str(timer_enabled).lower(),
        TIMER_END=timer_end,
        EXIT_ENABLED=str(exit_enabled).lower(),
        EXIT_DISCOUNT=exit_discount,
        SALES_JSON=sales_json,
        BANNER_TEXT=banner_text
    )

    booster_path = os.path.join(outdir, "sales_booster.js")
    with open(booster_path, "w", encoding="utf-8") as f:
        f.write(script)
    # LearnWorlds integration snippets
    site_domain = os.environ.get("SITE_DOMAIN", domain)
    external_url = os.environ.get("BOOSTER_CDN_URL", f"https://{site_domain}/assets/sales_booster.js")
    paypal_me = os.environ.get("PAYPAL_ME", "")
    with open(os.path.join(outdir, "integration_external.html"), "w", encoding="utf-8") as f:
        if paypal_me:
            f.write(f'<script src="{external_url}" data-paypalme="{paypal_me}"></script>')
        else:
            f.write(f'<script src="{external_url}"></script>')
    with open(os.path.join(outdir, "integration_inline.html"), "w", encoding="utf-8") as f:
        f.write("<script>" + script + "</script>")
    print(f"Generated conversion booster at {booster_path}")
