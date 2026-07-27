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

### Token sessione Fomo (`privy:token`)

Fomo usa **Privy** (login Google). Non esiste un’API key pubblica e **non** si devono inserire email/password Google su Telegram.

1. Accedi normalmente su [fomo.family](https://fomo.family) (Google + eventuale 2FA nel browser)
2. F12 → **Console**
3. Esegui: `copy(JSON.parse(localStorage.getItem('privy:token')))`
4. Incolla il JWT nel bot al `/start` (oppure `demo` per paper)

> Il token è sensibile: non condividerlo. Se scade, rifai i passaggi.

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
