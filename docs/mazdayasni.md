# Mazdayasni: A Zoroastrian NPC Psychology and Social Physics System

## Design Document — Interactive Fiction / Narrative Engine

---

## 0. Design Philosophy

This system models NPC interiority and social behavior using two layered subsystems derived from Zoroastrian faculty psychology:

- **Soul-Faculties (Avestan pentad):** The NPC's perceptual and experiential substrate — *how they process the world and what they are becoming.*
- **Amesha Spenta Capacities:** The NPC's moral-practical capacities — *what they can do in the world and how well.*

These layers are bridged by:

- **Mainyu (Orientation):** A modal state — not a stat but a *lens* — determining whether the NPC's faculties and capacities are operating in a Spenta (creative/progressive) or Angra (hostile/destructive) register.
- **Daena (Conscience-Accumulator):** A running record of the NPC's moral choices that, at thresholds, gains its own agency and begins to constrain or compel behavior.

The system is designed for narrative engines where NPCs must make decisions, form relationships, react to player actions, and change over time in ways that feel internally motivated rather than scripted.

---

## 1. Layer 1: Soul-Faculties (Perceptual Substrate)

Each NPC has five soul-faculty values, integers on a scale of **0–100**. These represent not what the NPC *chooses* but what they are *capable of perceiving, feeling, and becoming*.

### 1.1 Faculty Definitions

| Faculty | Avestan | Type | Domain | What It Governs |
|---------|---------|------|--------|-----------------|
| **Life-Force** | `ahu` | Vitality | Embodiment | Physical resilience, will to continue, raw aliveness. Depleted by trauma, exhaustion, despair. An NPC with low ahu is brittle — they break under pressure others survive. |
| **Conscience** | `daena` | Perception | Moral Sight | Capacity to perceive the moral weight of situations. High daena: the NPC *notices* when something is wrong. Low daena: moral blindness, not malice — they literally do not see the ethical dimension. |
| **Sense-Reason** | `budha` | Cognition | Intellect & Senses | Ability to process information, reason about means and ends, perceive the material world accurately. Low budha: gullible, confused, easily deceived. High budha: perceptive, analytical, hard to fool. |
| **Cultivated Soul** | `urvan` | Accumulation | Character | The sum of what the NPC has become through their choices. Unlike other faculties, urvan is *primarily modified by NPC actions* rather than external events. It is the soul-as-cultivated-artifact. Starts at 50 (neutral). |
| **Ideal Self** | `fravashi` | Archetype | Aspiration | The NPC's higher self, their best possible version. Mostly static — set at NPC creation to represent their potential ceiling. Acts as an attractor: the closer urvan approaches fravashi, the more coherent and potent the NPC becomes. The gap between urvan and fravashi is the NPC's *spiritual tension*. |

### 1.2 Faculty Interactions

- **Spiritual Tension** = `|fravashi - urvan|`. High tension → instability, susceptibility to crisis and transformation. Low tension → groundedness (if urvan is high) or complacency (if both are low).
- **Moral Perception Check**: When an event with moral valence occurs, the NPC's `daena` is tested against a threshold. If `daena < threshold`, the NPC does not register the event as morally significant at all — it passes through them without engaging the choice system.
- **Vitality Gate**: If `ahu < 20`, the NPC enters survival mode. All Amesha Spenta capacities are halved. The NPC cannot act from higher motives — they are reduced to self-preservation. This is not evil; it is depletion.
- **Deception Vulnerability**: `budha` is the primary defense against lies, manipulation, and illusion. Social attacks target budha. An NPC with high daena but low budha *knows something is wrong* but cannot figure out what.

### 1.3 Faculty Modification Rules

| Faculty | Increases When | Decreases When |
|---------|---------------|----------------|
| `ahu` | Rest, safety, community, meaningful work, victory | Trauma, deprivation, isolation, sustained fear, grief |
| `daena` | Witnessing consequences of choices, moral mentorship, reflection | Prolonged moral compromise, isolation from consequences, rationalization loops |
| `budha` | Study, exposure to complexity, successful problem-solving | Deception (being deceived erodes confidence), sensory deprivation, sustained confusion |
| `urvan` | Good choices (moves toward fravashi), self-sacrifice, keeping commitments | Bad choices (moves away from fravashi), betrayal, cowardice, cruelty |
| `fravashi` | **Does not change.** Set at creation. It is the fixed star. | Never. |

---

## 2. Layer 2: Amesha Spenta Capacities (Action Stats)

Seven capacity scores, integers **0–100**, representing what the NPC can *do* in the world. These are conventional stats in the sense that they gate actions, but they are colored by the mainyu system (Section 3).

### 2.1 Capacity Definitions

| Capacity | Avestan | Domain | What It Gates |
|----------|---------|--------|---------------|
| **Good Mind** | `vohu_manah` | Cognition-in-action | Quality of plans, advice, persuasion, teaching. The ability to think *well* — not just accurately (that's budha) but *toward the good*. High VM: the NPC gives wise counsel. Low VM: their thinking is clever but misguided. |
| **Best Truth** | `asha_vahishta` | Integrity | Ability to perceive and enact cosmic/social order. Governs: promise-keeping, justice, detecting falsehood in others, resistance to corruption. The NPC's relationship to *how things should be*. |
| **Good Authority** | `vohu_xshathra` | Power & Agency | Capacity to lead, command, protect, enforce. Not raw strength — the ability to *direct* force and organize others. An NPC with high VX can rally people, hold a line, make hard decisions stick. |
| **Right Devotion** | `spenta_armaiti` | Care & Stewardship | Capacity for patient, sustained nurture. Governs: healing, agriculture, craftsmanship, long-term care relationships, ecological sensitivity. The NPC's ability to tend things. |
| **Perfection** | `haurvatat` | Completion | Ability to bring things to wholeness. Governs: finishing projects, healing wounds (physical and social), resolving conflicts, making things *right*. Distinct from SA (which tends) — HAU *completes*. |
| **Immortality** | `ameretat` | Endurance & Legacy | Capacity to create things that outlast the self. Governs: teaching that persists, building institutions, creating art, planting forests. The NPC's reach beyond their own lifetime. |
| **Holy Listening** | `sraosha` | Receptivity | Capacity to hear what is actually being said — by people, by situations, by the world. Governs: empathy, negotiation, prayer, intelligence-gathering. The NPC's ability to *receive* information without distorting it. |

### 2.2 Capacity Checks

When an NPC attempts an action, the relevant capacity is tested:

```
success = (capacity_score + faculty_modifier + mainyu_modifier) >= difficulty
```

- **faculty_modifier**: Derived from the most relevant soul-faculty. E.g., `vohu_manah` checks add `budha / 5` (rounded down). `asha_vahishta` checks add `daena / 5`. See Faculty-Capacity Coupling Table (2.3).
- **mainyu_modifier**: See Section 3. Ranges from -20 to +20 depending on alignment between action and current mainyu state.

### 2.3 Faculty-Capacity Coupling Table

Each capacity has a **primary** and **secondary** faculty coupling:

| Capacity | Primary Faculty | Secondary Faculty | Modifier Formula |
|----------|----------------|-------------------|------------------|
| `vohu_manah` | `budha` | `daena` | `budha/5 + daena/10` |
| `asha_vahishta` | `daena` | `budha` | `daena/5 + budha/10` |
| `vohu_xshathra` | `ahu` | `urvan` | `ahu/5 + urvan/10` |
| `spenta_armaiti` | `urvan` | `daena` | `urvan/5 + daena/10` |
| `haurvatat` | `budha` | `urvan` | `budha/5 + urvan/10` |
| `ameretat` | `fravashi` | `urvan` | `fravashi/5 + urvan/10` |
| `sraosha` | `daena` | `ahu` | `daena/5 + ahu/10` |

Note: `ameretat` is uniquely coupled to `fravashi` — the NPC's capacity for legacy depends on how high their ideal self is set. This is intentional: an NPC with a low ceiling cannot build things that outlast them.

---

## 3. The Mainyu System (Modal Orientation)

### 3.1 Overview

Mainyu is **not a stat**. It is a **mode**. Each NPC has a `mainyu_state` that is one of three values:

```
SPENTA   — creative, progressive, oriented toward order
NEUTRAL  — uncommitted, reactive, default state
ANGRA    — hostile, destructive, oriented toward chaos
```

And a `mainyu_pressure` value (integer, **-100 to +100**) that represents accumulated pressure toward one pole or the other:

- **+100** = deep Spenta. Locked into creative/ordering mode.
- **0** = neutral. Responsive to immediate circumstances.
- **-100** = deep Angra. Locked into destructive/chaotic mode.

### 3.2 State Transitions

```
if mainyu_pressure > +30:  mainyu_state = SPENTA
if mainyu_pressure < -30:  mainyu_state = ANGRA
if -30 <= mainyu_pressure <= +30:  mainyu_state = NEUTRAL
```

There is **hysteresis** — once in SPENTA or ANGRA, the NPC does not return to NEUTRAL until pressure crosses back past ±15 (not ±30). This models psychological inertia: once you've committed to a mode, it takes significant counter-pressure to dislodge you.

```
# Transition thresholds with hysteresis
if current_state == NEUTRAL:
    if pressure > 30: transition to SPENTA
    if pressure < -30: transition to ANGRA

if current_state == SPENTA:
    if pressure < 15: transition to NEUTRAL

if current_state == ANGRA:
    if pressure > -15: transition to NEUTRAL
```

### 3.3 Mainyu Modifiers

The mainyu state modifies capacity checks:

| Mainyu State | Action Aligned With State | Action Opposed to State | Neutral Action |
|-------------|--------------------------|------------------------|----------------|
| SPENTA | +15 | -10 | +5 |
| NEUTRAL | +0 | +0 | +0 |
| ANGRA | +15 | -10 | +5 |

Key insight from the theology: **both orientations are equally potent for aligned actions.** An NPC in deep Angra is just as effective at destruction as a Spenta NPC is at creation. The asymmetry is in *what actions are available* and in the daena accumulator (Section 4).

### 3.4 Pressure Sources

| Event | Pressure Change |
|-------|----------------|
| NPC chooses to help at personal cost | +10 to +20 |
| NPC witnesses beauty, order, justice | +5 to +10 |
| NPC is shown mercy | +5 to +15 |
| NPC receives community support | +5 |
| NPC betrays a trust | -10 to -20 |
| NPC witnesses cruelty without acting | -5 to -10 |
| NPC is betrayed | -5 to -15 |
| NPC chooses destruction when alternatives exist | -10 to -20 |
| NPC is isolated for extended period | -3 per time unit |
| NPC achieves a goal through honest means | +5 to +10 |
| NPC rationalizes a harmful choice | -5 (cumulative; see 4.2) |

Note: isolation *always* pushes toward Angra. This is theologically grounded — community (anjoman) is a core Zoroastrian practice, and the religion explicitly holds that isolation from others degrades the soul.

---

## 4. The Daena Accumulator (Conscience-as-Entity)

This is the system's most distinctive mechanic and the one most directly derived from the theology.

### 4.1 Structure

Each NPC has a `daena_record`: a list of **moral events** — choices the NPC has made that engaged the moral perception system (i.e., events that passed the `daena` threshold check in Section 1.2).

Each record entry is a tuple:

```
(timestamp, choice_type, weight, mainyu_at_time, context_tag)
```

Where:
- `choice_type` ∈ {SPENTA_CHOICE, ANGRA_CHOICE, AMBIGUOUS}
- `weight` ∈ 1–10 (severity/significance of the choice)
- `mainyu_at_time` = the NPC's mainyu_pressure when the choice was made
- `context_tag` = a string identifying the situation (for narrative retrieval)

### 4.2 The Accumulator Score

```
daena_score = sum(entry.weight * polarity(entry.choice_type) for entry in daena_record)
```

Where `polarity(SPENTA_CHOICE) = +1`, `polarity(ANGRA_CHOICE) = -1`, `polarity(AMBIGUOUS) = 0`.

This score represents the *shape* of the NPC's accumulated conscience.

### 4.3 Threshold Effects — The Daena Personifies

At certain absolute values of `daena_score`, the accumulator begins to exhibit **autonomous behavior** — the NPC's conscience starts acting as a semi-independent agent within them.

| |daena_score| | Threshold Name | Effect |
|------------|----------------|--------|
| 0–30 | **Quiet Conscience** | No autonomous effects. The NPC's choices are fully their own. |
| 31–60 | **Whispering Conscience** | The NPC occasionally receives *involuntary moral perceptions* — they notice things they wouldn't otherwise notice. Mechanically: +10 to daena (faculty) for perception checks on events aligned with the conscience's polarity. |
| 61–90 | **Insistent Conscience** | The conscience begins to *resist* actions that contradict it. Mechanically: -15 to capacity checks for actions opposed to the accumulated polarity. The NPC can still choose freely, but acting against their conscience is harder. |
| 91–120 | **Commanding Conscience** | The conscience compels. The NPC must pass an `ahu` check (difficulty 60) to take actions opposed to their accumulated polarity. Failure = the NPC cannot bring themselves to act. |
| 121+ | **The Maiden at the Bridge** | The conscience has fully personified. It is now an autonomous sub-agent. In narrative terms: the NPC has *become* their choices. They can no longer act against their accumulated polarity without a catastrophic internal crisis (see 4.4). |

### 4.4 Catastrophic Reversal

An NPC at "Maiden at the Bridge" threshold who is *forced* (by circumstance, not choice) into actions opposing their polarity experiences a **daena crisis**:

1. `ahu` drops by 30 (the vitality cost of self-betrayal).
2. `urvan` drops by 20 (the soul is damaged).
3. `mainyu_pressure` shifts 40 points toward the *forced* action's polarity.
4. All `daena_record` entries older than a threshold are *halved in weight* — the conscience is destabilized.

This models the Zoroastrian idea that a deeply formed conscience, when violated, doesn't just suffer — it *breaks*, and the NPC may swing violently toward the opposite pole. A lifelong saint forced into atrocity doesn't just feel bad; they may become a monster, because the entire structure of their moral self has shattered.

---

## 5. Social Physics

### 5.1 Relational State

Each NPC maintains a relationship vector toward every other NPC they are aware of:

```
relationship = {
    target_id: str,
    trust: int,       # -100 to +100
    obligation: int,   # 0 to 100 (asymmetric; what I owe them)
    resonance: int,    # -100 to +100 (do our mainyu states harmonize?)
    history: [(timestamp, event_type, intensity)]
}
```

### 5.2 Trust Mechanics

Trust is modified by observed behavior, filtered through the perceiving NPC's faculties:

```
trust_delta = base_event_impact * (perceiver.budha / 50) * (perceiver.daena / 50)
```

An NPC with low budha may not *notice* a betrayal. An NPC with low daena may notice it but not *care*. Both are required for trust to move accurately.

**Trust Asymmetry**: Trust decreases faster than it increases. Ratio is 2:1 — a betrayal of magnitude X reduces trust by 2X, while a kindness of magnitude X increases trust by X. This is the "negativity bias" and it's theologically grounded: druj (deception) is corrosive, and the damage it does is disproportionate to the effort required.

### 5.3 Resonance

Resonance measures mainyu compatibility between two NPCs:

```
resonance = 100 - |npc_a.mainyu_pressure - npc_b.mainyu_pressure|
```

Two NPCs deep in Spenta resonate strongly (+100). One Spenta and one Angra have negative resonance. This affects:

- **Willingness to cooperate**: resonance < -30 → NPC will not voluntarily cooperate.
- **Communication clarity**: resonance modifies `sraosha` checks between the two NPCs. High resonance = +10, low resonance = -10. People on the same moral wavelength *hear each other better*.
- **Influence susceptibility**: An NPC is more susceptible to influence from NPCs with high resonance. This cuts both ways — a group of Angra-aligned NPCs reinforce each other's destructive orientation.

### 5.4 Obligation (Ashavan Debt)

Obligation is tracked asymmetrically. If NPC_A saves NPC_B's life, NPC_B's obligation toward NPC_A increases, but not vice versa. Obligation decays slowly over time (half-life of ~20 time units) but can be *discharged* by reciprocal action.

An NPC with high `asha_vahishta` (sense of cosmic order) *feels* obligation more keenly and is more likely to act on it. An NPC with low `asha_vahishta` may ignore debts — but this registers as an ANGRA_CHOICE in their daena accumulator if their `daena` (faculty) is high enough to notice.

### 5.5 Group Dynamics — The Anjoman Effect

When three or more NPCs with mutual resonance > 50 are in proximity for sustained periods, they form an **anjoman** (community). The anjoman has emergent properties:

- **Mainyu Averaging**: Members' mainyu_pressure slowly converges toward the group mean. Rate: 1 point per time unit toward the mean. This models social pressure and moral contagion.
- **Ahu Support**: Members in an anjoman gain +1 ahu per time unit (up to their pre-isolation baseline). Community sustains life-force.
- **Daena Amplification**: Moral perception checks within the anjoman get +5 to daena. You see more clearly when others are watching with you.
- **Dissent Cost**: An NPC whose mainyu_pressure diverges from the anjoman mean by more than 40 points experiences social friction: -5 to all capacity checks involving other anjoman members. This can push dissidents out — or, if their conscience is strong enough, force a confrontation that shifts the group.

---

## 6. Decision Engine

### 6.1 NPC Choice Architecture

When an NPC faces a choice, the engine evaluates:

1. **Perception Gate**: Does the NPC *see* the choice? Check `daena` (faculty) against the event's moral visibility threshold. Check `budha` against the event's informational complexity. If either fails, the NPC doesn't register that dimension of the choice and acts on incomplete information.

2. **Mainyu Coloring**: The NPC's current mainyu_state determines which options they *generate*. A SPENTA NPC generates creative/constructive options. An ANGRA NPC generates destructive/exploitative options. A NEUTRAL NPC generates both but with less conviction.

3. **Capacity Weighting**: Each option is evaluated against the NPC's capacities. NPCs prefer options where their strongest capacities apply — a high-VX NPC gravitates toward solutions involving authority; a high-SA NPC toward solutions involving patience and care.

4. **Daena Constraint**: The accumulated conscience applies its threshold effect (Section 4.3). At high thresholds, some options are simply *unavailable* — the NPC cannot bring themselves to choose them.

5. **Social Modifiers**: Trust, obligation, and resonance with involved parties modify option weights. An NPC is more likely to help someone they trust, more likely to honor obligations, more likely to agree with resonant allies.

6. **Resolution**: The highest-weighted available option is selected. Ties are broken by `urvan` — the NPC's cultivated soul serves as the tiebreaker, reflecting their settled character.

### 6.2 Choice Consequences

Every choice that passes the daena perception gate generates:

1. A `daena_record` entry (Section 4.1).
2. Modification to relevant soul-faculties (Section 1.3).
3. Modification to `mainyu_pressure` (Section 3.4).
4. Modification to relationships with involved parties (Section 5.2).
5. Narrative output — a description of the NPC's action and internal state, drawn from context tags.

---

## 7. NPC Archetypes (Initialization Templates)

These are starting configurations, not classes. NPCs diverge from their archetypes through play.

### 7.1 The Righteous Worker (Ashavan)

```
ahu: 70    daena: 75    budha: 55    urvan: 60    fravashi: 80
vohu_manah: 50    asha_vahishta: 75    vohu_xshathra: 40
spenta_armaiti: 70    haurvatat: 60    ameretat: 45    sraosha: 65
mainyu_pressure: +40 (SPENTA)
```

High conscience, high devotion, moderate intellect. Sees the moral dimension clearly, tends things with patience, but may lack the analytical sophistication to navigate complex deception. Vulnerable to manipulation by high-budha Angra NPCs.

### 7.2 The Clever Deceiver (Drujvant)

```
ahu: 65    daena: 30    budha: 85    urvan: 35    fravashi: 70
vohu_manah: 70    asha_vahishta: 25    vohu_xshathra: 60
spenta_armaiti: 20    haurvatat: 40    ameretat: 55    sraosha: 45
mainyu_pressure: -45 (ANGRA)
```

Sharp mind, dim conscience. Can plan brilliantly but doesn't perceive the moral weight of their actions. Note the gap between fravashi (70) and urvan (35) — massive spiritual tension. This NPC *could* be much more than they are. Whether that tension resolves upward or downward is the story.

### 7.3 The Exhausted Saint

```
ahu: 15    daena: 90    budha: 60    urvan: 80    fravashi: 85
vohu_manah: 65    asha_vahishta: 80    vohu_xshathra: 50
spenta_armaiti: 70    haurvatat: 55    ameretat: 60    sraosha: 75
mainyu_pressure: +25 (NEUTRAL — recently dropped from SPENTA)
```

Ahu below 20: survival mode engaged. All capacities halved. This is a deeply good person who has been ground down — they can see what's right, they *know* what's right, but they can't act on it because they have nothing left. The system models this without moralizing: depletion is not failure. The path back requires community (anjoman effect) and rest, not willpower.

### 7.4 The Broken Mirror (Post-Crisis)

```
ahu: 35    daena: 70    budha: 65    urvan: 25    fravashi: 85
vohu_manah: 55    asha_vahishta: 40    vohu_xshathra: 70
spenta_armaiti: 30    haurvatat: 25    ameretat: 50    sraosha: 35
mainyu_pressure: -55 (ANGRA)
daena_score: -85 (Insistent Conscience, negative polarity)
```

The fravashi-urvan gap here (60 points) is the widest in any archetype. This NPC experienced a catastrophic reversal — once aligned with their ideal self, now maximally distant from it. Their conscience is loud and insistent, but in the *wrong direction*: it reinforces their destructive pattern. They know exactly what they're doing and have built a moral structure that justifies it. Recovery requires the conscience itself to be destabilized — usually through a shock that makes the NPC *unable to rationalize*.

---

## 8. Implementation Notes

### 8.1 State Update Loop

```
for each time_unit:
    for each npc:
        # Passive changes
        apply_anjoman_effects(npc)
        decay_obligations(npc)
        apply_isolation_penalty(npc)  # if not in anjoman

        # Check for survival mode
        if npc.ahu < 20:
            npc.survival_mode = True
        else:
            npc.survival_mode = False

        # Mainyu hysteresis
        update_mainyu_state(npc)

    for each event in event_queue:
        for each npc in event.observers:
            # Perception gates
            moral_visible = check_daena(npc, event)
            info_visible = check_budha(npc, event)

            if moral_visible or info_visible:
                options = generate_options(npc, event, moral_visible, info_visible)
                choice = evaluate_and_select(npc, options)
                apply_consequences(npc, choice)
```

### 8.2 Serialization

Full NPC state is serializable as JSON:

```json
{
    "id": "npc_001",
    "name": "Azar",
    "faculties": {
        "ahu": 70, "daena": 75, "budha": 55,
        "urvan": 60, "fravashi": 80
    },
    "capacities": {
        "vohu_manah": 50, "asha_vahishta": 75,
        "vohu_xshathra": 40, "spenta_armaiti": 70,
        "haurvatat": 60, "ameretat": 45, "sraosha": 65
    },
    "mainyu": {
        "pressure": 40,
        "state": "SPENTA"
    },
    "daena_record": [
        {
            "timestamp": 1,
            "choice_type": "SPENTA_CHOICE",
            "weight": 5,
            "mainyu_at_time": 35,
            "context_tag": "sheltered_stranger_during_storm"
        }
    ],
    "daena_score": 42,
    "relationships": {},
    "anjoman_id": null,
    "survival_mode": false
}
```

### 8.3 Narrative Surface

The engine should expose hooks for narrative generation at each decision point:

- `npc.internal_state_summary()` → human-readable description of what the NPC is experiencing
- `npc.choice_rationale(choice)` → why the NPC chose what they chose, referencing faculties and conscience
- `npc.daena_voice(threshold_level)` → what the NPC's conscience is "saying" at their current accumulator level
- `npc.relationship_posture(target)` → how the NPC regards a specific other, based on trust/obligation/resonance

---

## 9. Open Design Questions

1. **Fravashi modification**: The current design holds fravashi fixed at creation. An alternative: fravashi can be *revealed* (not changed) through play — the NPC discovers their ceiling is higher or lower than initially assumed. This adds narrative potential but complicates the math.

2. **Daena decay**: Should old moral choices fade in weight? The theology says no — the conscience is permanent. But gameplay may benefit from some decay to prevent NPCs from becoming locked in. Current compromise: no decay unless a catastrophic reversal occurs (Section 4.4).

3. **Inter-NPC daena transfer**: Can one NPC's moral testimony shift another's conscience? The Sraosha (holy listening) capacity suggests yes, but the mechanic needs design. Proposal: a high-sraosha NPC hearing another's daena_voice at "Insistent" threshold or above can receive a temporary daena_faculty boost.

4. **Player character**: Is the player an NPC in this system, or an outside agent? If the former, the player's own daena accumulates and constrains them. If the latter, the player is essentially a Yazata — a divine agent operating outside the mainyu system. Both are viable, with very different tonal implications.

5. **The Chinvat Bridge**: Should there be a mechanical "judgment" event — a moment where the NPC's accumulated daena is evaluated as a whole and produces a final outcome? In a narrative with death, this is the obvious endpoint. But it could also be triggered by any sufficiently grave crisis.
