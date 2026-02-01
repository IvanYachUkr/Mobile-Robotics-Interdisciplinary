import { h } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { useGameLoop } from '../../hooks/useGameLoop.js';

const html = htm.bind(h);

// ---------- Constants & Tuning ----------
const WORLD_W = 1000;
const WORLD_H = 720;
const MARGIN = 40;

// Move HOME to bottom-right to allow for longer walking paths (better drift visibility)
const HOME = { x: WORLD_W - 140, y: WORLD_H - 120 };
const HOME_R = 22;

const LANDMARK = { x: 210, y: 170 };
const LANDMARK_LOCK_R = 18;
const LANDMARK_RANGE = 140;

const SPEED = 90;
const TURN_RATE = 3.6;

// Trails: make them readable and persistent
const TRAIL_MAX = 900;
const TRAIL_SAMPLE_DT = 0.045; // ~22 Hz sampling
const ODO_TRAIL_OPACITY = 0.85; // stronger visibility
const REAL_TRAIL_OPACITY = 0.70;

// ---------- Helpers ----------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function angleDiff(a, b) { return wrapPi(a - b); }
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function radToDeg(r) { return r * 180 / Math.PI; }

// ---------- THE DEMO SCRIPT (Director) ----------
const DEMO_SEQUENCE = [
  {
    id: 'INTRO',
    duration: 1.8,
    phase: 'IDLE',
    mode: 'ODOMETRY',
    title: "Level 2: Spatial Primitives",
    desc: "The 'Navigation Toolbox': basic building blocks of spatial cognition.",
    showGhost: true,
  },

  // --- SCENARIO 1: ODOMETRY (Path Integration) ---
  {
    id: 'ODO_OUT',
    duration: 7.0,
    phase: 'OUTBOUND',
    mode: 'ODOMETRY',
    resetOnEnter: true,
    title: "Primitive: Path Integration (Odometry)",
    desc: "Blue = reality. Red dashed = belief. Watch belief drift during the walk.",
    showGhost: true,
  },
  {
    id: 'ODO_RET',
    duration: 7.0,
    phase: 'RETURN',
    mode: 'ODOMETRY',
    title: "Return via Odometry",
    desc: "Failure mode: without external cues, accumulated error can send you to the wrong 'Home'.",
    showGhost: true,
  },
  {
    id: 'ODO_HOLD',
    duration: 2.2,
    phase: 'HOLD',
    mode: 'ODOMETRY',
    title: "Hold: Notice the Drift",
    desc: "This pause exists because humans require time to visually process things.",
    showGhost: true,
  },
  {
    id: 'TO_COMPASS',
    duration: 1.4,
    phase: 'RESET',
    mode: 'ODOMETRY',
    title: "Switching to Compass…",
    desc: "Keeping the odometry trail visible during the transition (because that’s the point).",
    showGhost: true,
    fadeTrails: true,
  },

  // --- SCENARIO 2: COMPASS ---
  {
    id: 'COM_OUT',
    duration: 6.0,
    phase: 'OUTBOUND',
    mode: 'COMPASS',
    resetOnEnter: true,
    title: "Primitive: Direction Sense (Compass)",
    desc: "Compass gives a stable reference (North), so headings are consistent.",
    showGhost: false,
  },
  {
    id: 'COM_RET',
    duration: 6.2,
    phase: 'RETURN',
    mode: 'COMPASS',
    title: "Return via Compass",
    desc: "Using the home bearing (direction), you can travel a clean straight line.",
    showGhost: false,
  },
  {
    id: 'COM_HOLD',
    duration: 1.8,
    phase: 'HOLD',
    mode: 'COMPASS',
    title: "Hold: What the Compass Actually Does",
    desc: "It anchors direction. Distance still comes from movement, not magic.",
    showGhost: false,
  },
  {
    id: 'TO_LANDMARK',
    duration: 1.4,
    phase: 'RESET',
    mode: 'COMPASS',
    title: "Switching to Landmark…",
    desc: "",
    showGhost: false,
    fadeTrails: true,
  },

  // --- SCENARIO 3: LANDMARK ---
  {
    id: 'LM_OUT',
    duration: 7.2,
    phase: 'OUTBOUND',
    mode: 'LANDMARK',
    resetOnEnter: true,
    title: "Primitive: Landmark Beaconing",
    desc: "Foraging again (error accumulates). The landmark acts like a corrective cue.",
    showGhost: true,
  },
  {
    id: 'LM_RET',
    duration: 9.0,
    phase: 'RETURN',
    mode: 'LANDMARK',
    title: "Return via Landmark",
    desc: "1) Beacon to landmark. 2) Re-calibrate (flash). 3) Go Home using corrected belief.",
    showGhost: true,
  },
  {
    id: 'LM_HOLD',
    duration: 2.0,
    phase: 'HOLD',
    mode: 'LANDMARK',
    title: "Hold: Landmark Correction",
    desc: "That flash marks the moment belief is snapped back to reality.",
    showGhost: true,
  },
  {
    id: 'LOOP_RESET',
    duration: 1.2,
    phase: 'RESET',
    mode: 'LANDMARK',
    title: "Looping…",
    desc: "",
    showGhost: true,
    fadeTrails: true,
  }
];

export default function Level2Auto() {
  // --- Simulation State ---
  const [agent, setAgent] = useState({ x: HOME.x, y: HOME.y, theta: -Math.PI * 0.75 });

  // odoEst: internal belief of displacement from home
  const [odoEst, setOdoEst] = useState({ x: 0, y: 0 });

  const [trail, setTrail] = useState([]);
  const [odoTrail, setOdoTrail] = useState([]);

  // --- Sequencer State (render-facing) ---
  const [stepIdx, setStepIdx] = useState(0);
  const [stepTime, setStepTime] = useState(0);

  // --- Visual Effects ---
  const [flash, setFlash] = useState(0);
  const [isBeaconing, setIsBeaconing] = useState(false);

  // Refs for stable loop access
  const stateRef = useRef({
    agent: { x: HOME.x, y: HOME.y, theta: -Math.PI * 0.75 },
    odo: { x: 0, y: 0 },
    trail: [],
    odoTrail: [],
    drift: { bx: 0, by: 0 },
    lmLocked: false,
    foodIdx: 0,
    foods: [],

    // better trail sampling
    trailAcc: 0,

    // for compass UI
    desiredAngle: -Math.PI * 0.75,
    homeBearing: 0,
  });

  const seqRef = useRef({
    idx: 0,
    t: 0,
  });

  // Initialize random food locations
  useEffect(() => {
    const foods = [];
    for (let i = 0; i < 6; i++) {
      foods.push({
        x: MARGIN + Math.random() * (WORLD_W * 0.40),
        y: MARGIN + Math.random() * (WORLD_H * 0.40),
      });
    }
    stateRef.current.foods = foods;

    resetSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Logic to reset the simulation between scenes
  const resetSim = useCallback(() => {
    const s = stateRef.current;
    s.agent = { x: HOME.x, y: HOME.y, theta: -Math.PI * 0.75 };
    s.odo = { x: 0, y: 0 };
    s.trail = [{ x: HOME.x, y: HOME.y }];
    s.odoTrail = [{ x: HOME.x, y: HOME.y }];
    s.drift = { bx: 0, by: 0 };
    s.lmLocked = false;
    s.foodIdx = 0;
    s.trailAcc = 0;
    s.desiredAngle = s.agent.theta;
    s.homeBearing = 0;

    setFlash(0);
    setIsBeaconing(false);

    setAgent({ ...s.agent });
    setOdoEst({ ...s.odo }); // important for visual consistency on resets
    setTrail([...s.trail]);
    setOdoTrail([...s.odoTrail]);
  }, []);

  useGameLoop((dtRaw) => {
    const dt = clamp(dtRaw > 1 ? dtRaw / 1000 : dtRaw, 0, 0.05);

    // 1) MANAGE DEMO TIMELINE
    let idx = seqRef.current.idx;
    let t = seqRef.current.t + dt;

    const cur = DEMO_SEQUENCE[idx];

    if (t > cur.duration) {
      const nextIdx = (idx + 1) % DEMO_SEQUENCE.length;
      idx = nextIdx;
      t = 0;

      seqRef.current.idx = idx;
      setStepIdx(idx);

      const nextStep = DEMO_SEQUENCE[idx];
      if (nextStep.resetOnEnter) resetSim();
    }

    seqRef.current.t = t;
    setStepTime(t);

    const curStep = DEMO_SEQUENCE[idx];

    // Pause physics if non-motion phases
    const paused = (curStep.phase === 'IDLE' || curStep.phase === 'HOLD' || curStep.phase === 'RESET');
    if (paused) {
      if (flash > 0) setFlash(f => Math.max(0, f - dt * 2));
      return;
    }

    // 2) SIMULATION LOGIC
    const s = stateRef.current;
    let desiredAngle = s.agent.theta;
    let beaconActive = false;

    // --- OUTBOUND (Foraging) ---
    if (curStep.phase === 'OUTBOUND') {
      const target = s.foods[s.foodIdx];
      const d = Math.hypot(target.x - s.agent.x, target.y - s.agent.y);
      if (d < 18) s.foodIdx = (s.foodIdx + 1) % s.foods.length;

      desiredAngle = Math.atan2(target.y - s.agent.y, target.x - s.agent.x) + randn() * 0.25;
    }

    // --- RETURN (Homing) ---
    if (curStep.phase === 'RETURN') {
      const mode = curStep.mode;

      if (mode === 'COMPASS') {
        desiredAngle = Math.atan2(HOME.y - s.agent.y, HOME.x - s.agent.x);
      } else if (mode === 'ODOMETRY') {
        desiredAngle = Math.atan2(-s.odo.y, -s.odo.x);
      } else if (mode === 'LANDMARK') {
        const dLm = Math.hypot(s.agent.x - LANDMARK.x, s.agent.y - LANDMARK.y);

        if (!s.lmLocked) {
          desiredAngle = Math.atan2(LANDMARK.y - s.agent.y, LANDMARK.x - s.agent.x);
          beaconActive = true;

          if (dLm < LANDMARK_LOCK_R + 6) {
            s.lmLocked = true;
            s.odo.x = s.agent.x - HOME.x;
            s.odo.y = s.agent.y - HOME.y;
            setFlash(1.0);
          }
        } else {
          desiredAngle = Math.atan2(-s.odo.y, -s.odo.x);
        }
      }
    }

    s.desiredAngle = desiredAngle;
    s.homeBearing = Math.atan2(HOME.y - s.agent.y, HOME.x - s.agent.x);

    setIsBeaconing(beaconActive);
    if (flash > 0) setFlash(f => Math.max(0, f - dt * 2));

    // Soft Wall Avoidance
    const probeX = s.agent.x + Math.cos(desiredAngle) * 42;
    const probeY = s.agent.y + Math.sin(desiredAngle) * 42;
    const wallX = clamp(probeX, MARGIN, WORLD_W - MARGIN);
    const wallY = clamp(probeY, MARGIN, WORLD_H - MARGIN);

    if (wallX !== probeX || wallY !== probeY) {
      desiredAngle = Math.atan2(WORLD_H / 2 - s.agent.y, WORLD_W / 2 - s.agent.x);
      s.desiredAngle = desiredAngle;
    }

    // Move Agent
    const dTh = angleDiff(desiredAngle, s.agent.theta);
    s.agent.theta = wrapPi(s.agent.theta + clamp(dTh, -TURN_RATE * dt, TURN_RATE * dt));

    const prevX = s.agent.x;
    const prevY = s.agent.y;

    const dHome = Math.hypot(s.agent.x - HOME.x, s.agent.y - HOME.y);
    const canAutoStop = (curStep.mode === 'COMPASS' || (curStep.mode === 'LANDMARK' && s.lmLocked));
    const speedNow = (curStep.phase === 'RETURN' && canAutoStop && dHome < 14) ? 0 : SPEED;

    s.agent.x = clamp(s.agent.x + Math.cos(s.agent.theta) * speedNow * dt, MARGIN, WORLD_W - MARGIN);
    s.agent.y = clamp(s.agent.y + Math.sin(s.agent.theta) * speedNow * dt, MARGIN, WORLD_H - MARGIN);

    // Update Odometry (with BIAS + NOISE)
    const dX = s.agent.x - prevX;
    const dY = s.agent.y - prevY;

    const DRIFT_WIND = 1.7;
    s.drift.bx += (randn() * 1.3 + DRIFT_WIND) * dt;
    s.drift.by += (randn() * 1.3 + DRIFT_WIND) * dt;

    const errorActive = (curStep.mode === 'ODOMETRY' || curStep.mode === 'LANDMARK');
    const noiseScale = errorActive ? 1.0 : 0.0;

    s.odo.x += dX + (s.drift.bx * dt * noiseScale);
    s.odo.y += dY + (s.drift.by * dt * noiseScale);

    // Trails (time-based sampling)
    s.trailAcc += dt;
    if (s.trailAcc >= TRAIL_SAMPLE_DT) {
      s.trailAcc = 0;

      s.trail.push({ x: s.agent.x, y: s.agent.y });
      if (s.trail.length > TRAIL_MAX) s.trail.shift();

      s.odoTrail.push({ x: HOME.x + s.odo.x, y: HOME.y + s.odo.y });
      if (s.odoTrail.length > TRAIL_MAX) s.odoTrail.shift();
    }

    // Sync React State
    setAgent({ ...s.agent });
    setOdoEst({ ...s.odo });
    setTrail([...s.trail]);
    setOdoTrail([...s.odoTrail]);
  });

  // --- Rendering ---
  const curStep = DEMO_SEQUENCE[stepIdx];

  const ghostPos = { x: HOME.x + odoEst.x, y: HOME.y + odoEst.y };
  const showGhost = (curStep.showGhost !== false) && curStep.mode !== 'COMPASS';

  // Fade trails during RESET so the transition feels intentional
  const fade = curStep.fadeTrails ? clamp(1 - (stepTime / curStep.duration), 0, 1) : 1;

  const s = stateRef.current;
  const desiredAngle = s.desiredAngle || agent.theta;
  const homeBearing = s.homeBearing || 0;

  const showPauseOverlay = (curStep.phase === 'HOLD' || curStep.phase === 'RESET' || curStep.phase === 'IDLE');

  const headingRot = radToDeg(agent.theta) + 90;
  const bearingRot = radToDeg(homeBearing) + 90;
  const desiredRot = radToDeg(desiredAngle) + 90;

  return html`
    <div
      style="
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100vh;
        max-height: 100vh;
        overflow: hidden;
        background: #0b1220;
        color: white;
        padding: 12px;
        box-sizing: border-box;
      "
    >
      <div style="width: 100%; text-align: center; margin-bottom: 8px; flex: 0 0 auto;">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="font-size: 18px; font-weight: 800; color: #facc15; line-height: 1.12;">
            ${curStep.title}
          </div>
          <div style="font-size: 13px; color: #cbd5e1; max-width: 1100px; margin: 0 auto; line-height: 1.25;">
            ${curStep.desc}
          </div>
        </div>
      </div>

      <div style="flex: 1; min-height: 0; width: 100%; display:flex; align-items: stretch; justify-content: center;">
        <div
          style="
            position: relative;
            width: 100%;
            max-width: 1500px;
            height: 100%;
            min-height: 0;
            background: #111c33;
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 18px 40px rgba(0,0,0,0.45);
            border: 1px solid rgba(148,163,184,0.18);
          "
        >
          <svg viewBox="0 0 ${WORLD_W} ${WORLD_H}" style="width: 100%; height: 100%; display:block;">
            <!-- HOME -->
            <circle cx=${HOME.x} cy=${HOME.y} r=${HOME_R} fill="#22c55e" opacity=${0.16 * fade} />
            <circle cx=${HOME.x} cy=${HOME.y} r="6" fill="#22c55e" opacity=${1 * fade} />
            <text x=${HOME.x} y=${HOME.y + 36} fill="#22c55e" font-size="14" text-anchor="middle" font-weight="800" opacity=${fade}>HOME</text>

            <!-- LANDMARK -->
            <circle cx=${LANDMARK.x} cy=${LANDMARK.y} r="10" fill="#a855f7" opacity=${1 * fade} />
            <circle cx=${LANDMARK.x} cy=${LANDMARK.y} r=${LANDMARK_RANGE} fill="none" stroke="#a855f7" stroke-dasharray="6,6" opacity=${0.22 * fade} stroke-width="2" />
            <text x=${LANDMARK.x} y=${LANDMARK.y - 18} fill="#a855f7" font-size="14" text-anchor="middle" opacity=${fade}>LANDMARK</text>

            <!-- North indicator on the main map -->
            <g transform="translate(${WORLD_W - 70}, ${WORLD_H - 70})" opacity=${0.9 * fade}>
              <circle r="24" fill="rgba(0,0,0,0.35)" stroke="rgba(203,213,225,0.35)" stroke-width="1"/>
              <line x1="0" y1="14" x2="0" y2="-14" stroke="#4ade80" stroke-width="3"/>
              <polygon points="0,-18 -6,-8 6,-8" fill="#4ade80" />
              <text x="0" y="40" fill="#cbd5e1" font-size="12" text-anchor="middle" font-weight="700">NORTH</text>
            </g>

            <!-- Food targets -->
            <g opacity=${0.9 * fade}>
              ${stateRef.current.foods.map((f, i) => html`
                <circle cx=${f.x} cy=${f.y} r=${i === stateRef.current.foodIdx ? 7 : 5} fill=${i === stateRef.current.foodIdx ? "#facc15" : "rgba(250,204,21,0.55)"} />
              `)}
            </g>

            <!-- REAL trail -->
            <polyline
              points=${trail.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#38bdf8"
              stroke-width="3"
              opacity=${REAL_TRAIL_OPACITY * fade}
              stroke-linecap="round"
              stroke-linejoin="round"
            />

            <!-- GHOST trail -->
            ${showGhost && html`
              <polyline
                points=${odoTrail.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#f87171"
                stroke-width="4"
                stroke-dasharray="8,7"
                opacity=${ODO_TRAIL_OPACITY * fade}
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              ${curStep.phase === 'RETURN' && html`
                <line
                  x1=${agent.x} y1=${agent.y}
                  x2=${ghostPos.x} y2=${ghostPos.y}
                  stroke="white"
                  stroke-width="2"
                  stroke-dasharray="6,6"
                  opacity=${0.55 * fade}
                />
                <text
                  x=${(agent.x + ghostPos.x) / 2}
                  y=${(agent.y + ghostPos.y) / 2 - 12}
                  fill="white"
                  font-size="13"
                  text-anchor="middle"
                  opacity=${0.75 * fade}
                >Drift error</text>
              `}

              <g transform="translate(${ghostPos.x}, ${ghostPos.y}) rotate(${radToDeg(agent.theta)})" opacity=${1 * fade}>
                <circle r="10" fill="none" stroke="#f87171" stroke-width="3" />
                <line x1="0" y1="0" x2="14" y2="0" stroke="#f87171" stroke-width="3" />
                <text y="-16" fill="#f87171" font-size="12" text-anchor="middle" font-weight="800">BELIEF</text>
              </g>
            `}

            <!-- Compass mode: show bearing line to HOME -->
            ${curStep.mode === 'COMPASS' && curStep.phase === 'RETURN' && html`
              <line
                x1=${agent.x} y1=${agent.y}
                x2=${HOME.x} y2=${HOME.y}
                stroke="#4ade80"
                stroke-width="3"
                stroke-dasharray="10,7"
                opacity=${0.65 * fade}
              />
              <text
                x=${(agent.x + HOME.x) / 2}
                y=${(agent.y + HOME.y) / 2 - 14}
                fill="#4ade80"
                font-size="13"
                text-anchor="middle"
                font-weight="800"
                opacity=${0.85 * fade}
              >Home bearing</text>
            `}

            <!-- Landmark beacon line -->
            ${isBeaconing && html`
              <line
                x1=${agent.x} y1=${agent.y}
                x2=${LANDMARK.x} y2=${LANDMARK.y}
                stroke="#facc15"
                stroke-width="4"
                stroke-dasharray="10,7"
                opacity=${0.85 * fade}
              />
            `}

            <!-- Recalibration flash -->
            ${flash > 0 && html`
              <circle
                cx=${agent.x}
                cy=${agent.y}
                r=${26 + 70 * (1 - flash)}
                stroke="#facc15"
                stroke-width=${5 * flash}
                fill="none"
                opacity=${flash}
              />
              <text
                x=${agent.x}
                y=${agent.y - 40}
                fill="#facc15"
                font-size="16"
                font-weight="900"
                text-anchor="middle"
                opacity=${flash}
              >RE-CALIBRATED</text>
            `}

            <!-- AGENT -->
            <g transform="translate(${agent.x}, ${agent.y}) rotate(${radToDeg(agent.theta)})" opacity=${1 * fade}>
              <circle r="12" fill="#38bdf8" stroke="white" stroke-width="3" />
              <line x1="0" y1="0" x2="16" y2="0" stroke="white" stroke-width="3" />
            </g>
          </svg>

          <!-- Progress bar -->
          <div
            style="
              position: absolute;
              bottom: 0;
              left: 0;
              height: 6px;
              background: #facc15;
              width: ${(stepTime / curStep.duration) * 100}%;
              transition: width 0.08s linear;
              opacity: 0.95;
            "
          ></div>

          <!-- Phase chip -->
          <div
            style="
              position: absolute;
              top: 12px;
              left: 12px;
              background: rgba(0,0,0,0.55);
              padding: 8px 10px;
              border-radius: 10px;
              font-size: 12px;
              color: #cbd5e1;
              border: 1px solid rgba(148,163,184,0.18);
            "
          >
            PHASE:
            <span style="margin-left: 6px; color: ${curStep.phase === 'RETURN' ? '#4ade80' : (curStep.phase === 'OUTBOUND' ? '#facc15' : '#cbd5e1')}; font-weight: 900;">
              ${curStep.phase}
            </span>
            <span style="margin-left: 10px; opacity: 0.85;">MODE: <b>${curStep.mode}</b></span>
            <span style="margin-left: 10px; opacity: 0.85;">${stepIdx + 1}/${DEMO_SEQUENCE.length}</span>
          </div>

          <!-- Legend -->
          <div
            style="
              position: absolute;
              bottom: 14px;
              left: 12px;
              background: rgba(0,0,0,0.45);
              padding: 10px 12px;
              border-radius: 12px;
              font-size: 12px;
              color: #cbd5e1;
              border: 1px solid rgba(148,163,184,0.18);
              display: flex;
              gap: 12px;
              align-items: center;
              flex-wrap: wrap;
              max-width: 60%;
            "
          >
            <span><span style="color:#38bdf8; font-weight:900;">Blue</span> = real path</span>
            <span><span style="color:#f87171; font-weight:900;">Red dashed</span> = belief (odometry)</span>
            <span><span style="color:#22c55e; font-weight:900;">Green</span> = home / bearings</span>
            <span><span style="color:#a855f7; font-weight:900;">Purple</span> = landmark</span>
            <span><span style="color:#facc15; font-weight:900;">Yellow</span> = beacon / correction</span>
          </div>

          <!-- Compass widget -->
          ${curStep.mode === 'COMPASS' && html`
            <div style="position:absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.55); border: 1px solid rgba(148,163,184,0.18); border-radius: 14px; padding: 10px;">
              <svg width="140" height="140" viewBox="0 0 150 150">
                <circle cx="75" cy="75" r="62" fill="rgba(17,24,39,0.5)" stroke="rgba(203,213,225,0.5)" stroke-width="2"/>
                <text x="75" y="18" text-anchor="middle" font-size="12" fill="#cbd5e1" font-weight="800">N</text>
                <text x="135" y="80" text-anchor="middle" font-size="12" fill="#cbd5e1" font-weight="800">E</text>
                <text x="75" y="142" text-anchor="middle" font-size="12" fill="#cbd5e1" font-weight="800">S</text>
                <text x="15" y="80" text-anchor="middle" font-size="12" fill="#cbd5e1" font-weight="800">W</text>

                <!-- Desired heading (yellow) -->
                <g transform="translate(75,75) rotate(${desiredRot})">
                  <line x1="0" y1="0" x2="0" y2="-46" stroke="#facc15" stroke-width="5" />
                  <polygon points="0,-56 -8,-42 8,-42" fill="#facc15" />
                </g>

                <!-- Home bearing (green) -->
                <g transform="translate(75,75) rotate(${bearingRot})" opacity="0.9">
                  <line x1="0" y1="0" x2="0" y2="-40" stroke="#4ade80" stroke-width="4" stroke-dasharray="6,6" />
                </g>

                <!-- Actual heading (white) -->
                <g transform="translate(75,75) rotate(${headingRot})" opacity="0.95">
                  <line x1="0" y1="0" x2="0" y2="-34" stroke="white" stroke-width="4" />
                </g>

                <circle cx="75" cy="75" r="6" fill="#cbd5e1"/>
              </svg>
              <div style="text-align:center; font-size: 11px; color:#cbd5e1; margin-top: 6px;">
                <span style="color:#facc15; font-weight:900;">Yellow</span>: desired ·
                <span style="color:#4ade80; font-weight:900;"> Green</span>: home ·
                <span style="color:white; font-weight:900;"> White</span>: heading
              </div>
            </div>
          `}

          <!-- Pause / reset overlay -->
          ${showPauseOverlay && html`
            <div
              style="
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
              "
            >
              <div
                style="
                  background: rgba(0,0,0,0.40);
                  border: 1px solid rgba(148,163,184,0.20);
                  padding: 14px 18px;
                  border-radius: 14px;
                  text-align: center;
                  max-width: 720px;
                  backdrop-filter: blur(6px);
                "
              >
                <div style="font-size: 14px; color:#cbd5e1; letter-spacing: 0.8px; font-weight: 900;">
                  ${curStep.phase === 'HOLD' ? 'HOLD' : (curStep.phase === 'RESET' ? 'RESET' : 'IDLE')}
                </div>
                <div style="margin-top: 6px; font-size: 13px; color:#e2e8f0;">
                  ${curStep.desc || ""}
                </div>
              </div>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}
