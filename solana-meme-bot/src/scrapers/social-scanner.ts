import type { TokenCandidate, TrendSignal } from "../types/index.js";
import { nowIso } from "../lib/money.js";
import { logger } from "../lib/logger.js";

/**
 * Scanner narrative / sentiment H24.
 * YouTube/TikTok non espongono API pubbliche stabili senza chiavi:
 * qui usiamo un modello a plugin + segnali sintetici prudenti,
 * e marchiamo i conflitti invece di forzare un buy.
 */
export class SocialTrendScanner {
  private lastSignals: TrendSignal[] = [];

  getSignals(): TrendSignal[] {
    return this.lastSignals;
  }

  async scan(candidates: TokenCandidate[]): Promise<TrendSignal[]> {
    const signals: TrendSignal[] = [];

    for (const c of candidates.slice(0, 10)) {
      // Proxy "organico": volume/liq + età. Spike estremi = rischio inorganic.
      const volLiq = c.liquidityUsd > 0 ? c.volume24hUsd / c.liquidityUsd : 0;
      const organicSearchScore = Math.max(
        5,
        Math.min(95, 40 + Math.log10(Math.max(1, c.volume24hUsd)) * 8 - (volLiq > 20 ? 30 : 0)),
      );
      const mentionsDeltaPct = Math.round(
        Math.min(800, Math.max(0, volLiq * 40 + (c.ageMinutes < 45 ? 120 : 20))),
      );

      let sentiment: TrendSignal["sentiment"] = "neutral";
      if (organicSearchScore >= 60 && mentionsDeltaPct >= 80 && mentionsDeltaPct <= 350) {
        sentiment = "bullish";
      } else if (mentionsDeltaPct > 450 || organicSearchScore < 25) {
        sentiment = "mixed";
      }

      const conflicting = sentiment === "mixed" || (mentionsDeltaPct > 300 && organicSearchScore < 45);

      signals.push({
        source: "narrative",
        symbol: c.symbol,
        mint: c.mint,
        score: Math.round((organicSearchScore + Math.min(100, mentionsDeltaPct / 4)) / 2),
        organicSearchScore: Math.round(organicSearchScore),
        sentiment,
        mentionsDeltaPct,
        summary:
          sentiment === "bullish"
            ? `Viralità stimata (+${mentionsDeltaPct}% menzioni) con segnale organico ${Math.round(organicSearchScore)}/100`
            : `Narrative debole/contrastante (mentions +${mentionsDeltaPct}%, organic ${Math.round(organicSearchScore)}/100)`,
        conflicting,
        at: nowIso(),
      });

      // Placeholder canali social: senza API key restano informativi e non abilitano il buy da soli.
      signals.push({
        source: "tiktok",
        symbol: c.symbol,
        mint: c.mint,
        score: Math.round(organicSearchScore * 0.8),
        organicSearchScore: Math.round(organicSearchScore * 0.85),
        sentiment,
        mentionsDeltaPct: Math.round(mentionsDeltaPct * 0.9),
        summary: "TikTok scanner in modalità prudente (plugin/API key opzionale)",
        conflicting,
        at: nowIso(),
      });

      signals.push({
        source: "youtube",
        symbol: c.symbol,
        mint: c.mint,
        score: Math.round(organicSearchScore * 0.7),
        organicSearchScore: Math.round(organicSearchScore * 0.8),
        sentiment: sentiment === "bullish" ? "neutral" : sentiment,
        mentionsDeltaPct: Math.round(mentionsDeltaPct * 0.5),
        summary: "YouTube trend non verificato end-to-end: peso ridotto in Zero Dubbi",
        conflicting: sentiment !== "bullish",
        at: nowIso(),
      });
    }

    this.lastSignals = signals;
    logger.info({ count: signals.length }, "Social/narrative scan completata");
    return signals;
  }
}
