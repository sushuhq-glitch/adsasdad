# Solana Mirror Bot H24 — FOMO Top 50 PnL Copy Trading

Bot TypeScript/Node.js per **Mirror Trading / Wallet Copying** su Solana: analizza i **Top 50 PnL FOMO** e compra/vende **quando lo fanno loro**.

> Default: `TRADING_MODE=paper` + `DRY_RUN=true` + `PREFERRED_EXECUTION_VENUE=fomo`.

## Come funziona

1. Scarica/aggiorna la **Top 50 PnL** da FOMO (fallback Solana Tracker / seed)
2. Ascolta i wallet via **WebSocket `logsSubscribe` + polling** firme
3. **COPY BUY** immediato quando un target compra un token
4. **COPY SELL** immediato quando il target vende (parziale o totale) — **non aspetta TP/SL**
5. Mantiene **TP/SL di emergenza** se il wallet non vende / rug
6. Notifica Telegram + dashboard con risk %, wallet copiato, PnL

## Moduli

```
src/
├── config/          # RPC/WS, FOMO keys, budget, lista seed
├── copy/            # FOMO leaderboard, watcher WS, decoder, mirror engine
├── security/        # risk scorer (anche per copy)
├── trader/          # esecuzione Fomo/Axiom/Anthem/Pump.fun
├── telegram/        # report COPY BUY/SELL + comandi wallet
├── ui/              # dashboard H24
└── index.ts         # controller + auto-riconnessione
```

## Install

```bash
cd solana-meme-bot
cp .env.example .env
# TELEGRAM_BOT_TOKEN, opz. FOMO_API_KEY, SOLANA_WS_URL (Helius)
npm install
npm run bot
```

Telegram: apri `@WEDOTHATBOT` → `/start`

### Token sessione Fomo (al posto di una API key pubblica)

1. Apri [fomo.family](https://fomo.family) e accedi
2. F12 (o tasto destro → Ispeziona) → scheda **Application** / Storage
3. **Local Storage** → URL di Fomo
4. Cerca `token` / `auth_token` / `jwt` / `session`
5. Copia il valore e incollalo quando il bot lo chiede (oppure scrivi `demo` per paper)

> Il token di sessione è sensibile come una password: non condividerlo.

### Comandi utili

```
/wallets list
/wallets refresh          # ricarica Top 50 FOMO PnL
/wallets add <address> [label]
/wallets remove <address>
/pause · /resume · /budget 1.5
/risk max 70
```

### Report Telegram

```
🚀 ACQUISTO AUTOMATICO ESEGUITO (COPY BUY)
• Token: $EXAMPLE · Market Cap · Wallet Copiato · Risk % · in ascolto vendita...

⚡ VENDITA IMMEDIATA ESEGUITA (COPY SELL)
• Sell Price · Motivo: vendita wallet copiato · PnL SOL/USD
```

## Produzione (latenza)

- Usa RPC/WS dedicati (`SOLANA_WS_URL`, Helius/Triton)
- Imposta `FOMO_API_KEY` se disponibile
- Opzionale `SOLANA_TRACKER_API_KEY` come fallback leaderboard
- `DRY_RUN=false` e `TRADING_MODE=live` solo dopo test paper

## Disclaimer

Copy trading meme coin è ad altissimo rischio. Non è consulenza finanziaria.
