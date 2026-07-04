"""Predictive model ensemble.

Members:
- Dixon-Coles bivariate Poisson (analytical, Bayesian-shrunk rates)
- Random Forest (scikit-learn)
- Gradient Boosting (scikit-learn, XGBoost-style additive trees)
- Extra impurity-randomised trees (LightGBM-style variance reduction)
- Neural network (multi-layer perceptron)
- Optional native XGBoost / LightGBM / CatBoost when the packages are
  installed (they are heavy, so they load lazily and are skipped otherwise)

The tree/NN members are trained once at startup on a large corpus sampled
from the calibrated generative model, then re-used for every request. Each
member outputs (p_home, p_draw, p_away); the ensemble blends them with
inverse-log-loss weights and reports per-model probabilities so the UI can
show model agreement.
"""
from __future__ import annotations

import logging
import threading
import time

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import log_loss
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier

from ..analysis import probability as pr
from ..config import get_settings
from ..schemas import ModelProbability

log = logging.getLogger(__name__)

FEATURES = ["lambda_home", "lambda_away", "lambda_diff", "lambda_sum", "lambda_ratio",
            "form_edge", "availability_edge", "motivation_edge"]


def _features(lam_h: float, lam_a: float, form_edge: float, avail_edge: float, mot_edge: float) -> np.ndarray:
    return np.array([
        lam_h, lam_a, lam_h - lam_a, lam_h + lam_a, lam_h / max(lam_a, 0.05),
        form_edge, avail_edge, mot_edge,
    ], dtype=float)


class ModelEnsemble:
    _instance: "ModelEnsemble | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.models: dict[str, object] = {}
        self.weights: dict[str, float] = {}
        self.trained = False
        self.training_report: dict[str, float] = {}

    # ------------------------------------------------------------------
    @classmethod
    def instance(cls) -> "ModelEnsemble":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
                cls._instance.train()
            return cls._instance

    # ------------------------------------------------------------------
    def _generate_corpus(self, n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
        rng = np.random.default_rng(seed)
        lam_h = rng.uniform(0.3, 3.6, n)
        lam_a = rng.uniform(0.2, 3.2, n)
        form = rng.normal(0, 0.4, n)
        avail = rng.normal(0, 0.25, n)
        mot = rng.normal(0, 0.3, n)
        # latent effects consistent with the adjustment layer
        eff_h = lam_h * (1 + 0.16 * np.clip(form, -0.5, 0.5) + 0.1 * avail + 0.1 * mot)
        eff_a = lam_a * (1 - 0.16 * np.clip(form, -0.5, 0.5) - 0.1 * avail - 0.1 * mot)
        gh = rng.poisson(np.clip(eff_h, 0.05, None))
        ga = rng.poisson(np.clip(eff_a, 0.05, None))
        y = np.where(gh > ga, 0, np.where(gh == ga, 1, 2))
        X = np.column_stack([
            lam_h, lam_a, lam_h - lam_a, lam_h + lam_a, lam_h / np.maximum(lam_a, 0.05),
            form, avail, mot,
        ])
        return X, y

    # ------------------------------------------------------------------
    def train(self) -> None:
        settings = get_settings()
        t0 = time.time()
        X, y = self._generate_corpus(settings.ml_training_samples, settings.random_seed)
        X_tr, X_val, y_tr, y_val = train_test_split(X, y, test_size=0.2, random_state=settings.random_seed)

        candidates: dict[str, object] = {
            "Random Forest": RandomForestClassifier(
                n_estimators=160, max_depth=12, min_samples_leaf=20,
                random_state=settings.random_seed, n_jobs=-1),
            "Gradient Boosting": GradientBoostingClassifier(
                n_estimators=140, max_depth=3, learning_rate=0.08,
                random_state=settings.random_seed),
            "Extra Trees": ExtraTreesClassifier(
                n_estimators=200, max_depth=14, min_samples_leaf=15,
                random_state=settings.random_seed, n_jobs=-1),
            "Neural Network": MLPClassifier(
                hidden_layer_sizes=(48, 24), max_iter=350, alpha=1e-3,
                random_state=settings.random_seed),
        }

        # optional heavyweight members
        try:  # pragma: no cover - depends on optional package
            from xgboost import XGBClassifier
            candidates["XGBoost"] = XGBClassifier(
                n_estimators=200, max_depth=4, learning_rate=0.08,
                objective="multi:softprob", random_state=settings.random_seed)
        except ImportError:
            pass
        try:  # pragma: no cover
            from lightgbm import LGBMClassifier
            candidates["LightGBM"] = LGBMClassifier(
                n_estimators=200, max_depth=5, learning_rate=0.08,
                random_state=settings.random_seed, verbosity=-1)
        except ImportError:
            pass
        try:  # pragma: no cover
            from catboost import CatBoostClassifier
            candidates["CatBoost"] = CatBoostClassifier(
                iterations=200, depth=5, learning_rate=0.08,
                random_seed=settings.random_seed, verbose=False)
        except ImportError:
            pass

        for name, model in candidates.items():
            model.fit(X_tr, y_tr)
            ll = log_loss(y_val, model.predict_proba(X_val), labels=[0, 1, 2])
            self.models[name] = model
            self.training_report[name] = round(ll, 4)

        # Bayesian Dixon-Coles gets a weight from its own validation log-loss
        dc_probs = np.array([self._dixon_coles(x[0], x[1]) for x in X_val])
        self.training_report["Bayesian Dixon-Coles"] = round(
            log_loss(y_val, dc_probs, labels=[0, 1, 2]), 4)

        # inverse-log-loss weighting
        inv = {k: 1.0 / v for k, v in self.training_report.items()}
        total = sum(inv.values())
        self.weights = {k: v / total for k, v in inv.items()}
        self.trained = True
        log.info("ensemble trained in %.1fs: %s", time.time() - t0, self.training_report)

    # ------------------------------------------------------------------
    @staticmethod
    def _dixon_coles(lam_h: float, lam_a: float) -> tuple[float, float, float]:
        # Bayesian shrinkage of the rates towards league priors before pricing
        prior_h, prior_a, k = 1.45, 1.15, 0.15
        lam_h = (lam_h + k * prior_h) / (1 + k)
        lam_a = (lam_a + k * prior_a) / (1 + k)
        return pr.outcome_probs(pr.score_matrix(lam_h, lam_a))

    # ------------------------------------------------------------------
    def predict(
        self,
        lam_h: float,
        lam_a: float,
        form_edge: float = 0.0,
        avail_edge: float = 0.0,
        mot_edge: float = 0.0,
    ) -> list[ModelProbability]:
        x = _features(lam_h, lam_a, form_edge, avail_edge, mot_edge).reshape(1, -1)
        out: list[ModelProbability] = []
        for name, model in self.models.items():
            p = model.predict_proba(x)[0]
            out.append(ModelProbability(
                model=name, p_home=round(float(p[0]), 4), p_draw=round(float(p[1]), 4),
                p_away=round(float(p[2]), 4), weight=round(self.weights[name], 3)))
        ph, pd_, pa = self._dixon_coles(lam_h, lam_a)
        out.append(ModelProbability(
            model="Bayesian Dixon-Coles", p_home=round(ph, 4), p_draw=round(pd_, 4),
            p_away=round(pa, 4), weight=round(self.weights["Bayesian Dixon-Coles"], 3)))
        return out

    # ------------------------------------------------------------------
    @staticmethod
    def blend(breakdown: list[ModelProbability]) -> tuple[float, float, float, float]:
        """Weighted blend + agreement score (1 - normalised dispersion)."""
        wsum = sum(m.weight for m in breakdown)
        ph = sum(m.p_home * m.weight for m in breakdown) / wsum
        pd_ = sum(m.p_draw * m.weight for m in breakdown) / wsum
        pa = sum(m.p_away * m.weight for m in breakdown) / wsum
        disp = float(np.std([m.p_home for m in breakdown]) + np.std([m.p_away for m in breakdown]))
        agreement = max(0.0, 1.0 - disp * 4.0)
        total = ph + pd_ + pa
        return ph / total, pd_ / total, pa / total, agreement
