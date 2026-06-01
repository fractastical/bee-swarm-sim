# Bee Swarm Simulation

Local-cue bee colony simulation with foraging, recruitment, and waggle dance behavior.

## Run

- Open `bee_swarm_live_sim.html` in a browser.
- No build step or dependencies are required.
- Project files:
  - `bee_swarm_live_sim.html` (layout/markup)
  - `styles.css` (all styling)
  - `app.js` (simulation logic and rendering)

## Main Features

- Agent-based bees (no global coordinator).
- Waggle dance recruitment and memory-based foraging.
- Core signal primitives: waggle (positive), stop (negative), tremble (receiver recruitment), shaking (activation).
- Adjustable world size (`1.0x` to `10.0x`) for larger simulations.
- Hive zoom inset for close-up waggle dance behavior.
- Live metrics, communication manifold, and mini heat panels.

## Controls

- **Pause / Resume**: Pause or resume simulation updates.
- **Step Simulation**: Advance by one simulation step.
- **Reset Simulation**: Restart with current settings.
- **Randomize Configuration**: Randomize selected model parameters.
- **Clear Trails**: Clear path trail rendering.
- **Export Results JSON**: Download current run summary and recent events.
- **Information model** (`Waggle Dance` panel):
  - `Citation-backed`: uses literature-informed ranges for direction/distance payload and follower sampling.
  - `Heuristic`: uses the original hand-tuned approximation.
- **Simulation engine** (`Hive Configuration` panel):
  - `Internal sim`: runs the built-in model.
  - `BeeStack trace`: replays externally generated frames.
- **Load BeeStack Trace JSON**: imports a trace file with a top-level `frames` array.

## Hive Zoom Tools

In the live swarm panel toolbar:

- `⌕` toggle hive zoom panel.
- `＋` zoom in on hive behavior.
- `－` zoom out.
- `⛶` reset hive zoom.

The hive zoom panel highlights:

- figure-eight waggle traces for active dancers,
- dance direction vectors (encoded food direction),
- dense local behavior near the hive.

## Keyboard Shortcuts

- `Space`: pause/resume
- `R`: reset simulation
- `C`: clear trails

## Notes

- Larger world sizes increase rendering and simulation cost.
- If performance drops, reduce `Total bees`, `Flower patches`, or `Simulation speed`.

## Sources & assumptions (citation-backed mode)

The simulation remains simplified, but citation-backed mode aligns information estimates with established waggle-dance findings:

- Waggle run angle communicates direction, waggle run duration communicates distance.
- Dances are figure-eight with repeated waggle runs; followers usually sample only a few runs before departing.
- Distance decoding is calibration-dependent and can be non-linear across longer ranges.

References:

- Karl von Frisch, *The Dance Language and Orientation of Bees* (1967).
- Thomas D. Seeley, *The Wisdom of the Hive* (1995).
- Couvillon et al. (2019), calibration review context: [The dance legacy of Karl von Frisch](https://pmc.ncbi.nlm.nih.gov/articles/PMC6383784/).
- Schurch et al. (2021), calibration protocol context: [Honey bees communicate distance via non-linear waggle duration functions](https://pmc.ncbi.nlm.nih.gov/articles/PMC8029670/).
- Ai et al. (2019), follower interaction and sensory channels: [Neuroethology of the Waggle Dance](https://pmc.ncbi.nlm.nih.gov/articles/PMC6835826/).
- Menzel et al. (2023), recruits infer source location from dance information: [Honey bees infer source location from the dances of returning foragers](https://pmc.ncbi.nlm.nih.gov/articles/PMC10041085/).
- Shannon (1948), information-theoretic bit/entropy framing used for model information metrics.
- Fisher (1993), circular statistics framing used for directional coherence metrics.
- Pearson (1895), coefficient-of-variation framing used for distance coherence metrics.

## Core primitive reference

- **Waggle**: positive feedback signal encoding direction + distance to profitable forage.
- **Stop**: local inhibitory signal that shortens/weakens active dance promotion.
- **Tremble**: emitted under unloading pressure to recruit/activate processing labor before more recruitment.
- **Shaking**: broad activation signal that reduces idle delays and increases worker activity in-hive.

## Environment data vs reality mapping

- **Env Data Volume**: approximate total state information tracked by the simulation (bee state, flower state, and event state), expressed in bits.
- **Reality Equivalent**: converts `Env Data Volume` to an equivalent count of waggle runs using the active information model's per-run payload assumptions.
- This is a scale interpretation tool, not a claim that bees explicitly encode all simulated state in dance signals.

## BeeStack trace schema (minimum)

```json
{
  "dt": 0.033,
  "frames": [
    {
      "time": 0.0,
      "world": { "w": 1200, "h": 680 },
      "hive": { "x": 160, "y": 350, "r": 92 },
      "bees": [{ "id": 0, "x": 120, "y": 330, "vx": 0, "vy": 0, "heading": 0, "state": "idle", "role": "idle" }],
      "flowers": [{ "id": 0, "x": 900, "y": 300, "nectar": 80, "cap": 120, "confidence": 0.3, "discovered": true }],
      "signals": [{ "type": "waggle", "t": 0.0 }]
    }
  ]
}
```
