# OddsLab — Sports Betting Intelligence

Piattaforma professionale di analisi sportiva che, data una **quota desiderata**, analizza tutte le
partite e tutti i mercati disponibili e restituisce la **scommessa con la probabilità di successo
stimata più alta** compatibile con quella quota — con motivazione trasparente, livello di
confidenza, margine di valore (value bet) e fattori di rischio.

> **Nessuna previsione è certa.** Il sistema mostra sempre probabilità, confidenza e limiti delle
> stime. Gioca responsabilmente.

## Architettura

```
backend/  (Python, FastAPI)
  app/
    data/        Strato dati: interfaccia provider, feed demo deterministico,
                 adapter API-Football (attivo con ODDSLAB_API_FOOTBALL_KEY),
                 aggregatore con validazione incrociata delle fonti
    analysis/    Modello Dixon-Coles/Poisson e conversione dei fattori
                 (forma, rosa, tattica, H2H, campo, motivazioni, meteo, arbitro)
                 in correzioni dei gol attesi + fattori chiave leggibili
    ml/          Ensemble: Random Forest, Gradient Boosting, Extra Trees,
                 rete neurale, modello Bayesiano Dixon-Coles
                 (+ XGBoost/LightGBM/CatBoost se installati), pesati per log-loss
    simulation/  Monte Carlo: 100.000 partite virtuali per gara
                 (1X2, Over/Under, BTTS, risultati esatti, corner, cartellini,
                 handicap asiatici, team totals, marcatori anytime)
    engine/      Valutazione mercati (probabilità, quota equa, value, edge
                 de-viggato, Kelly), motore di raccomandazione, storico SQLite
  tests/         Test end-to-end (motore + API)

frontend/ (React + TypeScript + Vite + Recharts)
  Dashboard stile trading: ricerca partita, selezione campionato/data,
  quota desiderata con tolleranza, giocata consigliata con motivazione
  completa, tab di analisi (forma 5/10/20, rosa e infortuni, tattica,
  scontri diretti, contesto/meteo/arbitro, statistiche avanzate,
  simulazione, board quote con storico e movimenti), storico pronostici,
  tema chiaro/scuro, layout responsive desktop e mobile.
```

## Avvio rapido

Backend (porta 8000):

```bash
cd backend
pip install -r requirements.txt
python3 -m uvicorn app.main:app --port 8000
```

Frontend (porta 5173, proxy verso il backend):

```bash
cd frontend
npm install
npm run dev
```

Apri <http://localhost:5173>.

I test:

```bash
cd backend && python3 -m pytest tests -q
```

## Fonti dati

Senza chiavi API la piattaforma usa un **feed demo deterministico** (stesse partite → stessi dati
→ stesse probabilità), che rende ogni funzione testabile end-to-end. Configurando le variabili
d'ambiente vengono attivati gli adapter live, con fallback automatico e validazione dei payload:

| Variabile                  | Provider                    |
| -------------------------- | --------------------------- |
| `ODDSLAB_API_FOOTBALL_KEY` | API-Football (api-sports.io)|
| `ODDSLAB_ODDS_API_KEY`     | The Odds API (quote)        |
| `ODDSLAB_OPENWEATHER_KEY`  | OpenWeather (meteo)         |

## Come viene scelta la giocata

1. **Raccolta dati** per ogni partita candidata: forma (ultime 5/10/20), rosa (infortuni,
   squalifiche, diffide, rientri, turnover, riposo, impegni europei), tattica, scontri diretti,
   fattore campo, motivazioni, meteo, arbitro, pubblico, statistiche avanzate (xG, xA, PPDA,
   possession value, deep completions, big chances, zone di tiro e pressione).
2. **Correzioni contestuali**: ogni fattore modifica i gol attesi delle due squadre e genera un
   fattore chiave (favorevole o di rischio) con impatto quantificato.
3. **Ensemble di modelli**: ogni modello produce le proprie probabilità 1X2; il blend è pesato
   sull'accuratezza in validazione (log-loss) e la dispersione tra i modelli misura la confidenza.
4. **Simulazione Monte Carlo** di 100.000 partite virtuali per prezzare tutti i mercati derivati.
5. **Confronto con il mercato**: probabilità implicite dei bookmaker depurate dal margine
   (de-vig), value bet = `p × quota − 1`, edge, frazione di Kelly, movimenti quota sospetti.
6. **Selezione finale**: tra i mercati con quota nell'intervallo di tolleranza vince la
   probabilità stimata più alta (poi value e confidenza come tie-break), con motivazione completa
   e mercati alternativi a confronto.

## Aggiornamento in tempo reale

`POST /api/refresh/{fixture_id}` invalida la cache e ricalcola immediatamente tutte le probabilità
(formazioni ufficiali, infortuni, quote, meteo). Nel frontend l'opzione "Aggiornamento automatico"
esegue il ricalcolo ogni 60 secondi.

## API principali

| Endpoint                        | Descrizione                                    |
| ------------------------------- | ---------------------------------------------- |
| `GET  /api/health`              | Stato, log-loss dei modelli, n. simulazioni    |
| `GET  /api/leagues`             | Campionati disponibili                         |
| `GET  /api/fixtures`            | Partite (filtri: `league_id`, `date`)          |
| `GET  /api/analysis/{fixture}`  | Analisi completa della partita                 |
| `POST /api/recommend`           | Migliore giocata per la quota richiesta        |
| `POST /api/refresh/{fixture}`   | Ricalcolo in tempo reale                       |
| `GET  /api/history`             | Storico pronostici                             |

Esempio:

```bash
curl -X POST http://localhost:8000/api/recommend \
  -H 'Content-Type: application/json' \
  -d '{"target_odds": 1.50, "league_id": "serie-a", "tolerance_pct": 12}'
```

## Estensione ad altri sport

Il dominio è isolato dietro `DataProvider` e gli schemi Pydantic: per aggiungere basket o tennis è
sufficiente un nuovo provider (con i mercati specifici dello sport), un modulo di simulazione
dedicato e la registrazione nello strato `sport` delle richieste. Modelli, valutazione mercati,
value bet, storico e interfaccia sono già sport-agnostici.
