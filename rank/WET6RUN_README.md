# WET6RUN: Traffic Growth Toolkit for realworldcerts.com

## Quick Start
- **One-Click Launch**: Double-click `start.bat` to run the autonomous daemon.
- **Manual**: `python wet6run_server.py`
- Access the site locally at: http://localhost:8000/

## Autonomous Mode (Autopilot)
The system runs in a self-improving loop:
1.  **Generates Content**: Courses, articles, hubs, and assets.
2.  **Optimizes**: Injects analytics, creates A/B tests based on order logs.
3.  **Deploys**: Packages and pushes to GitHub Pages (if configured).

### Configuration
Edit `start.bat` or set environment variables:
- `SITE_DOMAIN`: Your production domain (e.g., www.realworldcerts.com)
- `GA_ID`, `META_PIXEL_ID`, `TIKTOK_PIXEL_ID`: Tracking IDs
- `LEAD_ENDPOINT`, `ORDER_ENDPOINT`: Webhook URLs for form submissions
- `GH_REPO`, `GH_TOKEN`: For auto-deployment to GitHub Pages

## Deployment
### Option A: GitHub Pages (Recommended)
1.  Create a private GitHub repository.
2.  Run `python tools/bootstrap_repo.py` to initialize and commit.
3.  Set `GH_REPO` and `GH_TOKEN` in `start.bat`.
4.  The daemon will auto-deploy on every run.
5.  Alternatively, push to `main` and let GitHub Actions handle it (workflow included).

### Option B: Manual / FTP
- Run `python wet6run_deploy.py` to create `output/site.zip`.
- Upload via FTP by setting `FTP_HOST`, `FTP_USER`, `FTP_PASS`.

## Developer Tools
- `python wet6run.py`: Generate articles only
- `python wet6run_commercial.py`: Generate courses/bundles
- `python wet6run_hubs.py`: Update category hubs
- `python wet6run_analytics.py`: Re-inject tracking tags
- `python tools/create_repo.py`: Auto-create private repo (requires token)

## Enable Multi‑Model Generation
- Set environment variables before running:
- Windows PowerShell:

```bash
$env:OPENAI_API_KEY="..."
$env:OPENAI_MODEL="gpt-4o-mini"
$env:ANTHROPIC_API_KEY="..."
$env:ANTHROPIC_MODEL="claude-3-5-sonnet-20241022"
$env:GEMINI_API_KEY="..."
$env:GEMINI_MODEL="gemini-1.5-pro"
python wet6run.py www.realworldcerts.com
```

## Deploy to realworldcerts.com
- Create `/articles/` path on the site and upload generated `.html`
- Embed matching `-article.jsonld` and `-faq.jsonld` as JSON‑LD in each page
- Upload `sitemap.xml` and `rss.xml` to site root
- Verify in Google Search Console and Bing Webmaster Tools

## Social Distribution
- Use generated scripts in `output/social/` for:
- YouTube Shorts, TikTok, X (Twitter), LinkedIn, Facebook, Reddit
- Add links back to the uploaded article URLs

## Commercial Toolkit
- Run:

```bash
python wet6run_commercial.py www.realworldcerts.com
```

- Outputs: `output/commercial/courses/*.html`, `output/commercial/emails/*`, `output/commercial/marketing/*`, `output/commercial/bundles/*.html`, `output/commercial/catalog.json`
- Use course landing pages under `/courses/`, link CTAs to `/checkout?sku=...`
- Email files are ready for import into ESPs (Mailchimp, Sendgrid)
- Marketing JSONs include ads snippets and promo codes for campaigns

## LearnWorlds Exports
- Run:

```bash
python wet6run_learnworlds_export.py www.realworldcerts.com
```

- Outputs: `output/learnworlds/coupons.csv`, `output/learnworlds/ads.csv`, `output/learnworlds/links.csv`
- Import coupons.csv in LearnWorlds, use ads.csv for campaign setup, links.csv for platform‑specific URLs
- Credentials management: set environment variables without storing passwords in code
- Windows PowerShell:

```bash
$env:LW_USERNAME="..."
$env:LW_PASSWORD="..."
$env:LW_BASE="real-world.learnworlds.com"
```

## Suggested Site Enhancements
- Add internal links across topic clusters
- Add FAQ sections using the generated FAQ JSON‑LD
- Add `robots.txt` allowing `/articles/` and point to sitemap
- Cache headers and gzip for `articles` and XML files

## Scheduling
- Re‑run weekly to refresh content and add new topics
- Append new pages; keep existing URLs stable
