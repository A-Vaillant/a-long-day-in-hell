#!/usr/bin/env python3
"""Plot simulation metrics from sim-metrics.js JSON output.

Usage:
    node scripts/sim-metrics.js | python3 scripts/plot-metrics.py
    # or with saved data:
    node scripts/sim-metrics.js > metrics.json
    python3 scripts/plot-metrics.py metrics.json
"""

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from matplotlib.gridspec import GridSpec

# --- Load data ---
if len(sys.argv) > 1:
    data = json.loads(Path(sys.argv[1]).read_text())
else:
    data = json.loads(sys.stdin.read())

out_dir = Path(__file__).parent.parent / "metrics"
out_dir.mkdir(exist_ok=True)

# --- Style ---
plt.rcParams.update({
    "figure.facecolor": "#1a1a2e",
    "axes.facecolor": "#16213e",
    "axes.edgecolor": "#e94560",
    "axes.labelcolor": "#eee",
    "text.color": "#eee",
    "xtick.color": "#aaa",
    "ytick.color": "#aaa",
    "grid.color": "#333",
    "grid.alpha": 0.5,
    "font.family": "monospace",
    "font.size": 10,
})

COLORS = ["#e94560", "#0f3460", "#53d8fb", "#f5a623", "#7b68ee", "#2ecc71", "#e74c3c", "#f39c12"]


def save(fig, name):
    fig.savefig(out_dir / f"{name}.png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  {name}.png")


print(f"Writing charts to {out_dir}/")

# === 1. Win path: targeted vs systematic ===
if "targeted" in data:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    # Targeted (omniscient)
    t_days = [r["day"] for r in data["targeted"] if r["won"]]
    if t_days:
        ax1.hist(t_days, bins=range(0, max(t_days) + 5, 1), color=COLORS[0], edgecolor="#111", alpha=0.85)
        ax1.axvline(sum(t_days) / len(t_days), color=COLORS[2], linestyle="--",
                     label=f"mean: {sum(t_days)/len(t_days):.1f}d")
        ax1.legend()
    ax1.set_xlabel("Days to Win")
    ax1.set_ylabel("Count")
    ax1.set_title("Targeted (Omniscient)")
    ax1.grid(True, axis="y")

    # Systematic (blind search)
    if "systematic_win" in data:
        s_data = data["systematic_win"]
        s_days = [r["day"] for r in s_data if r["won"]]
        s_lost = [r for r in s_data if not r["won"]]
        if s_days:
            bins = range(0, max(s_days) + 10, 5)
            ax2.hist(s_days, bins=bins, color=COLORS[3], edgecolor="#111", alpha=0.85)
            ax2.axvline(sum(s_days) / len(s_days), color=COLORS[2], linestyle="--",
                         label=f"mean: {sum(s_days)/len(s_days):.1f}d ({len(s_days)}/{len(s_data)} won)")
            ax2.legend()
        else:
            ax2.text(0.5, 0.5, f"0/{len(s_data)} won\n(timed out at {s_data[0]['day']}d)" if s_data else "no data",
                     transform=ax2.transAxes, ha="center", va="center", fontsize=14)
    ax2.set_xlabel("Days to Win")
    ax2.set_ylabel("Count")
    ax2.set_title("Systematic (Blind Search)")
    ax2.grid(True, axis="y")

    fig.suptitle("Days to Find Book — Gaussian Placement", fontsize=13, y=1.02)
    fig.tight_layout()
    save(fig, "01_win_days")

# === 2. Survival curves ===
if "survivalCurve" in data:
    fig, ax = plt.subplots(figsize=(10, 5))
    sc = data["survivalCurve"]
    days = [d["day"] for d in sc]
    for i, stat in enumerate(["hunger", "thirst", "exhaustion", "morale"]):
        ax.plot(days, [d[stat] for d in sc], color=COLORS[i], label=stat, linewidth=1.5)
    ax.set_xlabel("Day")
    ax.set_ylabel("Value (0–100)")
    ax.set_title("Survival-Only Player: Stat Trajectories")
    ax.legend(loc="upper right")
    ax.set_ylim(-5, 105)
    ax.grid(True)
    save(fig, "02_survival_curves")

# === 3. Neglectful death timeline ===
if "neglectful" in data:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))

    first_deaths = [r["firstDeath"] for r in data["neglectful"] if r["firstDeath"]]
    if first_deaths:
        ax1.hist(first_deaths, bins=range(0, max(first_deaths) + 2), color=COLORS[3], edgecolor="#111", alpha=0.85)
        ax1.axvline(sum(first_deaths) / len(first_deaths), color=COLORS[2], linestyle="--",
                     label=f"mean: {sum(first_deaths)/len(first_deaths):.1f}d")
        ax1.legend()
    ax1.set_xlabel("Day of First Death")
    ax1.set_ylabel("Count")
    ax1.set_title("Neglectful Player: First Death Day")
    ax1.grid(True, axis="y")

    total_deaths = [r["deaths"] for r in data["neglectful"]]
    ax2.hist(total_deaths, bins=range(0, max(total_deaths) + 2), color=COLORS[6], edgecolor="#111", alpha=0.85)
    ax2.set_xlabel("Total Deaths (30 days)")
    ax2.set_ylabel("Count")
    ax2.set_title("Neglectful Player: Death Count Distribution")
    ax2.grid(True, axis="y")

    fig.tight_layout()
    save(fig, "03_neglectful_deaths")

# === 4. Exploration rate ===
if "exploration" in data:
    fig, ax1 = plt.subplots(figsize=(10, 5))
    ex = data["exploration"]
    days = [d["day"] for d in ex]

    ax1.plot(days, [d["segmentsVisited"] for d in ex], color=COLORS[0], label="Segments", linewidth=2)
    ax1.set_xlabel("Day")
    ax1.set_ylabel("Segments Visited", color=COLORS[0])
    ax1.tick_params(axis="y", labelcolor=COLORS[0])

    ax2 = ax1.twinx()
    ax2.plot(days, [d["booksRead"] for d in ex], color=COLORS[2], label="Books Read", linewidth=2)
    ax2.set_ylabel("Books Read", color=COLORS[2])
    ax2.tick_params(axis="y", labelcolor=COLORS[2])

    ax1.set_title("Random Walker: Exploration Over Time")
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left")
    ax1.grid(True)
    save(fig, "04_exploration")

# === 5. NPC population ===
if "npcPopulation" in data:
    fig, ax = plt.subplots(figsize=(10, 5))
    np_data = data["npcPopulation"]
    days = [d["day"] for d in np_data]

    dispositions = ["calm", "anxious", "mad", "catatonic", "dead"]
    disp_colors = [COLORS[5], COLORS[3], COLORS[0], COLORS[4], "#555"]
    bottoms = [0] * len(days)

    for disp, color in zip(dispositions, disp_colors):
        values = [d.get(disp, 0) for d in np_data]
        ax.bar(days, values, bottom=bottoms, color=color, label=disp, width=0.8, alpha=0.85)
        bottoms = [b + v for b, v in zip(bottoms, values)]

    ax.set_xlabel("Day")
    ax.set_ylabel("NPCs")
    ax.set_title("NPC Population: Disposition Over Time")
    ax.legend(loc="upper right")
    ax.set_ylim(0, 9)
    ax.yaxis.set_major_locator(ticker.MaxNLocator(integer=True))
    save(fig, "05_npc_population")

# === 6. Morale comparison ===
if "moraleCurves" in data:
    fig, ax = plt.subplots(figsize=(10, 5))
    mc = data["moraleCurves"]
    for i, (name, curve) in enumerate(mc.items()):
        days = [d["day"] for d in curve]
        morale = [d["morale"] for d in curve]
        ax.plot(days, morale, color=COLORS[i], label=name, linewidth=2)
        # Mark despairing days
        desp_days = [d["day"] for d in curve if d.get("despairing")]
        desp_morale = [d["morale"] for d in curve if d.get("despairing")]
        if desp_days:
            ax.scatter(desp_days, desp_morale, color=COLORS[i], marker="x", s=40, zorder=5)

    ax.axhline(0, color="#e94560", linestyle=":", alpha=0.5, label="despairing threshold")
    ax.axhline(15, color="#f5a623", linestyle=":", alpha=0.5, label="recovery threshold")
    ax.set_xlabel("Day")
    ax.set_ylabel("Morale")
    ax.set_title("Morale Trajectories by Playstyle (x = despairing)")
    ax.legend(loc="lower left")
    ax.set_ylim(-5, 105)
    ax.grid(True)
    save(fig, "06_morale_comparison")

# === 7. Systematic search rate ===
if "systematicRate" in data:
    fig, ax1 = plt.subplots(figsize=(10, 5))
    sr = data["systematicRate"]
    days = [d["day"] for d in sr]

    ax1.bar(days, [d["booksRead"] for d in sr], color=COLORS[0], alpha=0.7, label="Total Books Read")
    ax1.set_xlabel("Day")
    ax1.set_ylabel("Cumulative Books Read", color=COLORS[0])
    ax1.tick_params(axis="y", labelcolor=COLORS[0])

    ax2 = ax1.twinx()
    ax2.plot(days, [d["segmentsVisited"] for d in sr], color=COLORS[2], linewidth=2, label="Segments Visited")
    ax2.set_ylabel("Segments Visited", color=COLORS[2])
    ax2.tick_params(axis="y", labelcolor=COLORS[2])

    ax1.set_title("Systematic Search: Coverage Rate")
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left")
    ax1.grid(True, axis="y")
    save(fig, "07_systematic_rate")

# === Dashboard ===
print(f"\nAll charts saved to {out_dir}/")
