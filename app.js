(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const BASE_WORLD = { w: 1200, h: 680 };
  const WORLD = { w: BASE_WORLD.w, h: BASE_WORLD.h };
  const BASE_HIVE = { x: 160, y: 350, r: 92 };
  const hive = { x: BASE_HIVE.x, y: BASE_HIVE.y, r: BASE_HIVE.r };
  const el = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
  const randRange = (a, b) => a + Math.random() * (b - a);
  const hypot = Math.hypot;
  const dist = (a, b) => hypot(a.x - b.x, a.y - b.y);
  const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  const fmtTime = s => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(TAU * v);
  }

  const cfg = {
    engine: 'internal',
    worldScale: 1.0,
    beeCount: 420,
    flowerCount: 3,
    simSpeed: 1,
    infoModel: 'citation',
    nectarRegen: 0.28,
    forageRate: 1,
    beeSpeed: 82,
    noise: 0.22,
    avoidance: 17,
    danceTempo: 0.65,
    danceInfluence: 0.52,
    danceDuration: 10,
    trembleSensitivity: 0.68,
    stopInfluence: 0.62,
    shakeInfluence: 0.54,
    scoutFrac: 0.18,
    scentRadius: 135,
    trailFade: 0.962,
    listenRadius: 68
  };

  const controls = {
    engine: { cast: String, fmt: v => v === 'beestack_trace' ? 'BeeStack trace' : 'Internal sim' },
    worldScale: { cast: Number, fmt: v => `${Number(v).toFixed(1)}×` },
    infoModel: { cast: String, fmt: v => v === 'citation' ? 'citation-backed' : 'heuristic' },
    beeCount: { cast: Number, fmt: v => Math.round(v).toLocaleString() },
    flowerCount: { cast: Number, fmt: v => Math.round(v) },
    simSpeed: { cast: Number, fmt: v => `${Number(v).toFixed(1)}×` },
    nectarRegen: { cast: Number, fmt: v => Number(v).toFixed(2) },
    forageRate: { cast: Number, fmt: v => Number(v).toFixed(2) },
    beeSpeed: { cast: Number, fmt: v => `${Math.round(v)} px/s` },
    noise: { cast: Number, fmt: v => Number(v).toFixed(2) },
    avoidance: { cast: Number, fmt: v => `${Math.round(v)} px` },
    danceTempo: { cast: Number, fmt: v => `${Number(v).toFixed(2)}×` },
    danceInfluence: { cast: Number, fmt: v => Number(v).toFixed(2) },
    danceDuration: { cast: Number, fmt: v => `${Number(v).toFixed(1)} s` },
    scoutFrac: { cast: Number, fmt: v => `${Math.round(v * 100)}%` },
    scentRadius: { cast: Number, fmt: v => `${Math.round(v)} px` },
    trailFade: { cast: Number, fmt: v => Number(v).toFixed(3) }
  };

  const INFO_MODEL_SPECS = {
    heuristic: {
      label: 'heuristic',
      directionBits: 4.7,
      distanceBits: 3.5,
      qualityBits: 2.0,
      followerRunsToDecode: 2.0,
      confidenceWeight: 0.8
    },
    citation: {
      label: 'citation-backed',
      // Based on literature-guided assumptions:
      // - Direction encoded by waggle angle (von Frisch; Seeley reviews)
      // - Distance encoded by waggle-run duration with non-linear calibration context (Couvillon/Schurch line)
      // - Followers often sample a small number of runs (~2-4) before departure
      directionBits: 4.9,
      distanceBits: 3.2,
      qualityBits: 1.6,
      followerRunsToDecode: 3.0,
      confidenceWeight: 1.0
    }
  };

  const state = {
    bees: [], flowers: [], time: 0, running: true, delivered: 0, flowerVisits: 0,
    danceHistory: [], recruitEvents: [], efficiencySamples: [], pathSamples: [], deliveryEvents: [],
    signalEvents: [],
    lastMetrics: 0, lastHeat: 0, fps: 60, lastFrame: performance.now(), contacts: 0,
    tuning: false, tune: { lastTime: 0, rewardAtLast: 0, bestReward: 0, lastMutation: null, phase: 'manual' },
    view: { showHiveZoom: true, hiveZoom: 2.5 },
    trace: { active: false, frames: [], idx: 0, accum: 0, dt: 1 / 30, meta: {} }
  };

  const canvas = {
    world: el('world'), hiveZoom: el('hiveZoom'), manifold: el('manifold'),
    heatPhero: el('heatPhero'), heatNectar: el('heatNectar'), heatDance: el('heatDance'),
    heatBuzz: el('heatBuzz'), heatCoherence: el('heatCoherence'), heatRoutes: el('heatRoutes')
  };
  const ctx = Object.fromEntries(Object.entries(canvas).map(([k, c]) => [k, c.getContext('2d')]));
  const trails = document.createElement('canvas');
  trails.width = WORLD.w; trails.height = WORLD.h;
  const tctx = trails.getContext('2d');

  function applyWorldScale(nextScale) {
    const prevW = WORLD.w;
    const prevH = WORLD.h;
    cfg.worldScale = clamp(nextScale, 1, 2.4);
    WORLD.w = Math.round(BASE_WORLD.w * cfg.worldScale);
    WORLD.h = Math.round(BASE_WORLD.h * cfg.worldScale);
    const sx = WORLD.w / Math.max(1, prevW);
    const sy = WORLD.h / Math.max(1, prevH);
    hive.x = BASE_HIVE.x * cfg.worldScale;
    hive.y = BASE_HIVE.y * cfg.worldScale;
    hive.r = BASE_HIVE.r * Math.sqrt(cfg.worldScale);
    for (const b of state.bees) {
      b.x *= sx; b.y *= sy;
      b.lastX *= sx; b.lastY *= sy;
      if (b.target) { b.target.x *= sx; b.target.y *= sy; }
      if (b.memory) { b.memory.x *= sx; b.memory.y *= sy; }
      if (b.targetFlower) { b.targetFlower.x *= sx; b.targetFlower.y *= sy; b.targetFlower.r *= Math.sqrt((sx + sy) * 0.5); }
      if (b.danceBaseX) b.danceBaseX *= sx;
      if (b.danceBaseY) b.danceBaseY *= sy;
      if (b.danceTrace) b.danceTrace = b.danceTrace.map(p => ({ x: p.x * sx, y: p.y * sy }));
    }
    for (const f of state.flowers) {
      f.x *= sx; f.y *= sy; f.r *= Math.sqrt((sx + sy) * 0.5);
    }
    trails.width = WORLD.w;
    trails.height = WORLD.h;
    clearTrails();
  }

  function clearTraceState() {
    state.trace.active = false;
    state.trace.frames = [];
    state.trace.idx = 0;
    state.trace.accum = 0;
    state.trace.dt = 1 / 30;
    state.trace.meta = {};
  }

  function frameToBee(src, i) {
    const b = makeBee(i);
    b.id = src.id ?? i;
    b.x = Number(src.x ?? b.x);
    b.y = Number(src.y ?? b.y);
    b.lastX = Number(src.lastX ?? b.x);
    b.lastY = Number(src.lastY ?? b.y);
    b.vx = Number(src.vx ?? 0);
    b.vy = Number(src.vy ?? 0);
    b.heading = Number(src.heading ?? b.heading);
    b.state = src.state || b.state;
    b.role = src.role || b.role;
    b.carrying = Number(src.carrying ?? 0);
    b.wait = Number(src.wait ?? b.wait);
    b.pathLen = Number(src.pathLen ?? 0);
    b.source = src.source || b.source;
    b.target = src.target ? { ...src.target } : null;
    b.memory = src.memory ? { ...src.memory } : null;
    b.targetFlower = null;
    b.danceT = Number(src.danceT ?? b.danceT);
    b.dancePhase = Number(src.dancePhase ?? b.dancePhase);
    b.danceBaseX = Number(src.danceBaseX ?? b.danceBaseX);
    b.danceBaseY = Number(src.danceBaseY ?? b.danceBaseY);
    b.danceTrace = Array.isArray(src.danceTrace) ? src.danceTrace.map(p => ({ x: Number(p.x), y: Number(p.y) })) : [];
    b.trembleT = Number(src.trembleT ?? 0);
    b.postTrembleDance = Boolean(src.postTrembleDance ?? false);
    return b;
  }

  function frameToFlower(src, i) {
    return {
      x: Number(src.x ?? randRange(WORLD.w * 0.54, WORLD.w * 0.93)),
      y: Number(src.y ?? randRange(70, WORLD.h - 70)),
      r: Number(src.r ?? randRange(18, 31)),
      nectar: Number(src.nectar ?? 80),
      cap: Number(src.cap ?? 120),
      hue: Number(src.hue ?? [52, 280, 190, 320, 22, 105][i % 6]),
      discovered: Boolean(src.discovered ?? false),
      confidence: Number(src.confidence ?? 0.05),
      id: Number(src.id ?? i)
    };
  }

  function applyTraceFrame(frame) {
    if (frame.world?.w && frame.world?.h) {
      WORLD.w = Math.max(80, Math.round(frame.world.w));
      WORLD.h = Math.max(80, Math.round(frame.world.h));
      trails.width = WORLD.w;
      trails.height = WORLD.h;
    }
    if (frame.hive?.x != null && frame.hive?.y != null) {
      hive.x = Number(frame.hive.x);
      hive.y = Number(frame.hive.y);
      hive.r = Number(frame.hive.r ?? hive.r);
    }
    if (Array.isArray(frame.flowers)) state.flowers = frame.flowers.map(frameToFlower);
    if (Array.isArray(frame.bees)) state.bees = frame.bees.map(frameToBee);
    if (Array.isArray(frame.signals)) {
      for (const s of frame.signals) {
        if (!s?.type) continue;
        state.signalEvents.push({ t: Number(s.t ?? frame.time ?? state.time), type: String(s.type) });
      }
    }
    if (frame.time != null) state.time = Number(frame.time);
  }

  function resetTracePlayback() {
    state.trace.idx = 0;
    state.trace.accum = 0;
    state.signalEvents = [];
    const first = state.trace.frames[0];
    if (first) applyTraceFrame(first);
    clearTrails();
    updateMetrics(true);
  }

  function loadTraceObject(payload, sourceName = 'BeeStack trace') {
    const frames = Array.isArray(payload) ? payload : payload?.frames;
    if (!Array.isArray(frames) || !frames.length) {
      throw new Error('Trace JSON must contain a non-empty "frames" array.');
    }
    state.trace.frames = frames;
    state.trace.idx = 0;
    state.trace.accum = 0;
    state.trace.dt = Number(payload?.dt || payload?.meta?.dt || 1 / 30);
    state.trace.meta = payload?.meta || { source: sourceName };
    state.trace.active = true;
    cfg.engine = 'beestack_trace';
    syncControlsFromCfg();
    resetTracePlayback();
    el('tunerReadout').textContent = `Loaded ${sourceName}: ${frames.length.toLocaleString()} frames at ~${state.trace.dt.toFixed(3)} s/frame.`;
  }

  function simulateTrace(rawDt) {
    if (!state.trace.active || !state.trace.frames.length) return;
    const dt = clamp(rawDt, 0.001, 0.05) * cfg.simSpeed;
    state.trace.accum += dt;
    const frameDt = Math.max(1 / 240, state.trace.dt || 1 / 30);
    const prevIdx = state.trace.idx;
    while (state.trace.accum >= frameDt) {
      state.trace.accum -= frameDt;
      if (state.trace.idx < state.trace.frames.length - 1) state.trace.idx += 1;
    }
    if (state.trace.idx !== prevIdx) applyTraceFrame(state.trace.frames[state.trace.idx]);
    pruneEvents();
  }

  function resizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.max(10, Math.floor(r.width * dpr));
    const h = Math.max(10, Math.floor(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height, dpr };
  }
  function sizes() {
    return Object.fromEntries(Object.entries(canvas).map(([k,c]) => [k, resizeCanvas(c)]));
  }

  function randomFlower(i, n) {
    const lane = (i + 0.5) / Math.max(1, n);
    const x = randRange(WORLD.w * 0.54, WORLD.w * 0.93);
    const y = clamp(lerp(90, WORLD.h - 95, lane) + randRange(-80, 80), 70, WORLD.h - 70);
    return {
      x, y,
      r: randRange(18, 31),
      nectar: randRange(65, 100),
      cap: randRange(95, 130),
      hue: [52, 280, 190, 320, 22, 105][i % 6],
      discovered: false,
      confidence: 0.05,
      id: i
    };
  }
  function seedFlowers() {
    state.flowers = [];
    for (let i = 0; i < cfg.flowerCount; i++) state.flowers.push(randomFlower(i, cfg.flowerCount));
  }

  function makeBee(i) {
    const a = Math.random() * TAU;
    const rr = hive.r * Math.sqrt(Math.random()) * 0.65;
    return {
      id: i, x: hive.x + Math.cos(a) * rr, y: hive.y + Math.sin(a) * rr,
      lastX: hive.x, lastY: hive.y,
      vx: 0, vy: 0, heading: a, state: 'idle', role: 'idle', carrying: 0,
      wait: randRange(0, 6), age: randRange(0, 20), pathLen: 0, optimalDist: 0,
      memory: null, target: null, source: 'none', targetFlower: null, danceT: 0,
      dancePhase: Math.random() * TAU, danceBaseX: hive.x, danceBaseY: hive.y,
      failTimer: 0, colorPhase: Math.random() * TAU, recruitedAt: -999,
      successMemory: 0, danceTrace: [], trembleT: 0, postTrembleDance: false
    };
  }

  function ensureBeeCount() {
    const n = Math.round(cfg.beeCount);
    while (state.bees.length < n) state.bees.push(makeBee(state.bees.length));
    if (state.bees.length > n) state.bees.length = n;
  }

  function resetSimulation(keepConfig = true) {
    if (cfg.engine === 'beestack_trace' && state.trace.active) {
      resetTracePlayback();
      return;
    }
    state.bees = [];
    state.time = 0; state.delivered = 0; state.flowerVisits = 0;
    state.danceHistory = []; state.recruitEvents = []; state.efficiencySamples = [];
    state.pathSamples = []; state.deliveryEvents = []; state.signalEvents = []; state.contacts = 0;
    state.tune.lastTime = 0; state.tune.rewardAtLast = 0; state.tune.bestReward = 0; state.tune.lastMutation = null;
    if (!keepConfig) randomizeConfig();
    applyWorldScale(cfg.worldScale);
    seedFlowers(); ensureBeeCount(); clearTrails(); updateMetrics(true);
  }

  function clearTrails() {
    tctx.clearRect(0,0,WORLD.w,WORLD.h);
  }

  function randomizeConfig() {
    cfg.worldScale = randRange(1.0, 2.3);
    cfg.scoutFrac = randRange(0.08, 0.32);
    cfg.danceInfluence = randRange(0.32, 0.78);
    cfg.noise = randRange(0.11, 0.38);
    cfg.scentRadius = randRange(95, 190);
    cfg.beeSpeed = randRange(65, 105);
    cfg.nectarRegen = randRange(0.12, 0.55);
    cfg.danceDuration = randRange(7, 16);
    cfg.flowerCount = Math.round(randRange(2, 5));
    applyWorldScale(cfg.worldScale);
    syncControlsFromCfg();
    seedFlowers();
  }

  function syncControlsFromCfg() {
    for (const [id, spec] of Object.entries(controls)) {
      const input = el(id);
      if (input) input.value = cfg[id];
      const out = el(id + 'Out');
      if (out) out.textContent = spec.fmt(cfg[id]);
    }
  }

  function setupControls() {
    for (const [id, spec] of Object.entries(controls)) {
      const input = el(id);
      if (!input) continue;
      const onControl = () => {
        cfg[id] = spec.cast(input.value);
        const out = el(id + 'Out'); if (out) out.textContent = spec.fmt(cfg[id]);
        if (id === 'worldScale') {
          applyWorldScale(cfg.worldScale);
          seedFlowers();
          clearTrails();
        }
        if (id === 'engine') {
          if (cfg.engine === 'internal') {
            clearTraceState();
            resetSimulation(true);
          } else if (!state.trace.active) {
            el('tunerReadout').textContent = 'BeeStack trace engine selected. Load a trace JSON to start playback.';
          }
        }
        if (id === 'flowerCount') seedFlowers();
        if (id === 'beeCount') ensureBeeCount();
      };
      input.addEventListener('input', onControl);
      input.addEventListener('change', onControl);
    }
    syncControlsFromCfg();

    el('pauseBtn').onclick = () => setRunning(!state.running);
    el('stepBtn').onclick = () => {
      if (cfg.engine === 'beestack_trace' && state.trace.active) simulateTrace(1 / 30);
      else simulate(1 / 30);
      drawAll();
      updateMetrics(true);
    };
    el('resetBtn').onclick = () => resetSimulation(true);
    el('randomizeBtn').onclick = () => { randomizeConfig(); resetSimulation(true); };
    el('clearBtn').onclick = clearTrails;
    el('tuneBtn').onclick = () => toggleTuner();
    el('exportBtn').onclick = exportResults;
    el('loadTraceBtn').onclick = () => el('traceFileInput').click();
    el('clearTraceBtn').onclick = () => {
      clearTraceState();
      cfg.engine = 'internal';
      syncControlsFromCfg();
      resetSimulation(true);
      el('tunerReadout').textContent = 'BeeStack trace cleared. Internal simulation resumed.';
    };
    el('traceFileInput').addEventListener('change', async ev => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        loadTraceObject(payload, file.name);
      } catch (err) {
        el('tunerReadout').textContent = `Failed to load trace: ${err.message}`;
      } finally {
        ev.target.value = '';
      }
    });
    el('hiveZoomBtn').onclick = () => {
      state.view.showHiveZoom = !state.view.showHiveZoom;
      el('hiveZoomPanel').classList.toggle('hidden', !state.view.showHiveZoom);
    };
    el('hiveZoomInBtn').onclick = () => { state.view.hiveZoom = clamp(state.view.hiveZoom + 0.35, 1.4, 6); };
    el('hiveZoomOutBtn').onclick = () => { state.view.hiveZoom = clamp(state.view.hiveZoom - 0.35, 1.4, 6); };
    el('hiveZoomResetBtn').onclick = () => { state.view.hiveZoom = 2.5; state.view.showHiveZoom = true; el('hiveZoomPanel').classList.remove('hidden'); };
    window.addEventListener('keydown', e => {
      if (e.target && ['INPUT','BUTTON','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); setRunning(!state.running); }
      if (e.key.toLowerCase() === 'r') resetSimulation(true);
      if (e.key.toLowerCase() === 'c') clearTrails();
    });
  }

  function setRunning(v) {
    state.running = v;
    el('pauseBtn').textContent = v ? 'Pause Simulation' : 'Resume Simulation';
    el('runText').textContent = v ? 'Running' : 'Paused';
    el('runDot').classList.toggle('paused', !v);
  }

  function toggleTuner() {
    state.tuning = !state.tuning;
    state.tune.lastTime = state.time;
    state.tune.rewardAtLast = reward();
    state.tune.bestReward = Math.max(state.tune.bestReward, state.tune.rewardAtLast);
    state.tune.lastMutation = null;
    state.tune.phase = state.tuning ? 'auto-tuning' : 'manual';
    el('tuneBadge').textContent = state.tuning ? 'tuning' : 'manual';
    el('tuneBtn').textContent = state.tuning ? 'Stop tiny hill-climb tuner' : 'Start tiny hill-climb tuner';
  }

  function exportResults() {
    const data = {
      cfg: { ...cfg },
      engine: cfg.engine,
      time: state.time,
      delivered: state.delivered,
      flowerVisits: state.flowerVisits,
      recentReward: reward(),
      flowers: state.flowers.map(f => ({ x:f.x, y:f.y, nectar:f.nectar, confidence:f.confidence, discovered:f.discovered })),
      recentDanceHistory: state.danceHistory.slice(-200),
      traceMeta: state.trace.active ? state.trace.meta : null,
      note: 'Agents use local scent, local dances, local memory, and hive homing; no global coordinator.'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bee_swarm_results_${Math.round(state.time)}s.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function inHive(b) { return hypot(b.x - hive.x, b.y - hive.y) < hive.r * 0.92; }

  function nearestFlowerByScent(b) {
    let best = null, bestScore = 0;
    const radius = cfg.scentRadius;
    for (const f of state.flowers) {
      if (f.nectar <= 1) continue;
      const dx = f.x - b.x, dy = f.y - b.y;
      const d = hypot(dx, dy);
      const range = radius + f.r + (f.discovered ? 18 : 0);
      if (d < range) {
        const score = (f.nectar / f.cap) * Math.pow(1 - d / range, 2) + (d < f.r + 18 ? 1 : 0);
        if (score > bestScore) best = { f, d, dx, dy, score }, bestScore = score;
      }
    }
    return best;
  }

  function chooseDanceSignal(b) {
    let best = null, bestScore = 0;
    for (const d of state.bees) {
      if (d.state !== 'dance' || !d.memory) continue;
      const dx = (d.danceBaseX || d.x) - b.x, dy = (d.danceBaseY || d.y) - b.y;
      const dd = hypot(dx, dy);
      if (dd > cfg.listenRadius) continue;
      const distance = hypot(d.memory.x - hive.x, d.memory.y - hive.y);
      const agePenalty = clamp(d.danceT / Math.max(1, cfg.danceDuration), 0.1, 1.0);
      const quality = clamp((d.memory.quality || 0.5) * agePenalty * (1 - dd / cfg.listenRadius), 0, 1);
      if (quality > bestScore) { best = d; bestScore = quality; }
    }
    return best ? { dancer: best, score: bestScore } : null;
  }

  function setTargetFromMemory(b, mem, source) {
    const trueAngle = Math.atan2(mem.y - hive.y, mem.x - hive.x);
    const trueDist = hypot(mem.x - hive.x, mem.y - hive.y);
    const angle = trueAngle + randn() * cfg.noise * (source === 'dance' ? 1.2 : 0.55);
    const noisyDist = trueDist * clamp(1 + randn() * cfg.noise * 0.42, 0.45, 1.7);
    const tx = clamp(hive.x + Math.cos(angle) * noisyDist, 60, WORLD.w - 50);
    const ty = clamp(hive.y + Math.sin(angle) * noisyDist, 45, WORLD.h - 45);
    b.target = { x: tx, y: ty, quality: mem.quality || 0.5 };
    b.memory = { x: mem.x, y: mem.y, quality: mem.quality || 0.5, flowerId: mem.flowerId };
    b.source = source;
    b.state = 'outbound'; b.role = source === 'dance' ? 'recruit' : 'forager'; b.carrying = 0;
    b.pathLen = 0; b.optimalDist = trueDist * 2; b.failTimer = 0; b.recruitedAt = source === 'dance' ? state.time : b.recruitedAt;
    if (source === 'dance') state.recruitEvents.push({ t: state.time, type: 'attempt' });
  }

  function startScout(b) {
    b.state = 'scout'; b.role = 'scout'; b.target = null; b.carrying = 0;
    b.heading = randRange(-1.1, 1.1) + (Math.random() < 0.5 ? 0 : 0.35);
    b.failTimer = 0; b.pathLen = 0; b.source = 'scout';
  }

  function startDance(b, f) {
    b.state = 'dance'; b.role = 'dancer'; b.carrying = 0;
    const quality = f ? clamp(f.nectar / f.cap + 0.25, 0.15, 1) : (b.memory?.quality || 0.55);
    const mem = f ? { x: f.x, y: f.y, quality, flowerId: f.id } : b.memory;
    b.memory = mem;
    b.danceT = cfg.danceDuration * randRange(0.75, 1.35) * lerp(0.65, 1.25, quality);
    b.dancePhase = Math.random() * TAU;
    b.danceTrace = [];
    b.danceBaseX = hive.x + randRange(-34, 34); b.danceBaseY = hive.y + randRange(-28, 28);
    const ang = Math.atan2(mem.y - hive.y, mem.x - hive.x);
    const distance = hypot(mem.x - hive.x, mem.y - hive.y);
    state.danceHistory.push({ t: state.time, angle: ang, distance, quality, flowerId: mem.flowerId });
    if (state.danceHistory.length > 1200) state.danceHistory.splice(0, state.danceHistory.length - 1200);
  }

  // Core primitive: tremble signal (receiver recruitment when unload pressure is high).
  function startTremble(b, shouldDanceAfter = false) {
    b.state = 'tremble';
    b.role = 'trembler';
    b.carrying = 0;
    b.trembleT = randRange(2.2, 7.2);
    b.postTrembleDance = shouldDanceAfter;
    state.signalEvents.push({ t: state.time, type: 'tremble' });
  }

  // Core primitive: stop signal (negative feedback reducing waggle promotion).
  function emitStopSignal(sender, targetFlowerId = null) {
    const nearbyDancers = state.bees.filter(d =>
      d.state === 'dance' &&
      d.memory &&
      (targetFlowerId == null || d.memory.flowerId === targetFlowerId) &&
      hypot(d.x - sender.x, d.y - sender.y) < cfg.listenRadius * 1.15
    );
    if (!nearbyDancers.length) return false;
    const target = nearbyDancers[Math.floor(Math.random() * nearbyDancers.length)];
    target.danceT *= clamp(1 - cfg.stopInfluence * 0.45, 0.35, 0.9);
    if (target.memory) target.memory.quality *= clamp(1 - cfg.stopInfluence * 0.28, 0.55, 0.92);
    state.signalEvents.push({ t: state.time, type: 'stop' });
    return true;
  }

  // Core primitive: shaking signal (general hive activation / labor mobilization).
  function emitShakeSignal(sender) {
    let activated = 0;
    for (const b of state.bees) {
      if (b.id === sender.id || b.state !== 'idle') continue;
      if (!inHive(b)) continue;
      const d = hypot(b.x - sender.x, b.y - sender.y);
      if (d > cfg.listenRadius * 1.5) continue;
      const gain = (1 - d / (cfg.listenRadius * 1.5)) * cfg.shakeInfluence;
      b.wait = Math.max(0.2, b.wait - gain * 2.2);
      if (Math.random() < gain * 0.25) b.heading += randn() * 0.5;
      activated++;
    }
    if (activated > 0) state.signalEvents.push({ t: state.time, type: 'shake' });
  }

  function steerToward(b, tx, ty, dt, strength = 1, jitter = 0.15) {
    const dx = tx - b.x, dy = ty - b.y;
    const a = Math.atan2(dy, dx) + randn() * jitter;
    const speed = cfg.beeSpeed * strength;
    const desiredX = Math.cos(a) * speed, desiredY = Math.sin(a) * speed;
    const turn = clamp(dt * 5.0, 0, 1);
    b.vx = lerp(b.vx, desiredX, turn);
    b.vy = lerp(b.vy, desiredY, turn);
  }

  function waggleOffset(b) {
    const quality = b.memory?.quality || 0.5;
    const runLen = 14 + quality * 18;
    const wagAmp = 2.6 + quality * 4.4;
    const loopR = 6 + quality * 7.5;
    const cycle = (b.dancePhase / TAU) % 1;
    const lap = Math.floor(b.dancePhase / TAU);
    if (cycle < 0.5) {
      const u = cycle * 2;
      const forward = lerp(-runLen, runLen, u);
      const lateral = Math.sin(u * TAU * 2.2) * wagAmp * (0.7 + quality * 0.5);
      return { forward, lateral };
    }
    const u = (cycle - 0.5) * 2;
    const side = lap % 2 === 0 ? 1 : -1;
    const arc = Math.PI * u;
    return { forward: runLen * Math.cos(arc), lateral: side * loopR * Math.sin(arc) };
  }

  function keepInWorld(b) {
    const pad = 18;
    if (b.x < pad) { b.x = pad; b.vx = Math.abs(b.vx); b.heading = 0; }
    if (b.x > WORLD.w - pad) { b.x = WORLD.w - pad; b.vx = -Math.abs(b.vx); b.heading = Math.PI; }
    if (b.y < pad) { b.y = pad; b.vy = Math.abs(b.vy); b.heading = Math.PI/2; }
    if (b.y > WORLD.h - pad) { b.y = WORLD.h - pad; b.vy = -Math.abs(b.vy); b.heading = -Math.PI/2; }
  }

  function danceAngularSpeed() {
    // Lower base angular speed keeps waggle readable across simulation speeds.
    return (1.1 + cfg.danceInfluence * 2.2) * cfg.danceTempo;
  }

  function updateBee(b, dt, grid) {
    b.lastX = b.x; b.lastY = b.y; b.age += dt;
    const wasOutside = !inHive(b);

    if (b.state === 'idle') {
      b.wait -= dt;
      const d = hypot(b.x - hive.x, b.y - hive.y);
      const targetA = Math.atan2(b.y - hive.y, b.x - hive.x) + Math.PI + randn() * 0.8;
      if (d > hive.r * 0.72) steerToward(b, hive.x + Math.cos(targetA) * hive.r * 0.35, hive.y + Math.sin(targetA) * hive.r * 0.35, dt, 0.28, 0.55);
      else {
        b.heading += randn() * dt * 1.8;
        b.vx = lerp(b.vx, Math.cos(b.heading) * cfg.beeSpeed * 0.14, dt * 2.6);
        b.vy = lerp(b.vy, Math.sin(b.heading) * cfg.beeSpeed * 0.14, dt * 2.6);
      }
      const signal = chooseDanceSignal(b);
      if (signal && Math.random() < cfg.danceInfluence * signal.score * dt * 1.6) {
        setTargetFromMemory(b, signal.dancer.memory, 'dance');
      } else if (b.wait <= 0) {
        b.wait = randRange(2.5, 9);
        if (b.memory && Math.random() > cfg.scoutFrac) setTargetFromMemory(b, b.memory, 'memory');
        else if (Math.random() < cfg.scoutFrac + 0.17) startScout(b);
      }
    }

    else if (b.state === 'scout') {
      b.failTimer += dt;
      b.heading += randn() * dt * 2.1;
      b.vx = lerp(b.vx, Math.cos(b.heading) * cfg.beeSpeed * 0.76, dt * 1.8);
      b.vy = lerp(b.vy, Math.sin(b.heading) * cfg.beeSpeed * 0.76, dt * 1.8);
      if (b.x < WORLD.w * 0.28 && Math.random() < dt * 1.2) b.heading += randRange(-0.45, 0.45);
      const scent = nearestFlowerByScent(b);
      if (scent) {
        steerToward(b, scent.f.x, scent.f.y, dt, 0.95, 0.08);
        if (scent.d < scent.f.r + 12) {
          b.targetFlower = scent.f; b.state = 'forage'; b.role = 'forager'; b.memory = { x: scent.f.x, y: scent.f.y, quality: scent.f.nectar/scent.f.cap, flowerId: scent.f.id };
          scent.f.discovered = true; scent.f.confidence = Math.min(1, scent.f.confidence + 0.1);
        }
      }
      if (b.failTimer > randRange(28, 52)) b.state = 'return';
    }

    else if (b.state === 'outbound') {
      b.failTimer += dt;
      const scent = nearestFlowerByScent(b);
      if (scent) {
        steerToward(b, scent.f.x, scent.f.y, dt, 1.02, 0.06);
        if (scent.d < scent.f.r + 14) {
          b.targetFlower = scent.f; b.state = 'forage'; b.role = 'forager';
          b.memory = { x: scent.f.x, y: scent.f.y, quality: scent.f.nectar/scent.f.cap, flowerId: scent.f.id };
          scent.f.discovered = true; scent.f.confidence = Math.min(1, scent.f.confidence + (b.source === 'dance' ? 0.16 : 0.1));
        }
      } else if (b.target) {
        steerToward(b, b.target.x, b.target.y, dt, 0.92, cfg.noise * 0.32 + 0.08);
      }
      const targetD = b.target ? hypot(b.x - b.target.x, b.y - b.target.y) : 999;
      if (targetD < 28 && !scent) startScout(b);
      if (b.failTimer > 24 + (b.optimalDist || 400) / cfg.beeSpeed * 1.2) startScout(b);
    }

    else if (b.state === 'forage') {
      const f = b.targetFlower || nearestFlowerByScent(b)?.f;
      if (f) {
        const a = angleTo(b, f) + Math.sin(state.time * 2 + b.id) * 0.8;
        b.vx = lerp(b.vx, Math.cos(a) * cfg.beeSpeed * 0.22, dt * 2);
        b.vy = lerp(b.vy, Math.sin(a) * cfg.beeSpeed * 0.22, dt * 2);
        const take = Math.min(f.nectar, cfg.forageRate * dt * 15, 1 - b.carrying);
        f.nectar -= take; b.carrying += take; f.confidence = Math.min(1, f.confidence + take * 0.05);
        if (b.carrying >= 0.98 || f.nectar <= 0.5) {
          b.state = 'return'; b.role = 'returning'; b.memory = { x: f.x, y: f.y, quality: f.nectar/f.cap, flowerId: f.id };
          b.targetFlower = f; state.flowerVisits += 1;
        }
      } else b.state = 'return';
    }

    else if (b.state === 'return') {
      steerToward(b, hive.x, hive.y, dt, 1.05, 0.06);
      if (hypot(b.x - hive.x, b.y - hive.y) < hive.r * 0.58) {
        if (b.carrying > 0.2) {
          state.delivered += b.carrying;
          state.deliveryEvents.push({ t: state.time, amount: b.carrying, source: b.source });
          const actual = b.targetFlower || b.memory || hive;
          const optimal = 2 * hypot(actual.x - hive.x, actual.y - hive.y);
          if (b.pathLen > 10) {
            state.efficiencySamples.push({ t: state.time, v: clamp(optimal / b.pathLen, 0, 1.25) });
            state.pathSamples.push({ t: state.time, v: b.pathLen });
          }
          if (b.source === 'dance') state.recruitEvents.push({ t: state.time, type: 'success' });
          b.successMemory = Math.min(1, b.successMemory + 0.25);
          const hiveFlow = state.bees.filter(o => o.state === 'return' && inHive(o)).length / Math.max(1, state.bees.length * 0.06);
          const unloadStress = clamp(hiveFlow, 0, 1.2);
          const willTremble = Math.random() < cfg.trembleSensitivity * unloadStress * 0.7;
          if (willTremble) startTremble(b, true);
          else startDance(b, b.targetFlower);
        } else {
          if (b.source === 'dance' && Math.random() < cfg.stopInfluence * 0.85) emitStopSignal(b, b.memory?.flowerId);
          b.state = 'idle'; b.role = 'idle'; b.wait = randRange(1, 6);
        }
        b.targetFlower = null; b.carrying = 0; b.pathLen = 0;
      }
    }

    else if (b.state === 'dance') {
      b.danceT -= dt;
      b.dancePhase += dt * danceAngularSpeed();
      const ang = b.memory ? Math.atan2(b.memory.y - hive.y, b.memory.x - hive.x) : 0;
      const pose = waggleOffset(b);
      b.x = b.danceBaseX + Math.cos(ang) * pose.forward + Math.cos(ang + Math.PI / 2) * pose.lateral;
      b.y = b.danceBaseY + Math.sin(ang) * pose.forward + Math.sin(ang + Math.PI / 2) * pose.lateral;
      b.vx = (b.x - b.lastX) / Math.max(dt, 0.001);
      b.vy = (b.y - b.lastY) / Math.max(dt, 0.001);
      b.danceTrace.push({ x: b.x, y: b.y });
      if (b.danceTrace.length > 70) b.danceTrace.shift();
      if (b.danceT <= 0) {
        b.state = 'idle'; b.role = 'idle'; b.wait = randRange(0.6, 4.5);
        b.danceTrace = [];
        if (b.memory && Math.random() < 0.42) b.wait *= 0.3;
      }
    }

    else if (b.state === 'tremble') {
      b.trembleT -= dt;
      b.heading += randn() * dt * 2.7;
      const jitter = 0.22 + cfg.shakeInfluence * 0.18;
      b.vx = lerp(b.vx, Math.cos(b.heading) * cfg.beeSpeed * jitter, dt * 3.0);
      b.vy = lerp(b.vy, Math.sin(b.heading) * cfg.beeSpeed * jitter, dt * 3.0);
      if (Math.random() < dt * (0.75 + cfg.shakeInfluence * 0.8)) emitShakeSignal(b);
      if (b.trembleT <= 0) {
        if (b.postTrembleDance && b.memory && Math.random() < 0.8) startDance(b, b.targetFlower || null);
        else { b.state = 'idle'; b.role = 'idle'; b.wait = randRange(0.5, 3.8); }
        b.postTrembleDance = false;
      }
    }

    // Local separation: neighborhood-only repulsion. This is intentionally local, not a global flock command.
    if (cfg.avoidance > 1 && b.state !== 'dance') {
      const sep = localSeparation(b, grid, cfg.avoidance);
      b.vx += sep.x * dt * 34;
      b.vy += sep.y * dt * 34;
    }

    if (b.state !== 'dance') {
      const maxV = cfg.beeSpeed * 1.25;
      const sp = hypot(b.vx, b.vy);
      if (sp > maxV) { b.vx = b.vx / sp * maxV; b.vy = b.vy / sp * maxV; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      keepInWorld(b);
      if (b.state !== 'idle') b.pathLen += hypot(b.x - b.lastX, b.y - b.lastY);
    }

    if (wasOutside || !inHive(b)) addTrail(b);
    if (hypot(b.vx, b.vy) > 0.1) b.heading = Math.atan2(b.vy, b.vx);
  }

  function buildGrid() {
    const cell = 45;
    const g = new Map();
    for (const b of state.bees) {
      const cx = Math.floor(b.x / cell), cy = Math.floor(b.y / cell);
      const key = `${cx},${cy}`;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(b);
    }
    return { g, cell };
  }

  function localSeparation(b, grid, rad) {
    const cx = Math.floor(b.x / grid.cell), cy = Math.floor(b.y / grid.cell);
    let x = 0, y = 0, n = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
      const arr = grid.g.get(`${xx},${yy}`); if (!arr) continue;
      for (const o of arr) {
        if (o === b) continue;
        const dx = b.x - o.x, dy = b.y - o.y, d = hypot(dx, dy);
        if (d > 0.001 && d < rad) { const w = 1 - d / rad; x += dx / d * w; y += dy / d * w; n++; }
      }
    }
    if (n > 0) state.contacts += n > 2 ? 2 : n;
    return { x, y };
  }

  function addTrail(b) {
    const map = {
      scout: 'rgba(88,230,230,0.25)', recruit: 'rgba(120,227,109,0.28)', forager: 'rgba(246,194,58,0.30)',
      returning: 'rgba(255,139,43,0.30)', dancer: 'rgba(178,115,255,0.18)', idle: 'rgba(140,150,170,0.06)'
    };
    tctx.strokeStyle = map[b.role] || map[b.state] || 'rgba(200,200,200,0.10)';
    tctx.lineWidth = b.carrying > 0.2 ? 1.25 : 0.75;
    tctx.beginPath(); tctx.moveTo(b.lastX, b.lastY); tctx.lineTo(b.x, b.y); tctx.stroke();
  }

  function fadeTrails(dt) {
    tctx.save();
    tctx.globalCompositeOperation = 'destination-in';
    const alpha = Math.pow(cfg.trailFade, dt * 60);
    tctx.fillStyle = `rgba(0,0,0,${alpha})`;
    tctx.fillRect(0,0,WORLD.w,WORLD.h);
    tctx.restore();
  }

  function simulate(rawDt) {
    const dt = clamp(rawDt, 0.001, 0.05) * cfg.simSpeed;
    ensureBeeCount();
    state.time += dt; state.contacts = 0;
    for (const f of state.flowers) {
      f.nectar = Math.min(f.cap, f.nectar + cfg.nectarRegen * dt * 4.5);
      f.confidence = Math.max(0.02, f.confidence - dt * 0.0015);
    }
    fadeTrails(dt);
    pruneEvents();
    const grid = buildGrid();
    // Update dances first enough to expose their local position to listeners.
    for (const b of state.bees) if (b.state === 'dance') updateBee(b, dt, grid);
    for (const b of state.bees) if (b.state !== 'dance') updateBee(b, dt, grid);
    autoTune(dt);
  }

  function pruneEvents() {
    const horizon = state.time - 180;
    state.recruitEvents = state.recruitEvents.filter(e => e.t >= horizon);
    state.deliveryEvents = state.deliveryEvents.filter(e => e.t >= horizon);
    state.efficiencySamples = state.efficiencySamples.filter(e => e.t >= horizon);
    state.pathSamples = state.pathSamples.filter(e => e.t >= horizon);
    state.signalEvents = state.signalEvents.filter(e => e.t >= horizon);
  }

  function reward() {
    const recent = state.deliveryEvents.filter(e => e.t > state.time - 45).reduce((s,e) => s + e.amount, 0);
    const eff = mean(state.efficiencySamples.filter(e => e.t > state.time - 45).map(e => e.v), 0.2);
    return recent * (0.55 + eff) / 45;
  }

  function mutateParam() {
    const keys = ['scoutFrac','danceInfluence','noise','scentRadius','danceDuration','beeSpeed','nectarRegen'];
    const id = keys[Math.floor(Math.random() * keys.length)];
    const old = cfg[id];
    const bounds = {
      scoutFrac: [0.03, 0.65, 0.04], danceInfluence: [0.02, 1, 0.08], noise: [0.02, 0.75, 0.05],
      scentRadius: [40, 230, 18], danceDuration: [2, 28, 2.5], beeSpeed: [38, 135, 9], nectarRegen: [0.01, 1, 0.07]
    }[id];
    const nv = clamp(old + randn() * bounds[2], bounds[0], bounds[1]);
    cfg[id] = nv; syncControlsFromCfg();
    return { id, old, nv };
  }

  function autoTune(dt) {
    if (!state.tuning) return;
    const interval = 18;
    if (state.time - state.tune.lastTime < interval) return;
    const r = reward();
    let msg = '';
    if (state.tune.lastMutation) {
      if (r + 0.002 < state.tune.rewardAtLast && Math.random() < 0.75) {
        cfg[state.tune.lastMutation.id] = state.tune.lastMutation.old;
        msg = `reverted ${state.tune.lastMutation.id}; reward ${r.toFixed(3)} < ${state.tune.rewardAtLast.toFixed(3)}`;
      } else {
        state.tune.bestReward = Math.max(state.tune.bestReward, r);
        msg = `kept ${state.tune.lastMutation.id}; reward ${r.toFixed(3)}`;
      }
      syncControlsFromCfg();
    }
    state.tune.rewardAtLast = reward();
    state.tune.lastMutation = mutateParam();
    state.tune.lastTime = state.time;
    el('tunerReadout').textContent = `Tiny tuner: ${msg || 'sampling'}; now nudging ${state.tune.lastMutation.id}.`;
  }

  function mean(arr, fallback = 0) { return arr.length ? arr.reduce((a,b) => a + b, 0) / arr.length : fallback; }
  const log2 = v => Math.log(v) / Math.log(2);
  const entropy01 = p => {
    const x = clamp(p, 1e-6, 1 - 1e-6);
    return -(x * log2(x) + (1 - x) * log2(1 - x));
  };

  function infoModelSpec() {
    return INFO_MODEL_SPECS[cfg.infoModel] || INFO_MODEL_SPECS.heuristic;
  }

  function fmtBits(bits) {
    if (bits >= 1e6) return `${(bits / 1e6).toFixed(2)} Mb`;
    if (bits >= 1e3) return `${(bits / 1e3).toFixed(1)} kb`;
    return `${Math.max(0, bits).toFixed(0)} b`;
  }

  function fmtBitRate(rate) {
    if (rate >= 1e6) return `${(rate / 1e6).toFixed(2)} Mb/s`;
    if (rate >= 1e3) return `${(rate / 1e3).toFixed(1)} kb/s`;
    return `${Math.max(0, rate).toFixed(0)} b/s`;
  }

  function fmtRuns(v) {
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M runs`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k runs`;
    return `${Math.max(0, v).toFixed(0)} runs`;
  }

  function estimateWorldModelBits() {
    const spec = infoModelSpec();
    if (cfg.infoModel === 'heuristic') {
      const cellsX = Math.max(1, Math.floor(WORLD.w / 24));
      const cellsY = Math.max(1, Math.floor(WORLD.h / 24));
      const positionBits = log2(cellsX * cellsY);
      let bits = 0;
      for (const f of state.flowers) {
        const confidence = clamp(f.confidence, 0, 1);
        const discoveryWeight = clamp((f.discovered ? 0.75 : 0.1) + confidence * 0.25, 0, 1);
        const certaintyBits = 1 + 6 * confidence;
        bits += positionBits * discoveryWeight + certaintyBits;
      }
      const informed = state.bees.filter(b => b.memory && (b.state === 'dance' || b.state === 'outbound' || b.state === 'return')).length;
      bits += informed * 4.5;
      return bits;
    }
    let bits = 0;
    const payloadBits = spec.directionBits + spec.distanceBits + spec.qualityBits;
    for (const f of state.flowers) {
      const confidence = clamp(f.confidence, 0, 1);
      const knownProb = clamp((f.discovered ? 0.62 : 0.06) + confidence * 0.34, 0, 1);
      bits += knownProb * payloadBits * spec.confidenceWeight;
      bits += entropy01(knownProb);
    }
    const informedBees = state.bees.filter(b => b.memory && (b.state === 'dance' || b.state === 'outbound' || b.state === 'return')).length;
    bits += informedBees * (payloadBits / spec.followerRunsToDecode);
    return bits;
  }

  function estimateTransferRateBitsPerSec() {
    const spec = infoModelSpec();
    const dancers = state.bees.filter(b => b.state === 'dance' && b.memory);
    if (!dancers.length) return 0;
    let transfer = 0;
    for (const d of dancers) {
      const quality = clamp(d.memory.quality || 0.5, 0, 1);
      const bitsPerCycle = (cfg.infoModel === 'heuristic')
        ? (11 + 3 * quality)
        : (spec.directionBits + spec.distanceBits + spec.qualityBits) * (0.75 + 0.25 * quality);
      const omega = danceAngularSpeed();
      const cyclesPerSec = omega / TAU;
      let nearbyListeners = 0;
      for (const b of state.bees) {
        if (b.id === d.id) continue;
        if (!(b.state === 'idle' || b.state === 'outbound' || b.state === 'scout')) continue;
        const listenerDist = hypot((d.danceBaseX || d.x) - b.x, (d.danceBaseY || d.y) - b.y);
        if (listenerDist > cfg.listenRadius) continue;
        nearbyListeners += 1 - listenerDist / cfg.listenRadius;
      }
      const agePenalty = clamp(d.danceT / Math.max(1, cfg.danceDuration), 0.15, 1);
      const audienceGain = clamp(0.22 + nearbyListeners * 0.17, 0.22, 2.8);
      const decodeGain = cfg.infoModel === 'heuristic' ? 1 : (1 / spec.followerRunsToDecode);
      transfer += bitsPerCycle * cyclesPerSec * agePenalty * audienceGain * cfg.danceInfluence * decodeGain;
    }
    return transfer;
  }

  function estimateEnvironmentModeledBits() {
    const spec = infoModelSpec();
    const payloadBits = spec.directionBits + spec.distanceBits + spec.qualityBits;
    const xBins = Math.max(2, Math.floor(WORLD.w / 2));
    const yBins = Math.max(2, Math.floor(WORLD.h / 2));
    const posBits = log2(xBins) + log2(yBins);
    const velocityBits = 14; // vx, vy quantized channels
    const headingBits = 8;
    const stateRoleBits = 6; // coarse finite-state encoding
    const scalarBits = 10; // carrying, wait, timers aggregate
    let beeBits = 0;
    for (const b of state.bees) {
      const memoryBits = b.memory ? payloadBits + 1 : 1;
      beeBits += posBits + velocityBits + headingBits + stateRoleBits + scalarBits + memoryBits;
    }
    const flowerIdBits = Math.max(1, log2(Math.max(2, state.flowers.length + 1)));
    const flowerBits = state.flowers.length * (posBits + 8 + 7 + 1 + flowerIdBits); // nectar/confidence/discovered/id
    const eventBits = (state.recruitEvents.length + state.deliveryEvents.length + state.signalEvents.length) * 12;
    return beeBits + flowerBits + eventBits;
  }

  function estimateRealityEquivalentRuns(envBits) {
    const spec = infoModelSpec();
    const bitsPerRun = Math.max(1, spec.directionBits + spec.distanceBits + spec.qualityBits);
    return envBits / bitsPerRun;
  }

  function drawAll() {
    const s = sizes();
    drawWorld(ctx.world, s.world);
    if (state.view.showHiveZoom) drawHiveZoom(ctx.hiveZoom, s.hiveZoom);
    drawManifold(ctx.manifold, s.manifold);
    if (performance.now() - state.lastHeat > 130) {
      state.lastHeat = performance.now();
      drawSmallPanels();
    }
  }

  function withWorld(ctx, size, draw) {
    ctx.save();
    ctx.clearRect(0,0,size.w,size.h);
    const scale = Math.min(size.w / WORLD.w, size.h / WORLD.h);
    const ox = (size.w - WORLD.w * scale) / 2, oy = (size.h - WORLD.h * scale) / 2;
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    draw(scale);
    ctx.restore();
  }

  function drawWorld(c, size) {
    withWorld(c, size, () => {
      const bg = c.createLinearGradient(0,0,WORLD.w,WORLD.h);
      bg.addColorStop(0, '#06090f'); bg.addColorStop(0.56, '#081018'); bg.addColorStop(1, '#05070a');
      c.fillStyle = bg; c.fillRect(0,0,WORLD.w,WORLD.h);
      drawGrid(c);
      c.globalAlpha = 0.95; c.drawImage(trails, 0, 0); c.globalAlpha = 1;
      drawScentHints(c);
      drawHive(c);
      drawFlowers(c);
      drawDanceSignals(c);
      drawBees(c);
      drawWorldFrame(c);
    });
  }

  function drawGrid(c) {
    c.save(); c.globalAlpha = 0.25; c.strokeStyle = '#16212e'; c.lineWidth = 1;
    for (let x=0; x<=WORLD.w; x+=80) { c.beginPath(); c.moveTo(x,0); c.lineTo(x,WORLD.h); c.stroke(); }
    for (let y=0; y<=WORLD.h; y+=80) { c.beginPath(); c.moveTo(0,y); c.lineTo(WORLD.w,y); c.stroke(); }
    c.restore();
  }

  function drawWorldFrame(c) {
    c.save(); c.strokeStyle = 'rgba(180,200,225,0.25)'; c.lineWidth = 2; c.strokeRect(1,1,WORLD.w-2,WORLD.h-2); c.restore();
  }

  function drawScentHints(c) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const f of state.flowers) {
      const rad = cfg.scentRadius * (0.72 + f.nectar / f.cap * 0.35);
      const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      g.addColorStop(0, `hsla(${f.hue}, 95%, 62%, ${0.12 * f.nectar/f.cap})`);
      g.addColorStop(0.5, `hsla(${f.hue}, 85%, 50%, ${0.025 * f.nectar/f.cap})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(f.x, f.y, rad, 0, TAU); c.fill();
    }
    c.restore();
  }

  function drawHive(c) {
    c.save();
    const g = c.createRadialGradient(hive.x - 40, hive.y - 20, 8, hive.x, hive.y, hive.r * 1.35);
    g.addColorStop(0, 'rgba(251,198,71,0.36)');
    g.addColorStop(0.4, 'rgba(145,82,23,0.42)');
    g.addColorStop(1, 'rgba(60,35,15,0.03)');
    c.fillStyle = g; c.beginPath(); c.arc(hive.x, hive.y, hive.r * 1.2, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(246,194,58,0.18)'; c.lineWidth = 2;
    for (let r = 28; r < hive.r * 1.25; r += 17) { c.beginPath(); c.arc(hive.x, hive.y, r, 0, TAU); c.stroke(); }
    c.strokeStyle = 'rgba(246,194,58,0.24)'; c.lineWidth = 1;
    const hexR = 9;
    for (let yy = -55; yy <= 55; yy += 15) for (let xx = -55; xx <= 55; xx += 17) {
      const x = hive.x + xx + ((Math.round(yy/15)&1) ? 8 : 0), y = hive.y + yy;
      if (hypot(x-hive.x,y-hive.y) > hive.r * 0.78) continue;
      c.beginPath();
      for (let k=0;k<6;k++) {
        const a = Math.PI/6 + k * TAU/6;
        const px = x + Math.cos(a) * hexR, py = y + Math.sin(a) * hexR;
        if (k) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath(); c.stroke();
    }
    c.fillStyle = 'rgba(0,0,0,0.42)'; c.beginPath(); c.arc(hive.x - 20, hive.y + 5, hive.r * 0.38, 0, TAU); c.fill();
    c.restore();
  }

  function drawFlowers(c) {
    for (const f of state.flowers) {
      c.save(); c.translate(f.x, f.y);
      const pulse = 1 + Math.sin(state.time * 2 + f.id) * 0.05;
      c.globalCompositeOperation = 'lighter';
      const halo = c.createRadialGradient(0,0,0,0,0,f.r*4);
      halo.addColorStop(0, `hsla(${f.hue}, 95%, 62%, ${0.19 * f.nectar/f.cap})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = halo; c.beginPath(); c.arc(0,0,f.r*4,0,TAU); c.fill();
      c.globalCompositeOperation = 'source-over';
      for (let i=0; i<8; i++) {
        c.rotate(TAU/8);
        c.fillStyle = `hsla(${f.hue}, 75%, ${55 + i%2*8}%, 0.75)`;
        c.beginPath(); c.ellipse(f.r*0.74*pulse, 0, f.r*0.35, f.r*0.78, 0, 0, TAU); c.fill();
      }
      c.fillStyle = `rgba(246,194,58,${0.55 + f.nectar/f.cap*0.4})`; c.beginPath(); c.arc(0,0,f.r*0.44,0,TAU); c.fill();
      c.restore();
    }
  }

  function drawDanceSignals(c) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const b of state.bees) {
      if (b.state !== 'dance' || !b.memory) continue;
      const quality = b.memory.quality || 0.5;
      const rad = 30 + 45 * quality + Math.sin(state.time * 5 + b.id) * 4;
      const g = c.createRadialGradient(b.x,b.y,0,b.x,b.y,rad);
      g.addColorStop(0, 'rgba(178,115,255,0.32)');
      g.addColorStop(1, 'rgba(178,115,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(b.x,b.y,rad,0,TAU); c.fill();
      const a = angleTo(hive, b.memory);
      c.strokeStyle = `rgba(246,194,58,${0.25 + 0.35 * quality})`; c.lineWidth = 1.3;
      c.setLineDash([4, 8]);
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x + Math.cos(a) * (55 + quality*30), b.y + Math.sin(a) * (55 + quality*30)); c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  function beeColor(b) {
    if (b.state === 'dance') return '#b273ff';
    if (b.state === 'tremble' || b.role === 'trembler') return '#78a6ff';
    if (b.role === 'recruit') return '#78e36d';
    if (b.state === 'return' || b.role === 'returning') return '#ff8b2b';
    if (b.state === 'scout') return '#58e6e6';
    if (b.state === 'forage' || b.role === 'forager') return '#f6c23a';
    return '#d9d0a2';
  }

  function drawBees(c) {
    for (const b of state.bees) drawBeeGlyph(c, b, b.state === 'dance' ? 1.15 : 1);
  }

  function drawBeeGlyph(c, b, scale = 1) {
    c.save(); c.translate(b.x, b.y); c.rotate(b.heading); c.scale(scale, scale);
    c.globalAlpha = b.state === 'idle' ? 0.78 : 0.95;
    c.fillStyle = 'rgba(210,230,255,0.36)';
    c.beginPath(); c.ellipse(-2, -4.4, 5.1, 2.25, -0.4, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(-2, 4.4, 5.1, 2.25, 0.4, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.ellipse(0, 0, 6.5, 3.7, 0, 0, TAU); c.fill();
    c.fillStyle = beeColor(b); c.globalAlpha *= 0.92;
    c.fillRect(-5.2, -3.2, 2.5, 6.4); c.fillRect(-0.8, -3.5, 2.3, 7.0); c.fillRect(3.7, -2.8, 1.5, 5.6);
    c.fillStyle = 'rgba(0,0,0,0.85)'; c.beginPath(); c.arc(6.5, 0, 2.7, 0, TAU); c.fill();
    if (b.carrying > 0.2) {
      c.fillStyle = `rgba(246,194,58,${0.45 + b.carrying * 0.45})`; c.beginPath(); c.arc(-7.2, 0, 2.3 + 2 * b.carrying, 0, TAU); c.fill();
    }
    c.restore();
  }

  function drawHiveZoom(c, size) {
    c.clearRect(0, 0, size.w, size.h);
    const bg = c.createLinearGradient(0, 0, size.w, size.h);
    bg.addColorStop(0, '#090d15');
    bg.addColorStop(1, '#05070a');
    c.fillStyle = bg;
    c.fillRect(0, 0, size.w, size.h);
    const localRadius = hive.r * 1.72;
    const worldToPanel = Math.min(size.w, size.h) * 0.46 * state.view.hiveZoom / localRadius;
    c.save();
    c.translate(size.w * 0.5, size.h * 0.54);
    c.scale(worldToPanel, worldToPanel);
    c.translate(-hive.x, -hive.y);
    c.save();
    c.beginPath();
    c.arc(hive.x, hive.y, localRadius, 0, TAU);
    c.clip();
    drawHive(c);
    for (const b of state.bees) {
      if (hypot(b.x - hive.x, b.y - hive.y) > localRadius * 1.08) continue;
      if (b.state === 'dance' && b.danceTrace?.length > 3) {
        c.strokeStyle = 'rgba(178,115,255,0.35)';
        c.lineWidth = 1.3;
        c.beginPath();
        for (let i = 0; i < b.danceTrace.length; i++) {
          const p = b.danceTrace[i];
          if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
        }
        c.stroke();
        if (b.memory) {
          const danceAng = angleTo(hive, b.memory);
          c.setLineDash([4, 4]);
          c.strokeStyle = 'rgba(246,194,58,0.45)';
          c.beginPath();
          c.moveTo(b.x, b.y);
          c.lineTo(b.x + Math.cos(danceAng) * (hive.r * 0.85), b.y + Math.sin(danceAng) * (hive.r * 0.85));
          c.stroke();
          c.setLineDash([]);
        }
      }
      drawBeeGlyph(c, b, b.state === 'dance' ? 1.35 : 1.18);
    }
    c.restore();
    c.strokeStyle = 'rgba(246,194,58,0.52)';
    c.lineWidth = 2.4 / Math.max(1, worldToPanel);
    c.beginPath();
    c.arc(hive.x, hive.y, localRadius, 0, TAU);
    c.stroke();
    c.restore();
    c.fillStyle = 'rgba(236,242,248,0.80)';
    c.font = '10px ui-sans-serif, system-ui';
    c.fillText(`zoom ${state.view.hiveZoom.toFixed(1)}×`, 8, size.h - 10);
  }

  function drawManifold(c, size) {
    c.clearRect(0,0,size.w,size.h);
    const w = size.w, h = size.h;
    const bg = c.createLinearGradient(0,0,w,h); bg.addColorStop(0,'#070b12'); bg.addColorStop(1,'#05070a'); c.fillStyle = bg; c.fillRect(0,0,w,h);
    const pad = 54;
    const ox = pad + 10, oy = h - 54;
    const ax = w - pad * 2.0, ay = -h * 0.52, zx = w * 0.18, zy = -h * 0.18;
    const project = (x,y,z) => [ox + x*ax + z*zx, oy + y*ay + z*zy];

    c.save(); c.strokeStyle = 'rgba(150,170,200,.22)'; c.lineWidth = 1;
    const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => project(...p));
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    for (const [a,b] of edges) { c.beginPath(); c.moveTo(...corners[a]); c.lineTo(...corners[b]); c.stroke(); }
    c.restore();

    // Synthetic density surfaces: colorful strata from recent dance memory.
    c.save(); c.globalCompositeOperation = 'lighter';
    const recent = state.danceHistory.filter(d => d.t > state.time - 100);
    for (const d of recent) {
      const age = clamp((state.time - d.t) / 100, 0, 1);
      const x = clamp((Math.log10(d.distance + 1) - 2.0) / 1.05, 0, 1);
      const y = (wrapPi(d.angle) + Math.PI) / TAU;
      const z = 1 - age;
      const [px, py] = project(x, y, z);
      const hue = 190 + 170 * y;
      c.fillStyle = `hsla(${hue}, 95%, 60%, ${0.08 + 0.38 * d.quality * (1-age)})`;
      c.beginPath(); c.arc(px, py, 1.6 + 2.5 * d.quality, 0, TAU); c.fill();
    }
    // Add field background so the manifold is not empty early in the run.
    for (let i = 0; i < 360; i++) {
      const x = (i % 45) / 44;
      const y = (Math.floor(i / 45) % 8) / 7;
      const z = (Math.sin(x * 8 + y * 5 + state.time * 0.3) + 1) * 0.5;
      const [px, py] = project(x, y, z * 0.85);
      const hue = 20 + 260 * x;
      c.fillStyle = `hsla(${hue}, 90%, 55%, 0.045)`;
      c.fillRect(px, py, 1.2, 1.2);
    }
    c.restore();

    // Trajectory of mean dance vector.
    const bins = [];
    for (let t = state.time - 90; t <= state.time; t += 6) {
      const ds = state.danceHistory.filter(d => d.t >= t - 6 && d.t < t && d.t > state.time - 110);
      if (!ds.length) continue;
      const mx = mean(ds.map(d => clamp((Math.log10(d.distance + 1) - 2.0) / 1.05, 0, 1)), .5);
      const sx = ds.reduce((s,d) => s + Math.cos(d.angle), 0), sy = ds.reduce((s,d) => s + Math.sin(d.angle), 0);
      const a = Math.atan2(sy, sx);
      bins.push(project(mx, (wrapPi(a)+Math.PI)/TAU, clamp((t - (state.time - 90))/90,0,1)));
    }
    c.save(); c.lineWidth = 2.2; c.strokeStyle = 'rgba(245,250,255,.82)'; c.shadowColor = 'rgba(255,255,255,.42)'; c.shadowBlur = 8;
    c.beginPath(); bins.forEach((p,i) => i ? c.lineTo(p[0],p[1]) : c.moveTo(p[0],p[1])); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.9)'; for (const p of bins.slice(-6)) { c.beginPath(); c.arc(p[0],p[1],3.1,0,TAU); c.fill(); }
    c.restore();

    c.save(); c.fillStyle = 'rgba(216,225,238,.88)'; c.font = '11px ui-sans-serif, system-ui';
    c.fillText('Dance angle', 14, h * 0.50);
    c.fillText('Distance encoded by waggle duration', Math.max(12, w * 0.16), h - 18);
    c.fillText('time', w - 48, h * 0.58);
    const grad = c.createLinearGradient(w * 0.12, h - 38, w * 0.58, h - 38);
    grad.addColorStop(0, '#2c5cff'); grad.addColorStop(.35, '#26f0d0'); grad.addColorStop(.7, '#f6c23a'); grad.addColorStop(1, '#ff543f');
    c.fillStyle = grad; c.fillRect(w*0.12, h-40, w*0.46, 6);
    c.fillStyle = 'rgba(216,225,238,.7)'; c.fillText('low density', w*0.12, h - 47); c.fillText('high density', w*0.52, h - 47);
    c.fillStyle = 'rgba(120,166,255,.9)'; c.fillText('☑ show trajectory', w - 130, h - 34);
    c.restore();
  }

  function drawSmallPanels() {
    drawHeatPanel(ctx.heatPhero, canvas.heatPhero, 'phero');
    drawHeatPanel(ctx.heatNectar, canvas.heatNectar, 'nectar');
    drawHeatPanel(ctx.heatDance, canvas.heatDance, 'dance');
    drawHeatPanel(ctx.heatBuzz, canvas.heatBuzz, 'buzz');
    drawHeatPanel(ctx.heatCoherence, canvas.heatCoherence, 'coherence');
    drawHeatPanel(ctx.heatRoutes, canvas.heatRoutes, 'routes');
  }

  function drawHeatPanel(c, canv, kind) {
    const sz = resizeCanvas(canv), w = sz.w, h = sz.h;
    c.clearRect(0,0,w,h);
    const bg = c.createLinearGradient(0,0,w,h); bg.addColorStop(0,'#071019'); bg.addColorStop(1,'#05070a'); c.fillStyle = bg; c.fillRect(0,0,w,h);
    c.save(); c.translate(0, 12);
    if (kind === 'phero') drawPheroMini(c,w,h-12);
    if (kind === 'nectar') drawNectarMini(c,w,h-12);
    if (kind === 'dance') drawDanceMini(c,w,h-12);
    if (kind === 'buzz') drawBuzzMini(c,w,h-12);
    if (kind === 'coherence') drawCoherenceMini(c,w,h-12);
    if (kind === 'routes') drawRoutesMini(c,w,h-12);
    c.restore();
    drawColorbar(c,w,h,kind);
  }

  function mapMini(x,y,w,h){ return { x: x/WORLD.w*w, y: y/WORLD.h*h }; }
  function radial(c,x,y,r,stops){ const g = c.createRadialGradient(x,y,0,x,y,r); for (const s of stops) g.addColorStop(s[0], s[1]); c.fillStyle = g; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill(); }

  function drawPheroMini(c,w,h) {
    c.globalCompositeOperation = 'lighter';
    const H = mapMini(hive.x,hive.y,w,h);
    radial(c,H.x,H.y,h*.42,[[0,'rgba(246,194,58,.28)'],[.5,'rgba(246,120,30,.08)'],[1,'rgba(0,0,0,0)']]);
    for (const f of state.flowers) {
      const p = mapMini(f.x,f.y,w,h); radial(c,p.x,p.y,h*.22,[[0,`hsla(${f.hue},100%,60%,.45)`],[1,'rgba(0,0,0,0)']]);
      c.strokeStyle = `hsla(${f.hue},95%,58%,${0.12 + f.confidence*.25})`; c.lineWidth = 1.2; c.beginPath(); c.moveTo(H.x,H.y); c.quadraticCurveTo((H.x+p.x)/2, (H.y+p.y)/2 + Math.sin(state.time+f.id)*24, p.x,p.y); c.stroke();
    }
  }
  function drawNectarMini(c,w,h) {
    c.globalCompositeOperation = 'lighter';
    for (const f of state.flowers) {
      const p = mapMini(f.x,f.y,w,h); const q = f.nectar/f.cap;
      radial(c,p.x,p.y,h*.38,[[0,`hsla(${f.hue},100%,62%,${0.18+q*.36})`],[.45,`hsla(${f.hue},90%,45%,${0.10+q*.18})`],[1,'rgba(0,0,0,0)']]);
    }
    const H = mapMini(hive.x,hive.y,w,h); radial(c,H.x,H.y,h*.25,[[0,'rgba(70,230,240,.18)'],[1,'rgba(0,0,0,0)']]);
  }
  function drawDanceMini(c,w,h) {
    const H = mapMini(hive.x,hive.y,w,h); c.globalCompositeOperation='lighter';
    const dancers = state.bees.filter(b => b.state === 'dance');
    radial(c,H.x,H.y,h*.42,[[0,'rgba(178,115,255,.24)'],[1,'rgba(0,0,0,0)']]);
    c.strokeStyle='rgba(246,194,58,.18)'; c.lineWidth=1;
    for (let r=12; r<h*.55; r+=12) { c.beginPath(); c.arc(H.x,H.y,r + Math.sin(state.time*3 + r)*2,0,TAU); c.stroke(); }
    for (const b of dancers.slice(0,80)) {
      const a = b.memory ? angleTo(hive,b.memory) : Math.random()*TAU;
      c.strokeStyle='rgba(246,194,58,.35)'; c.beginPath(); c.moveTo(H.x,H.y); c.lineTo(H.x+Math.cos(a)*w*.45,H.y+Math.sin(a)*h*.45); c.stroke();
    }
  }
  function drawBuzzMini(c,w,h) {
    const H = mapMini(hive.x,hive.y,w,h); c.globalCompositeOperation='lighter';
    radial(c,H.x,H.y,h*.42,[[0,'rgba(88,230,230,.22)'],[1,'rgba(0,0,0,0)']]);
    const amp = 0.45 + Math.min(1, state.bees.filter(b=>b.state==='dance').length/24);
    for (let i=0;i<18;i++) {
      const r = (i/18)*Math.max(w,h)*0.75 + (state.time*18 % 18);
      c.strokeStyle = `hsla(${185+i*5},95%,60%,${0.10*amp*(1-i/24)})`;
      c.beginPath(); c.arc(H.x,H.y,r,0,TAU); c.stroke();
    }
    for (const f of state.flowers) { const p=mapMini(f.x,f.y,w,h); radial(c,p.x,p.y,h*.18,[[0,'rgba(246,194,58,.36)'],[1,'rgba(0,0,0,0)']]); }
  }
  function drawCoherenceMini(c,w,h) {
    c.globalCompositeOperation='lighter';
    const sample = state.bees.filter((_,i)=> i%5===0);
    for (const b of sample) {
      const p = mapMini(b.x,b.y,w,h); const sp = hypot(b.vx,b.vy)/cfg.beeSpeed;
      c.strokeStyle = `hsla(${120 + sp*80},90%,55%,0.13)`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(p.x,p.y); c.lineTo(p.x + Math.cos(b.heading)*12*sp, p.y + Math.sin(b.heading)*12*sp); c.stroke();
    }
    for (const f of state.flowers) { const p=mapMini(f.x,f.y,w,h); radial(c,p.x,p.y,h*.16,[[0,'rgba(246,194,58,.18)'],[1,'rgba(0,0,0,0)']]); }
  }
  function drawRoutesMini(c,w,h) {
    c.globalCompositeOperation='lighter';
    const H = mapMini(hive.x,hive.y,w,h);
    c.fillStyle='rgba(246,194,58,.42)'; c.beginPath(); c.arc(H.x,H.y,4,0,TAU); c.fill();
    for (const f of state.flowers) {
      const p=mapMini(f.x,f.y,w,h); const q=f.confidence;
      c.strokeStyle=`rgba(88,230,230,${0.08+q*.32})`; c.lineWidth=0.8+q*2.5;
      c.beginPath(); c.moveTo(H.x,H.y); c.quadraticCurveTo((H.x+p.x)/2, (H.y+p.y)/2 - 20 + Math.sin(state.time + f.id)*15, p.x,p.y); c.stroke();
      c.fillStyle=`rgba(246,194,58,${0.2+q*.5})`; c.beginPath(); c.arc(p.x,p.y,3+q*4,0,TAU); c.fill();
    }
    // Some local interaction graph edges.
    const sample = state.bees.filter((b,i)=> (b.state!=='idle') && i%13===0).slice(0,60).map(b=>mapMini(b.x,b.y,w,h));
    c.lineWidth=.5;
    for(let i=0;i<sample.length-1;i++){ const a=sample[i], b=sample[i+1]; if (Math.hypot(a.x-b.x,a.y-b.y)<w*.35){ c.strokeStyle='rgba(120,227,109,.08)'; c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(b.x,b.y); c.stroke(); }}
  }

  function drawColorbar(c,w,h,kind) {
    const x=16, y=h-17, bw=w-32, bh=6;
    const g=c.createLinearGradient(x,y,x+bw,y);
    g.addColorStop(0, kind==='nectar'?'#2b1b5a':'#1f255a');
    g.addColorStop(.35, '#1cc7d4'); g.addColorStop(.7, '#73e36a'); g.addColorStop(1, '#f6c23a');
    if (kind==='phero' || kind==='dance') { g.addColorStop(.35,'#a028c9'); g.addColorStop(.75,'#ff7b2c'); }
    c.fillStyle=g; c.fillRect(x,y,bw,bh);
    c.fillStyle='rgba(220,228,240,.75)'; c.font='10px ui-sans-serif, system-ui';
    c.fillText(kind==='nectar'?'Low':'0.0',x,y-4); c.fillText(kind==='nectar'?'High':'1.0',x+bw-22,y-4);
  }

  function updateMetrics(force = false) {
    if (!force && performance.now() - state.lastMetrics < 250) return;
    state.lastMetrics = performance.now();
    const counts = { idle:0, hive:0, scout:0, forage:0, return:0, dance:0, recruit:0 };
    for (const b of state.bees) {
      if (inHive(b)) counts.hive++;
      if (b.state === 'scout') counts.scout++;
      if (b.state === 'forage' || b.state === 'outbound') counts.forage++;
      if (b.state === 'return') counts.return++;
      if (b.state === 'dance') counts.dance++;
      if (b.role === 'recruit') counts.recruit++;
      if (b.state === 'idle') counts.idle++;
    }
    const total = state.bees.length || 1;
    const recentRecruit = state.recruitEvents.filter(e=>e.t > state.time - 60);
    const attempts = recentRecruit.filter(e=>e.type==='attempt').length;
    const succ = recentRecruit.filter(e=>e.type==='success').length;
    const recentSignals = state.signalEvents.filter(e => e.t > state.time - 60);
    const trembleSignals = recentSignals.filter(e => e.type === 'tremble').length;
    const shakeSignals = recentSignals.filter(e => e.type === 'shake').length;
    const stopSignals = recentSignals.filter(e => e.type === 'stop').length;
    const recRate = attempts;
    const coherenceStats = danceCoherenceStats();
    const coherence = coherenceStats.r;
    const meanHiveDist = mean(state.bees.map(b => hypot(b.x-hive.x,b.y-hive.y)),0) / 7.5;
    const meanPath = mean(state.pathSamples.filter(e=>e.t > state.time-60).map(e=>e.v),0) / 7.5;
    const eff = mean(state.efficiencySamples.filter(e=>e.t > state.time-60).map(e=>e.v),0);
    const flowerYield = mean(state.flowers.map(f => f.nectar/f.cap), 0);
    const buzz = clamp(counts.dance / Math.max(5, total * 0.05) * 0.65 + coherence * 0.35, 0, 1);
    const danceActivity = clamp(counts.dance / Math.max(1, total * 0.06), 0, 1);
    const phero = clamp(flowerYield * 0.45 + state.flowers.reduce((s,f)=>s+f.confidence,0) / Math.max(1,state.flowers.length) * 0.55, 0, 1);
    const worldModelBits = estimateWorldModelBits();
    const transferRateBits = estimateTransferRateBitsPerSec();
    const envBits = estimateEnvironmentModeledBits();
    const realityEquivalentRuns = estimateRealityEquivalentRuns(envBits);

    el('mTotal').textContent = total.toLocaleString();
    el('mHive').textContent = counts.hive.toLocaleString();
    el('mScout').textContent = counts.scout.toLocaleString();
    el('mForage').textContent = counts.forage.toLocaleString();
    el('mReturn').textContent = counts.return.toLocaleString();
    el('mDance').textContent = counts.dance.toLocaleString();
    el('mExplorer').textContent = `${Math.round((counts.scout + counts.idle*0.2)/total*100)}%`;
    el('mScoutPct').textContent = `${Math.round(counts.scout/total*100)}%`;
    el('mNectarPct').textContent = `${Math.round((counts.forage+counts.return)/total*100)}%`;
    el('mDancePct').textContent = `${Math.round(counts.dance/total*100)}%`;
    el('mWaggle').textContent = counts.dance.toLocaleString();
    el('mTremble').textContent = trembleSignals.toLocaleString();
    el('mShaking').textContent = shakeSignals.toLocaleString();
    el('mStop').textContent = stopSignals.toLocaleString();
    el('mCoherence').textContent = coherence.toFixed(2);
    el('mDirStd').textContent = `${coherenceStats.dirStdDeg.toFixed(1)}°`;
    el('mDistCv').textContent = coherenceStats.distCv.toFixed(2);
    el('mRecSuccess').textContent = attempts ? `${Math.round(succ / attempts * 100)}%` : '—';
    el('mRecruits').textContent = recRate.toFixed(1);
    el('mPhero').textContent = phero.toFixed(2);
    el('mBuzz').textContent = buzz.toFixed(2);
    el('mDanceActivity').textContent = danceActivity.toFixed(2);
    el('mContacts').textContent = Math.round(state.contacts).toLocaleString();
    el('mInfoModel').textContent = infoModelSpec().label;
    el('mWorldBits').textContent = fmtBits(worldModelBits);
    el('mInfoRate').textContent = fmtBitRate(transferRateBits);
    el('mEnvBits').textContent = fmtBits(envBits);
    el('mRealityEq').textContent = fmtRuns(realityEquivalentRuns);
    el('mHiveDist').textContent = `${meanHiveDist.toFixed(1)} m`;
    el('mPathLength').textContent = meanPath ? `${meanPath.toFixed(1)} m` : '—';
    el('mEfficiency').textContent = eff ? eff.toFixed(2) : '—';
    el('mRoutes').textContent = state.flowers.filter(f=>f.discovered || f.confidence>0.18).length.toString();
    el('mSimTime').textContent = fmtTime(state.time);
    el('mSimSpeed').textContent = `${cfg.simSpeed.toFixed(1)}×`;
    const phaseCycle = (state.time % 180) / 180;
    el('mPhase').textContent = phaseCycle < .72 ? 'Foraging' : phaseCycle < .88 ? 'Recruitment' : 'Reorientation';
    el('mNectar').textContent = state.delivered.toFixed(1);
    el('statusTime').textContent = fmtTime(state.time);
    el('rewardReadout').textContent = reward().toFixed(3);
  }

  // Literature-aligned directional precision:
  // - resultant vector length r for direction agreement
  // - circular standard deviation in degrees for waggle-angle spread
  // Distance coherence proxy:
  // - coefficient of variation (CV) across advertised distances.
  function danceCoherenceStats() {
    const dancers = state.bees.filter(b => b.state === 'dance' && b.memory);
    if (!dancers.length) return { r: 0, dirStdDeg: 0, distCv: 0 };
    let x=0,y=0;
    const dists = [];
    for (const b of dancers) {
      const a = angleTo(hive,b.memory);
      x += Math.cos(a);
      y += Math.sin(a);
      dists.push(hypot(b.memory.x - hive.x, b.memory.y - hive.y));
    }
    const r = hypot(x,y) / dancers.length;
    const dirStdRad = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(r, 1e-8))));
    const dirStdDeg = dirStdRad * 180 / Math.PI;
    const m = mean(dists, 0);
    const variance = dists.length > 1 ? mean(dists.map(v => (v - m) * (v - m)), 0) : 0;
    const distCv = m > 1e-6 ? Math.sqrt(variance) / m : 0;
    return { r, dirStdDeg, distCv };
  }

  function loop(now) {
    const rawDt = (now - state.lastFrame) / 1000;
    state.lastFrame = now;
    state.fps = lerp(state.fps, 1 / Math.max(0.001, rawDt), 0.04);
    if (state.running) {
      if (cfg.engine === 'beestack_trace' && state.trace.active) simulateTrace(rawDt);
      else simulate(rawDt);
    }
    drawAll(); updateMetrics();
    requestAnimationFrame(loop);
  }

  setupControls(); resetSimulation(true); setRunning(true); requestAnimationFrame(loop);
})();
