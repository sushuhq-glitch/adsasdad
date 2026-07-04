"""Storico dei pronostici (SQLite)."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone

from ..config import get_settings
from ..schemas import HistoryEntry, Recommendation

_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().history_db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            fixture_id TEXT NOT NULL,
            fixture_label TEXT NOT NULL,
            kickoff_utc TEXT NOT NULL,
            market_id TEXT NOT NULL,
            selection TEXT NOT NULL,
            target_odds REAL NOT NULL,
            taken_odds REAL NOT NULL,
            probability REAL NOT NULL,
            value_pct REAL NOT NULL,
            reliability TEXT NOT NULL
        )
        """
    )
    return conn


def record(rec: Recommendation) -> None:
    with _lock, _conn() as conn:
        conn.execute(
            """
            INSERT INTO predictions
            (created_at, fixture_id, fixture_label, kickoff_utc, market_id, selection,
             target_odds, taken_odds, probability, value_pct, reliability)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
                rec.fixture.id,
                f"{rec.fixture.home_team.name} - {rec.fixture.away_team.name}",
                rec.fixture.kickoff_utc,
                rec.market.market_id,
                rec.market.selection,
                rec.target_odds,
                rec.market.best_odds,
                rec.market.probability,
                rec.market.value_pct,
                rec.reliability,
            ),
        )


def list_entries(limit: int = 50) -> list[HistoryEntry]:
    with _lock, _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, fixture_id, fixture_label, kickoff_utc, market_id,
                   selection, target_odds, taken_odds, probability, value_pct, reliability
            FROM predictions ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        HistoryEntry(
            id=r[0], created_at=r[1], fixture_id=r[2], fixture_label=r[3],
            kickoff_utc=r[4], market_id=r[5], selection=r[6], target_odds=r[7],
            taken_odds=r[8], probability=r[9], value_pct=r[10], reliability=r[11],
        )
        for r in rows
    ]
