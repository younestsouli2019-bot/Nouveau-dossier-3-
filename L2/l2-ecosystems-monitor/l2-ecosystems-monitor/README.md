# L2 Ecosystems Monitor

Daily L2 transaction monitor for owner accounts across Arbitrum, Optimism, Base, Polygon zkEVM, Linea, and Scroll. Runs as a server + daemon — accepts transactions in pre-set owner accounts as per repo secrets and `.env` locally.

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your RPC endpoints and owner addresses

# 3. Run
npm start
```

## Architecture

```
src/
├── index.js              # Main entry — orchestrates everything
├── server.js             # Express REST API server
├── daemon.js             # Cron-based scheduled scanner
├── config.js             # Environment + network config loader
├── cli/
│   └── scan.js           # One-shot CLI scanner
├── providers/
│   ├── index.js          # Provider factory
│   └── BaseL2Provider.js # Base provider (scanning, ERC-20, RPC fallback)
├── services/
│   ├── transaction-monitor.js  # Core scanning engine
│   ├── wallet-manager.js       # Wallet/account management
│   └── notification-service.js # Slack/Telegram/Discord alerts
├── routes/
│   └── api.js            # REST API endpoints
├── middleware/
│   └── auth.js           # API key authentication
└── utils/
    ├── logger.js         # Winston structured logging
    └── store.js          # JSON file-based data persistence
```

## Supported L2 Networks

| Network | Chain ID | Config Key | Default RPC |
|---------|----------|-----------|-------------|
| Arbitrum One | 42161 | `arbitrum` | Alchemy/Infura |
| Optimism | 10 | `optimism` | Alchemy/Infura |
| Base | 8453 | `base` | Alchemy/Infura |
| Polygon zkEVM | 1101 | `polygon-zkevm` | Public RPC |
| Linea | 59144 | `linea` | Public RPC |
| Scroll | 534352 | `scroll` | Public RPC |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/networks` | Network connection status |
| GET | `/api/balances` | ETH balances for all owner addresses |
| GET | `/api/scan/status` | Current scan state + last results |
| POST | `/api/scan/trigger` | Trigger manual scan (all or single network) |
| GET | `/api/transactions` | List transaction data files |
| GET | `/api/transactions/:network/:date` | Get transactions for network + date |
| GET | `/api/summaries` | List daily summaries |
| GET | `/api/summary/:date` | Get daily summary |
| GET | `/api/addresses` | List watched owner addresses |

All `/api/*` endpoints require the `X-API-Key` header if `API_KEY` is set in `.env`.

## Configuration

Copy `.env.example` to `.env` and configure:

### Required
- `OWNER_ADDRESSES` — Comma-separated wallet addresses to monitor
- `RPC_ARBITRUM` / `RPC_OPTIMISM` / `RPC_BASE` — At least one L2 RPC endpoint

### Optional
- `OWNER_PRIVATE_KEYS` — For TX submission mode (monitor-only by default)
- `DAEMON_CRON` — Cron schedule (default: hourly)
- `MIN_TX_VALUE_ETH` — Minimum ETH value to track (default: 0.001)
- `TRACK_ERC20` — Enable ERC-20 transfer scanning (default: true)
- `SLACK_WEBHOOK_URL` / `TELEGRAM_*` / `DISCORD_*` — Notifications
- `API_KEY` — Secure the REST API

## Running Options

### Direct
```bash
npm start                    # Server + daemon
npm run daemon               # Daemon only
npm run server               # API server only
npm run scan                 # One-shot CLI scan
```

### PM2 (Production)
```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

### Docker
```bash
npm run docker:build
npm run docker:up
npm run docker:logs
```

## Security

- Private keys are **never** logged or exposed in API responses
- `.env` is excluded from git via `.gitignore`
- API key authentication on all `/api` routes
- Helmet.js security headers on the HTTP server
- Zero-knowledge by design — monitor-only mode requires no private keys

## Data Storage

Transaction data and scan state are persisted as JSON files in `./data/`:

- `scan_state.json` — Last scanned block per network
- `txs_<network>_<date>.json` — Transaction records
- `summary_<date>.json` — Daily aggregation summaries
