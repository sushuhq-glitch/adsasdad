# Solana Meme Bot H24 — Max Profit Strategy

Bot TypeScript/Node.js ad alto rendimento per meme coin su **Solana** (Axiom / Anthem / Fomo / Pump.fun), con analisi tecnica avanzata, risk % esplicita, dashboard e Telegram.

> Default sicuro: `TRADING_MODE=paper` + `DRY_RUN=true`.

## Strategia

- **Volume Profile / Spike Anomaly** — rileva accelerazioni di volume
- **Smart Money Tracking** — stima inflow wallet top trader / early wallets
- **Mcap/Liquidity ratio + velocity** — crescita market cap vs liquidità
- **Sentiment H24** — DexScreener + narrative TikTok/YouTube
- **Moonshot / High Yield** — il bot può entrare anche ad alto rischio se il profit potential è alto e la tolleranza lo consente
- **Risk % esplicita** per trade (ancore tipiche: Low **15%**, Medium **45%**, High **80%**)

## Moduli

```
src/
├── config/           # wallet, API keys, budget, RISK_TOLERANCE, MAX_RISK_PCT
├── analysis/         # volume, smart money, liquidity growth, Max Profit engine
├── security/         # contract checks + risk scorer (%)
├── scrapers/         # DexScreener, Pump.fun, social/narrative
├── trader/           # wallet, venues (axiom/anthem/fomo/pumpfun), TP/SL/trailing
├── telegram/         # report con risk% + comandi
├── ui/               # dashboard H24
└── index.ts          # controller asincrono continuo
```

## Installazione

```bash
cd solana-meme-bot
cp .env.example .env
npm install
npm run dev
```

Dashboard: `http://localhost:3847` (token `DASHBOARD_AUTH_TOKEN`).

## Telegram

```
/status
/pause [motivo]
/resume
/budget 1.5
/risk only_low | only_high | all | low_medium | medium_high
/risk max 70
/update Nuova keyword: frog meme
```

### Formato report

```
🚀 NUOVA OPERAZIONE ESEGUITA (HIGH PROFIT POTENTIAL)
• Token: $EXAMPLE (Solana)
• Market Cap: $120,000
• Importo Investito: 0.5 SOL
• Prezzo d'Ingresso (Entry Price): $0.00045
• 🔥 LIVELLO DI RISCHIO TRADE: 65% (Rischio Medio-Alto)
• Motivazione Strategica: Accumulo Smart Wallet + Trend TikTok (+320%)

📈 AGGIORNAMENTO CHIUSURA POSIZIONE / PnL
• Prezzo di Uscita (Sell Price): $0.00135
• Take Profit Raggiunto: +200%
• Profit/Loss Netto: +1.0 SOL (+$180.00 USD)
```

## Disclaimer

Trading meme coin = rischio estremo di perdita. Gli adapter venue sono generici: collega le API ufficiali prima del live. Non è consulenza finanziaria.
