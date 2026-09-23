"""Continuous copy testing with a Thompson-sampling multi-armed bandit.

Why a bandit instead of a classic 50/50 A/B test: old-lead lists are finite.
A fixed split wastes half the list on the losing copy. A bandit starts even,
then automatically sends more traffic to whichever variant is getting replies,
while still exploring the others until the evidence is clear.

Each variant keeps two counters: successes (reply/booking) and failures (no response).
Its true response rate is modelled as Beta(1 + successes, 1 + failures).
"""

from __future__ import annotations  # postpone evaluation of type hints

import random  # Beta-distribution sampling
from dataclasses import dataclass  # typed container for per-variant stats


@dataclass
class ArmStats:
    """Results so far for one variant."""

    variant_id: str  # which variant these numbers belong to
    sends: int = 0  # how many times it was sent
    successes: int = 0  # how many sends earned a reply or conversion

    @property
    def failures(self) -> int:
        return max(self.sends - self.successes, 0)  # sends that got nothing back

    @property
    def rate(self) -> float:
        return self.successes / self.sends if self.sends else 0.0  # observed response rate


def choose(arms: list[ArmStats], rng: random.Random | None = None) -> str:
    """Pick the variant to send next. Higher-performing arms are chosen more often."""
    rng = rng or random.Random()  # injectable RNG keeps tests deterministic
    # Draw one plausible response rate per arm from its Beta posterior...
    draws = {a.variant_id: rng.betavariate(1 + a.successes, 1 + a.failures) for a in arms}
    return max(draws, key=draws.get)  # ...and send the arm whose draw is highest


def prob_best(arms: list[ArmStats], samples: int = 4000, seed: int = 7) -> dict[str, float]:
    """Monte-Carlo estimate of the probability that each arm is the true winner."""
    rng = random.Random(seed)  # fixed seed = stable numbers in reports
    wins = {a.variant_id: 0 for a in arms}  # win counter per arm
    for _ in range(samples):  # repeat the "draw and compare" many times
        wins[choose(arms, rng)] += 1  # count which arm came out on top
    return {k: v / samples for k, v in wins.items()}  # convert counts to probabilities


def losers(arms: list[ArmStats], min_sends: int = 50, threshold: float = 0.05) -> list[str]:
    """Variants that have had a fair shot and are very unlikely (<5%) to be the best.

    These are retired, and the copywriter writes a fresh challenger modelled on the
    current leader - so the campaign keeps improving for as long as it runs.
    """
    if len(arms) < 2 or any(a.sends < min_sends for a in arms):  # not enough evidence yet
        return []
    p = prob_best(arms)  # chance each arm is the winner
    return [vid for vid, pb in p.items() if pb < threshold]  # clear losers only


def leader(arms: list[ArmStats]) -> str | None:
    """The arm currently most likely to be best (None if there are no arms)."""
    if not arms:
        return None
    p = prob_best(arms)  # probability each arm is best
    return max(p, key=p.get)  # highest probability wins
