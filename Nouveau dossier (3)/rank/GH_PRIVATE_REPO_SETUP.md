# Private Repo + Public Pages Setup

1. Create a GitHub repository and set it to **Private**.
2. Push this project contents to the repo and set default branch to **main**.
3. In repo Settings → Pages:
   - Build and deployment: Source → **GitHub Actions**
4. In repo Settings → Secrets and variables → Actions → **New repository secrets**:
   - SITE_DOMAIN (optional, e.g., www.realworldcerts.com)
   - GA_ID (optional)
   - META_PIXEL_ID (optional)
   - TIKTOK_PIXEL_ID (optional)
   - LEAD_ENDPOINT (optional)
   - ORDER_ENDPOINT (optional)
5. Trigger deployment:
   - Push to `main` or use Actions → Deploy Static Site → Run workflow.
6. Pages visibility:
   - Pages site is public. Repository remains **private**.
