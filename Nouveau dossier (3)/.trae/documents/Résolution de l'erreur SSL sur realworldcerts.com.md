I will proceed with a two-phase execution to **fix the SSL issue first** and then **upgrade the swarm** to prevent this from happening again.

### Phase 1: Immediate Fix (SSL & CNAME)
**Goal**: Restore `https://www.realworldcerts.com` by correcting the deployment configuration.
1.  **Commit & Push Fixes**:
    *   `rank/wet6run/site.py`: Auto-generate `CNAME` file.
    *   `rank/wet6run/autopilot.py`: Restore hub/site building pipeline.
    *   `rank/start.bat`: Enforce `SITE_DOMAIN` variable.
2.  **Trigger Deployment**: Pushing to `main` will auto-run the GitHub Action. GitHub will see the `CNAME` and provision the SSL certificate (approx. 15-30 mins delay for propagation).

### Phase 2: Swarm Upgrade ("Invest in them")
**Goal**: Equip agents with "eyes" to detect broken public sites.
1.  **Create `src/swarm/site-watch.mjs`**:
    *   New capability: Proactively pings `https://www.realworldcerts.com`.
    *   Detection: Checks for SSL handshake errors, 404s, or "Page Not Found".
2.  **Integrate into Daemon**:
    *   Add to `autonomous-daemon.mjs` loop.
    *   Action: If the site is down/insecure, it will log a critical alert or attempt a remedial deployment automatically.

I will start with **Phase 1** immediately upon confirmation.