"""Application settings.

Real data-provider credentials are read from environment variables. When no
key is configured the platform falls back to the built-in deterministic demo
provider so that every feature remains testable end to end.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ODDSLAB_", env_file=".env")

    app_name: str = "OddsLab — Sports Betting Intelligence"
    api_prefix: str = "/api"

    # External providers (optional). When set, the corresponding adapter is
    # used instead of / alongside the demo provider.
    api_football_key: str = ""
    football_data_key: str = ""
    odds_api_key: str = ""
    openweather_key: str = ""

    # Engine parameters
    n_simulations: int = 100_000
    ml_training_samples: int = 12_000
    random_seed: int = 42

    # Storage
    history_db_path: str = "oddslab_history.sqlite3"


@lru_cache
def get_settings() -> Settings:
    return Settings()
