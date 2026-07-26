# Solana Meme Bot H24 (Zero Dubbi)

Bot di automazione **prudente** per meme coin su Solana (Axiom / Anthem / Pump.fun), TypeScript/Node.js, con motore ad alta confidenza, dashboard web e Telegram.

> **Default sicuro:** `TRADING_MODE=paper` + `DRY_RUN=true`. Nessun ordine reale finché non configuri le API venue e disattivi dry-run.

## Moduli

```
src/
├── config/          # .env schema (wallet, API Axiom/Anthem/Pump.fun, Telegram, soglie)
├── telegram/        # messaggi HTML, polling/webhook comandi
├── security/        # anti-rug, contract analysis, filtro Zero Dubbi
├── scrapers/        # DexScreener, Pump.fun, YouTube/TikTok narrative
├── trader/          # wallet Solana, buy/sell, TP/SL/trailing, slippage
├── ui/              # Dashboard web + API
├── lib/             # logger, state store, alert bus
└── index.ts         # Controller H24 + gestione eccezioni
```

## Setup

```bash
cd solana-meme-bot
cp .env.example .env
npm install
npm run dev
```

Dashboard: `http://localhost:3847` (token = `DASHBOARD_AUTH_TOKEN`).

## Zero Dubbi

- Buy **solo** se `safetyScore` e `confidenceScore` ≥ soglia (default **90**).
- Qualsiasi dubbio (rug, liquidità, volumi non organici, social contrastanti, mint/freeze, concentrazione) → sospende e registra **Trade Rifiutato - Rischio Rilevato**.

## Telegram

Notifiche su buy/sell/PnL/stop-loss + alert sistema prioritari.

```
/status
/pause [motivo]
/resume
/budget 1.5
/update Nuovo endpoint Axiom: https://...
/help
```

Esempio messaggio:

```
🚀 NUOVA OPERAZIONE ESEGUITA
• Token: $EXAMPLE (Solana)
• Market Cap: $150,000
• Importo Investito: 0.5 SOL
• Entry Price: $0.00045
• Motivazione: Viralità TikTok (+250% menzioni) + Audit contratto superato.
```

## Live checklist

1. RPC affidabile + wallet con fondi limitati  
2. API key/base URL Axiom o Anthem (Pump.fun via adapter dedicato)  
3. Test paper completo  
4. `TRADING_MODE=live` e solo dopo `DRY_RUN=false`  
5. Mantieni soglie ≥ 90 e `ZERO_DOUBT_MODE=true`

## Disclaimer

Software di ricerca/automazione. Il trading meme coin è ad altissimo rischio. Adatta gli adapter alle API ufficiali prima di qualsiasi uso live. Non è consulenza finanziaria.
