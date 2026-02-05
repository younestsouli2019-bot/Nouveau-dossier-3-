(function() {
    // Sales Booster Configuration
    const CONFIG = {{
        fomo: {{ enabled: true, interval: 15000 }},
        timer: {{ enabled: true, end: '23:59:59' }}, // Ends tonight
        exitIntent: {{ enabled: true, discount: 'SAVE10' }}
    }};

    // --- 1. Recent Sales Notifications (FOMO) ---
    const sales = [{"name": "Alex from NY", "product": "AWS Solutions Architect"}, {"name": "Sarah from London", "product": "PMP Certification"}, {"name": "Mike from Toronto", "product": "Cisco CCNA"}, {"name": "Jessica from Sydney", "product": "CompTIA Security+"}, {"name": "David from Berlin", "product": "Azure Administrator"}];

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
        el.innerHTML = '⚡ FLASH SALE: 50% OFF ends in <span id="boost-timer">00:00:00</span> - Use Code: SAVE10';
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

})();