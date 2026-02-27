# ⚖️ 量化教練 — Trading Coach v10.1

AI-powered trading discipline system for **Bull Put Spread / Vertical Spread** decision-making.

Uses Claude AI (Sonnet) with web search to fetch live market data and generate comprehensive 8-dimension trade analysis reports.

![Trading Coach](https://img.shields.io/badge/version-10.1-green) ![React](https://img.shields.io/badge/React-18-blue) ![Vite](https://img.shields.io/badge/Vite-6-purple)

## Features

### 📊 Spread Analysis (2-Agent Pipeline)
- **Agent 1** — Fetches live market data via AI web search (price, RSI, SMA, ATR, HV, earnings, etc.)
- **Agent 2** — Generates full verdict report with success rate, execution parameters, and risk warnings
- Signal scanner with weighted scoring (200MA, RSI, IV Rank, earnings, etc.)
- Covenant compliance check against your trading rules

### 🔍 Today's Opportunities
- Quick watchlist of popular high-beta stocks
- Optional AI live scan for today's biggest losers
- One-click jump to analysis

### 📓 Structured Trading Journal
- Professional form: ticker, strategy, direction, options parameters (DTE, Delta, Credit, MaxLoss)
- Psychology tracking: emotion state, confidence level, plan adherence
- AI coach reviews every entry against your 5-point covenant

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Anthropic API Key](https://console.anthropic.com/) (Claude Sonnet access required)

### Run Locally

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/trading-coach.git
cd trading-coach

# Install
npm install

# Run
npm run dev
```

Open http://localhost:3000 → Enter your API key in the sidebar → Start analyzing.

### Deploy to Vercel (Recommended)

1. Push to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Framework: **Vite** (auto-detected)
4. Click **Deploy**
5. Done! Your app is live.

> **Note:** The API key is entered by the user at runtime and stored in memory only. It is never sent to any server except Anthropic's API directly from the browser.

### Deploy to Netlify

1. Push to GitHub
2. Go to [netlify.com](https://app.netlify.com) → Add new site → Import from Git
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Deploy

## Architecture

```
Browser → Claude API (direct, with anthropic-dangerous-direct-browser-access)
   │
   ├─ Agent 1: Data fetch (web_search tool)
   │    └─ Returns structured JSON: price, RSI, SMA, ATR, HV, earnings...
   │
   └─ Agent 2: Verdict (analysis + report)
        └─ Returns full Chinese report: A-J sections
```

- **2 API calls per analysis** (reduced from 4 to avoid rate limits)
- **5-second cooldown** between calls
- **Exponential backoff retry** (up to 5 attempts) for 429 errors
- **45-second timeout** on scanner

## Trading Covenant (Built-in Rules)

1. 🛡️ VOO monthly DCA — never time the market
2. 🎯 Only buy dips (10/20/30% pullbacks)
3. ⚡ No naked options | DTE 30-45 | Delta -0.20 | MaxLoss ≤ 2%
4. 😴 No positions within 7 days of earnings
5. 💍 $5,000/month living expenses reserved

## Tech Stack

- **React 18** + **Vite 6**
- **Claude Sonnet 4** via Anthropic API
- **Web Search** tool for live market data
- Zero backend — runs entirely in browser

## License

Personal use. Not financial advice.
