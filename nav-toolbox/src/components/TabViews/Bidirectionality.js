import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { useGameLoop } from '../../hooks/useGameLoop.js';

const html = htm.bind(h);

// ---------- Helpers ----------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function angleDiff(a, b) { return wrapPi(a - b); }

// Gaussian noise (Box–Muller)
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- World ----------
const WORLD_W = 400;
const WORLD_H = 300;

// Two identical landmarks (goal destinations) far away on the right
const L1 = { x: 340, y: 80, label: 'L1' };
const L2 = { x: 340, y: 220, label: 'L2' };

// Vantage region in the middle
const VANTAGE = { x: 200, y: 150, label: 'V' };

// Unique beacon for disambiguation measurement
const BEACON = { x: 320, y: 60, label: 'B' };

// Starting pose
const START = { x: 60, y: 150, theta: 0 };

// Hypothesis ambiguity modeled as vertical shift
const SHIFT_Y = 140;

// Vantage sensing radius
const V_SENSE_RADIUS = 55;

// Confidence threshold
const CONF_THRESH = 0.40;

// Motion params (slower)
const SPEED = 62;      // px/sec (was 90)
const TURN_RATE = 3.0; // rad/sec (was 3.5)

// Modes (only two)
const MODES = [
  { id: 'BIDIR', label: 'Bidirectional (Active)' },
  { id: 'STUBBORN', label: 'No belief updates (Stubborn)' },
];

// For stubborn weak-prior dithering
const STUB_DITHER_PERIOD = 1.6;

// ---------- Demo script ----------
const DEMO_GOAL_RADIUS = 16;
const DEMO_HOLD_AFTER_GOAL = 1.8;

// Two phases only
const DEMO = [
  {
    prior: 'STRONG_WRONG',
    mode: 'STUBBORN',
    title: 'No bidirectionality (stubborn)',
    line: 'Strong wrong prior → commits to L2 and ignores evidence.',
    result: 'Result: ends at L2 (wrong) and never corrects.',
    goal: 'L2',
  },
  {
    prior: 'STRONG_WRONG',
    mode: 'BIDIR',
    title: 'Bidirectional perception–action loop',
    line: 'Verify at V → update belief → reach L1 even with a wrong prior.',
    result: 'Result: ends at L1 (correct) after updating at V.',
    goal: 'L1',
  },
];

export default function Bidirectionality() {
  const [priorMode, setPriorMode] = useState('WEAK'); // WEAK | STRONG_CORRECT | STRONG_WRONG
  const [simMode, setSimMode] = useState('BIDIR');    // BIDIR | STUBBORN
  const [running, setRunning] = useState(false);

  const [robot, setRobot] = useState({ ...START });
  const [belief, setBelief] = useState([0.5, 0.5]); // [w1,w2]

  const [action, setAction] = useState('IDLE');
  const [measInfo, setMeasInfo] = useState(null); // {meas,sigma,pred1,pred2,err1,err2,winner,inVantage}
  const [tElapsed, setTElapsed] = useState(0);

  // Demo UI
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [demoTitle, setDemoTitle] = useState('');
  const [demoLine, setDemoLine] = useState('');
  const [demoPhase, setDemoPhase] = useState(0);

  // refs for stable loop
  const robotRef = useRef(robot);
  const beliefRef = useRef(belief);
  const priorRef = useRef(priorMode);
  const simModeRef = useRef(simMode);
  const runningRef = useRef(running);
  const actionRef = useRef(action);
  const measRef = useRef(measInfo);
  const demoEnabledRef = useRef(demoEnabled);

  const elapsedRef = useRef(0);
  const senseTimerRef = useRef(0);

  // Stubborn dithering state (for WEAK prior)
  const stubTimerRef = useRef(0);
  const stubSideRef = useRef(0); // 0 -> L1, 1 -> L2

  // Verification latch for BIDIR (forces “go to V first” so the loop is visible)
  const verifyRef = useRef({ needsVerify: true });

  // Demo progression refs
  const demoRef = useRef({ phase: 0, reached: false, hold: 0 });

  useEffect(() => { robotRef.current = robot; }, [robot]);
  useEffect(() => { beliefRef.current = belief; }, [belief]);
  useEffect(() => { priorRef.current = priorMode; }, [priorMode]);
  useEffect(() => { simModeRef.current = simMode; }, [simMode]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { actionRef.current = action; }, [action]);
  useEffect(() => { measRef.current = measInfo; }, [measInfo]);
  useEffect(() => { demoEnabledRef.current = demoEnabled; }, [demoEnabled]);

  const computeInitialBelief = (mode) => {
    if (mode === 'WEAK') return [0.5, 0.5];
    if (mode === 'STRONG_CORRECT') return [0.9, 0.1];
    // Strong wrong but recoverable
    return [0.15, 0.85];
  };

  const reset = useCallback((newPrior = priorRef.current, newSimMode = simModeRef.current) => {
    setRunning(false);
    runningRef.current = false;

    setPriorMode(newPrior);
    priorRef.current = newPrior;

    setSimMode(newSimMode);
    simModeRef.current = newSimMode;

    const r = { ...START };
    robotRef.current = r;
    setRobot(r);

    const b = computeInitialBelief(newPrior);
    beliefRef.current = b;
    setBelief(b);

    setAction('IDLE');
    actionRef.current = 'IDLE';

    setMeasInfo(null);
    measRef.current = null;

    elapsedRef.current = 0;
    senseTimerRef.current = 0;

    // reset verification latch
    verifyRef.current = { needsVerify: true };

    // randomize which way “stubborn-weak” starts dithering
    stubTimerRef.current = 0;
    stubSideRef.current = (Math.random() < 0.5) ? 0 : 1;

    setTElapsed(0);
  }, []);

  const start = useCallback(() => {
    setRunning(true);
    runningRef.current = true;
  }, []);

  const pause = useCallback(() => {
    setRunning(false);
    runningRef.current = false;
  }, []);

  const beginDemoPhase = useCallback((idx) => {
    const phase = DEMO[idx];

    demoRef.current = { phase: idx, reached: false, hold: 0 };
    setDemoPhase(idx);
    setDemoTitle(phase.title);
    setDemoLine(phase.line);

    reset(phase.prior, phase.mode);
    start();
  }, [reset, start]);

  // Start in demo mode: stubborn + strong wrong prior
  useEffect(() => {
    if (demoEnabled) beginDemoPhase(0);
    else reset('WEAK', 'BIDIR');
  }, [demoEnabled, beginDemoPhase, reset]);

  useGameLoop((dtMs) => {
    if (!runningRef.current) return;

    const dt = dtMs / 1000;
    if (dt <= 0 || dt > 0.25) return;

    let r = { ...robotRef.current };
    let b = [...beliefRef.current];

    const mode = simModeRef.current;

    // -----------------------------
    // TOP-DOWN: choose target
    // -----------------------------
    const w1 = b[0], w2 = b[1];
    const confident = Math.abs(w1 - w2) >= CONF_THRESH;

    let target = VANTAGE;
    let nextAction = 'GO_TO_V (active localization)';

    if (mode === 'BIDIR') {
      // Verify at V once, then commit.
      if (verifyRef.current.needsVerify) {
        target = VANTAGE;
        nextAction = 'GO_TO_V (verify)';
      } else if (confident) {
        target = (w1 >= w2) ? L1 : L2;
        nextAction = (w1 >= w2) ? 'GO_TO_L1 (belief commit)' : 'GO_TO_L2 (belief commit)';
      } else {
        target = VANTAGE;
        nextAction = 'GO_TO_V (active localization)';
      }
    }

    if (mode === 'STUBBORN') {
      // Stubborn: never updates belief, action follows the prior.
      if (priorRef.current === 'STRONG_CORRECT') {
        target = L1;
        nextAction = 'GO_TO_L1 (stubborn prior)';
      } else if (priorRef.current === 'STRONG_WRONG') {
        target = L2;
        nextAction = 'GO_TO_L2 (stubborn prior)';
      } else {
        // WEAK: dither forever
        stubTimerRef.current += dt;
        if (stubTimerRef.current > STUB_DITHER_PERIOD) {
          stubTimerRef.current = 0;
          stubSideRef.current = 1 - stubSideRef.current;
        }
        target = (stubSideRef.current === 0) ? L1 : L2;
        nextAction = 'DITHER (weak prior; no updates)';
      }
    }

    if (nextAction !== actionRef.current) {
      actionRef.current = nextAction;
      setAction(nextAction);
    }

    // -----------------------------
    // MOVE
    // -----------------------------
    const dx = target.x - r.x;
    const dy = target.y - r.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 2.5) {
      const desired = Math.atan2(dy, dx);
      const dth = angleDiff(desired, r.theta);
      const step = clamp(dth, -TURN_RATE * dt, TURN_RATE * dt);
      r.theta = wrapPi(r.theta + step);

      r.x += Math.cos(r.theta) * (SPEED * dt);
      r.y += Math.sin(r.theta) * (SPEED * dt);

      r.x = clamp(r.x, 10, WORLD_W - 10);
      r.y = clamp(r.y, 10, WORLD_H - 10);
    }

    // -----------------------------
    // BOTTOM-UP: measurement update
    // -----------------------------
    const dV = Math.hypot(VANTAGE.x - r.x, VANTAGE.y - r.y);
    const inVantage = dV <= V_SENSE_RADIUS;

    // Only BIDIR updates belief
    const allowBottomUp = (mode !== 'STUBBORN');

    senseTimerRef.current += dt;
    const SENSE_PERIOD = 0.35;

    // In BIDIR: update ONLY at V
    const shouldSense =
      allowBottomUp &&
      senseTimerRef.current >= SENSE_PERIOD &&
      (mode === 'BIDIR' && inVantage);

    if (shouldSense) {
      senseTimerRef.current = 0;

      // sigma model (good at V)
      const sigma = clamp(0.045 + 0.15 * (dV / V_SENSE_RADIUS), 0.045, 0.20);

      // Measurement: bearing to BEACON
      const trueBear = wrapPi(Math.atan2(BEACON.y - r.y, BEACON.x - r.x) - r.theta);
      const meas = wrapPi(trueBear + randn() * sigma);

      // Predictions under H1/H2
      const pred1 = wrapPi(Math.atan2(BEACON.y - r.y, BEACON.x - r.x) - r.theta);
      const ghostY = clamp(r.y + SHIFT_Y, 10, WORLD_H - 10);
      const pred2 = wrapPi(Math.atan2(BEACON.y - ghostY, BEACON.x - r.x) - r.theta);

      const err1 = Math.abs(angleDiff(meas, pred1));
      const err2 = Math.abs(angleDiff(meas, pred2));

      const lh1 = Math.exp(-0.5 * (err1 / sigma) * (err1 / sigma));
      const lh2 = Math.exp(-0.5 * (err2 / sigma) * (err2 / sigma));

      // Temper updates
      const alpha = 0.85;
      let nw1 = b[0] * Math.pow(lh1, alpha);
      let nw2 = b[1] * Math.pow(lh2, alpha);
      const s = nw1 + nw2;

      if (s > 1e-9) {
        nw1 /= s;
        nw2 /= s;
        b = [nw1, nw2];
      }

      // Once we’ve sensed at V and become confident, allow commitment
      const nowConfident = Math.abs(b[0] - b[1]) >= CONF_THRESH;
      if (mode === 'BIDIR' && verifyRef.current.needsVerify && nowConfident) {
        verifyRef.current.needsVerify = false;
      }

      const winner = (err1 <= err2) ? 'H1 (Near L1)' : 'H2 (Near L2)';
      const info = { meas, sigma, pred1, pred2, err1, err2, winner, inVantage };
      setMeasInfo(info);
      measRef.current = info;
    } else {
      // In STUBBORN mode, keep measurement panel clean
      if (mode === 'STUBBORN' && measRef.current !== null) {
        setMeasInfo(null);
        measRef.current = null;
      }
    }

    // Save back
    robotRef.current = r;
    beliefRef.current = b;

    setRobot(r);
    setBelief(b);

    elapsedRef.current += dt;
    setTElapsed(elapsedRef.current);

    // -----------------------------
    // Demo progression (2 phases)
    // -----------------------------
    if (demoEnabledRef.current) {
      const idx = demoRef.current.phase;
      const phase = DEMO[idx];

      const dL1 = Math.hypot(L1.x - r.x, L1.y - r.y);
      const dL2 = Math.hypot(L2.x - r.x, L2.y - r.y);
      const dGoal = (phase.goal === 'L1') ? dL1 : dL2;

      if (!demoRef.current.reached && dGoal <= DEMO_GOAL_RADIUS) {
        demoRef.current.reached = true;
        demoRef.current.hold = 0;
        setDemoLine(phase.result);
      }

      if (demoRef.current.reached) {
        demoRef.current.hold += dt;
        if (demoRef.current.hold >= DEMO_HOLD_AFTER_GOAL) {
          const next = (idx + 1) % DEMO.length;
          beginDemoPhase(next);
          return;
        }
      }
    }

    // Safety auto loop when NOT in demo
    if (!demoEnabledRef.current && elapsedRef.current > 28) {
      reset(priorRef.current, simModeRef.current);
    }
  });

  // ---------- Viz ----------
  const w1 = belief[0], w2 = belief[1];
  const resolved = Math.abs(w1 - w2) >= CONF_THRESH;

  const rayLen = 80;
  const meas = measInfo?.meas ?? 0;
  const pred1 = measInfo?.pred1 ?? 0;
  const pred2 = measInfo?.pred2 ?? 0;

  const measX = robot.x + Math.cos(robot.theta + meas) * rayLen;
  const measY = robot.y + Math.sin(robot.theta + meas) * rayLen;

  const p1X = robot.x + Math.cos(robot.theta + pred1) * (rayLen * 0.85);
  const p1Y = robot.y + Math.sin(robot.theta + pred1) * (rayLen * 0.85);

  const p2X = robot.x + Math.cos(robot.theta + pred2) * (rayLen * 0.85);
  const p2Y = robot.y + Math.sin(robot.theta + pred2) * (rayLen * 0.85);

  const modeLabel = MODES.find(m => m.id === simMode)?.label ?? simMode;
  const inVantageNow = (Math.hypot(VANTAGE.x - robot.x, VANTAGE.y - robot.y) <= V_SENSE_RADIUS);

  const demoOverlay = demoEnabled && (demoTitle || demoLine);

  // Floating bottom-right controls for demo entry / restart
  const DemoDock = html`
    <div style="
      position: absolute;
      right: 12px;
      bottom: 12px;
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.82);
      border: 1px solid rgba(148,163,184,0.22);
      backdrop-filter: blur(6px);
      z-index: 20;
      ">
      <button class="control-btn ${running ? '' : 'active'}" onClick=${running ? pause : start}>
        ${running ? 'Pause' : 'Run'}
      </button>

      ${demoEnabled
      ? html`
            <button class="control-btn" onClick=${() => beginDemoPhase(0)}>
              Restart demo
            </button>
            <button class="control-btn active" onClick=${() => setDemoEnabled(false)}>
              Exit demo
            </button>
          `
      : html`
            <button class="control-btn active" onClick=${() => setDemoEnabled(true)}>
              Start demo
            </button>
          `}
    </div>
  `;

  return html`
    <div class="split-view" style="flex-direction: column; height: 100%; position: relative;">
      ${DemoDock}

      <div style="flex: 1; display: flex; min-height: 0;">
        <!-- LEFT: WORLD -->
        <div style="flex: 2; border-right: 1px solid #334155; position: relative; background: #020617;">
          <div style="position:absolute; top:5px; left:5px; color:#94a3b8; font-size:10px; font-weight:bold;">
            PHYSICAL WORLD
          </div>

          ${demoOverlay && html`
            <div style="
              position:absolute;
              left:12px; right:12px; bottom:12px;
              background: rgba(2, 6, 23, 0.78);
              border: 1px solid rgba(148,163,184,0.22);
              border-radius: 12px;
              padding: 12px 14px;
              color: #e2e8f0;
              backdrop-filter: blur(4px);
              ">
              <div style="font-size:14px; font-weight:800; color:#facc15; margin-bottom:6px;">
                ${demoTitle}
              </div>
              <div style="font-size:13px; line-height:1.35; color:#cbd5e1;">
                ${demoLine}
              </div>
            </div>
          `}

          <svg viewBox="0 0 400 300" style="width: 100%; height: 100%;">
            <!-- Landmarks -->
            <rect x=${L1.x - 10} y=${L1.y - 10} width="20" height="20" fill="#a855f7" />
            <text x=${L1.x} y=${L1.y - 15} fill="#a855f7" font-size="10" text-anchor="middle">L1</text>

            <rect x=${L2.x - 10} y=${L2.y - 10} width="20" height="20" fill="#a855f7" />
            <text x=${L2.x} y=${L2.y - 15} fill="#a855f7" font-size="10" text-anchor="middle">L2</text>

            <!-- Vantage region -->
            <circle cx=${VANTAGE.x} cy=${VANTAGE.y} r=${V_SENSE_RADIUS}
                    fill="none" stroke="#facc15"
                    stroke-opacity=${inVantageNow ? "0.45" : "0.18"}
                    stroke-dasharray="4" />
            <circle cx=${VANTAGE.x} cy=${VANTAGE.y} r="8" fill="#facc15" />
            <text x=${VANTAGE.x} y=${VANTAGE.y + 20} fill="#facc15" font-size="10" text-anchor="middle">V (vantage)</text>

            <!-- Beacon -->
            <circle cx=${BEACON.x} cy=${BEACON.y} r="7" fill="#f59e0b" />
            <text x=${BEACON.x} y=${BEACON.y - 12} fill="#f59e0b" font-size="10" text-anchor="middle">B (beacon)</text>

            <!-- Rays only if we have measurement info -->
            ${measInfo && html`
              <line x1=${robot.x} y1=${robot.y} x2=${p1X} y2=${p1Y}
                    stroke="#38bdf8" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="4" />
              <line x1=${robot.x} y1=${robot.y} x2=${p2X} y2=${p2Y}
                    stroke="#f87171" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="4" />
              <line x1=${robot.x} y1=${robot.y} x2=${measX} y2=${measY}
                    stroke="#facc15" stroke-opacity="0.85" stroke-width="2" />
            `}

            <!-- Hypothesis ghosts -->
            <g opacity="0.25">
              <g transform="translate(${robot.x}, ${robot.y}) rotate(${robot.theta * 180 / Math.PI})">
                <polygon points="-10,-6 14,0 -10,6" fill="#38bdf8" opacity=${w1} />
              </g>
              <g transform="translate(${robot.x}, ${clamp(robot.y + SHIFT_Y, 10, WORLD_H - 10)}) rotate(${robot.theta * 180 / Math.PI})">
                <polygon points="-10,-6 14,0 -10,6" fill="#f87171" opacity=${w2} />
              </g>
            </g>

            <!-- Robot -->
            <g transform="translate(${robot.x}, ${robot.y}) rotate(${robot.theta * 180 / Math.PI})">
              <polygon points="-10,-7 14,0 -10,7" fill="#38bdf8" stroke="white" stroke-width="2" />
            </g>
          </svg>
        </div>

        <!-- RIGHT: BELIEF + INFO -->
        <div style="flex: 1; display: flex; flex-direction: column;">
          <div style="flex: 1; border-bottom: 1px solid #334155; padding: 10px; background: #0f172a;">
            <div style="color:#94a3b8; font-size:10px; font-weight:bold; margin-bottom:8px;">BELIEF STATE</div>

            <div style="margin-bottom: 10px; font-size: 11px; color: #cbd5e1;">
              <strong>Mode:</strong> <span style="color:#facc15;">${modeLabel}</span><br/>
              <strong>Run:</strong> <span style="color:${running ? "#4ade80" : "#94a3b8"};">${running ? "RUNNING" : "PAUSED"}</span>
            </div>

            <div style="margin-bottom: 15px;">
              <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; color:#38bdf8;">
                <span>H1: Near L1</span>
                <span>${(w1 * 100).toFixed(1)}%</span>
              </div>
              <div style="width:100%; height:12px; background:#1e293b; border-radius:2px;">
                <div style="width:${w1 * 100}%; height:100%; background:#38bdf8; transition: width 0.2s;"></div>
              </div>
            </div>

            <div>
              <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:2px; color:#f87171;">
                <span>H2: Near L2</span>
                <span>${(w2 * 100).toFixed(1)}%</span>
              </div>
              <div style="width:100%; height:12px; background:#1e293b; border-radius:2px;">
                <div style="width:${w2 * 100}%; height:100%; background:#f87171; transition: width 0.2s;"></div>
              </div>
            </div>

            <div style="margin-top: 10px; font-size: 11px; color: #94a3b8;">
              Status: <strong style="color:${resolved ? '#4ade80' : '#facc15'};">${resolved ? 'RESOLVED' : 'AMBIGUOUS'}</strong>
            </div>

            ${simMode === 'BIDIR' && html`
              <div style="margin-top: 10px; font-size: 11px; color: #cbd5e1;">
                <strong>Verify-first:</strong>
                <span style="color:${verifyRef.current.needsVerify ? '#facc15' : '#4ade80'};">
                  ${verifyRef.current.needsVerify ? 'ON (go to V)' : 'DONE'}
                </span>
              </div>
            `}
          </div>

          <div style="flex: 1; padding: 10px; background: #0f172a; display:flex; flex-direction:column; justify-content:center;">
            <div style="color:#94a3b8; font-size:10px; font-weight:bold; margin-bottom:6px;">CONTROL & SENSING</div>
            <div style="font-size: 11px; color: #cbd5e1; line-height: 1.7;">
              <div><strong>Action:</strong> <span style="color:${action.includes('V') ? '#facc15' : '#4ade80'}">${action}</span></div>
              <div><strong>Sensing gate:</strong> ${simMode === 'BIDIR' ? 'ONLY at V' : 'DISABLED'}</div>
              <div><strong>At V now:</strong> <span style="color:${inVantageNow ? "#facc15" : "#94a3b8"};">${inVantageNow ? "YES" : "NO"}</span></div>
              <div><strong>Association winner:</strong> <span style="color:#facc15;">${measInfo ? measInfo.winner : '—'}</span></div>
              <div><strong>σ:</strong> ${measInfo ? measInfo.sigma.toFixed(3) : '—'} rad</div>
              <div><strong>Time:</strong> ${tElapsed.toFixed(1)}s</div>
              ${demoEnabled && html`<div><strong>Demo phase:</strong> ${demoPhase + 1} / ${DEMO.length}</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="caption-area" style="min-height: 110px;">
        <h3 style="margin-bottom:6px;">Bidirectionality (loop vs no-loop)</h3>
        <ul style="margin-top:0;">
          <li><strong>Stubborn:</strong> top-down action follows the prior; no bottom-up correction.</li>
          <li><strong>Bidirectional:</strong> action goes to a vantage point, sensing updates belief, belief updates action.</li>
        </ul>
      </div>
    </div>
  `;
}
