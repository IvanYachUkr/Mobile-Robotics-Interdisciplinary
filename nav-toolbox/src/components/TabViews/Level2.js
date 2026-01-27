import { h } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
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
function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function lerp(a, b, t) { return a + (b - a) * t; }

export default function Level2() {
    // Arena
    const W = 400, H = 300;
    const MARGIN = 16;

    const HOME = { x: 200, y: 200 };
    const HOME_R = 14;

    const LANDMARK = { x: 110, y: 85 };
    const LANDMARK_RANGE = 85;
    const LANDMARK_LOCK_R = 12;

    // Foraging targets (purposeful outbound)
    const FOOD_COUNT = 3;
    const FOOD_R = 9;

    // Timing
    const OUTBOUND_SECONDS = 10.0;

    // Movement
    const SPEED = 90;      // px/sec
    const TURN_RATE = 3.0; // rad/sec

    // Odometry error (make it visibly fail)
    const ODO_NOISE_STD = 0.9;     // stronger noise
    const DRIFT_WALK_STD = 0.55;   // stronger drift random walk

    const [phase, setPhase] = useState('IDLE'); // IDLE, OUTBOUND, RETURN
    const [returnMode, setReturnMode] = useState('COMPASS'); // COMPASS, ODOMETRY, LANDMARK

    const [agent, setAgent] = useState({ x: HOME.x, y: HOME.y, theta: -Math.PI / 2 });

    // odometry estimate = estimated displacement from HOME in world coords
    const [odoEst, setOdoEst] = useState({ x: 0, y: 0 });

    // true trail and estimated trail
    const [trail, setTrail] = useState([{ x: HOME.x, y: HOME.y }]);
    const [odoTrail, setOdoTrail] = useState([{ x: HOME.x, y: HOME.y }]);

    const [beaconActive, setBeaconActive] = useState(false);
    const [tElapsed, setTElapsed] = useState(0);
    const [foodIdx, setFoodIdx] = useState(0);

    // refs (stable sim state)
    const agentRef = useRef(agent);
    const odoRef = useRef(odoEst);
    const phaseRef = useRef(phase);
    const modeRef = useRef(returnMode);
    const tRef = useRef(0);

    const trailRef = useRef(trail);
    const odoTrailRef = useRef(odoTrail);

    const foodRef = useRef([]);
    const foodIdxRef = useRef(0);

    // odometry drift bias (random walk)
    const driftRef = useRef({ bx: 0, by: 0 });

    // landmark “locked” state for beaconing demo
    const lmLockedRef = useRef(false);

    // landmark correction flash
    const flashRef = useRef(0);

    useEffect(() => { agentRef.current = agent; }, [agent]);
    useEffect(() => { odoRef.current = odoEst; }, [odoEst]);
    useEffect(() => { phaseRef.current = phase; }, [phase]);
    useEffect(() => { modeRef.current = returnMode; }, [returnMode]);
    useEffect(() => { trailRef.current = trail; }, [trail]);
    useEffect(() => { odoTrailRef.current = odoTrail; }, [odoTrail]);

    const randomFoodPoint = () => {
        for (let k = 0; k < 60; k++) {
            const x = lerp(MARGIN + 20, W - MARGIN - 20, Math.random());
            const y = lerp(MARGIN + 20, H - MARGIN - 20, Math.random());
            const d = Math.hypot(x - HOME.x, y - HOME.y);
            if (d > 85 && d < 170) return { x, y };
        }
        return { x: 300, y: 120 };
    };

    const reset = useCallback(() => {
        const a = { x: HOME.x, y: HOME.y, theta: -Math.PI / 2 };
        agentRef.current = a;
        setAgent(a);

        const o = { x: 0, y: 0 };
        odoRef.current = o;
        setOdoEst(o);

        const foods = Array.from({ length: FOOD_COUNT }, () => randomFoodPoint());
        foodRef.current = foods;

        foodIdxRef.current = 0;
        setFoodIdx(0);

        const tr = [{ x: HOME.x, y: HOME.y }];
        trailRef.current = tr;
        setTrail(tr);

        const otr = [{ x: HOME.x, y: HOME.y }];
        odoTrailRef.current = otr;
        setOdoTrail(otr);

        driftRef.current = { bx: 0, by: 0 };
        lmLockedRef.current = false;
        flashRef.current = 0;

        tRef.current = 0;
        setTElapsed(0);

        setBeaconActive(false);

        setPhase('OUTBOUND');
        phaseRef.current = 'OUTBOUND';
    }, []);

    useEffect(() => {
        foodRef.current = Array.from({ length: FOOD_COUNT }, () => randomFoodPoint());
    }, []);

    // Smooth wall avoidance (prevents “sticking”)
    const steerWithWalls = (desiredAngle, x, y) => {
        const vx = Math.cos(desiredAngle);
        const vy = Math.sin(desiredAngle);

        let rx = 0, ry = 0;

        const left = x - MARGIN;
        const right = (W - MARGIN) - x;
        const top = y - MARGIN;
        const bottom = (H - MARGIN) - y;

        const push = (d, nx, ny) => {
            const t = clamp((35 - d) / 35, 0, 1);
            const s = t * t;
            rx += nx * s;
            ry += ny * s;
        };

        push(left, 1, 0);
        push(right, -1, 0);
        push(top, 0, 1);
        push(bottom, 0, -1);

        const sx = vx + 1.4 * rx;
        const sy = vy + 1.4 * ry;
        return Math.atan2(sy, sx);
    };

    useGameLoop((dtRaw) => {
        let dt = dtRaw;
        if (dt > 1) dt = dt / 1000;
        dt = clamp(dt, 0, 0.05);

        if (phaseRef.current === 'IDLE') return;

        let a = { ...agentRef.current };
        let odo = { ...odoRef.current };
        let t = tRef.current + dt;

        flashRef.current = Math.max(0, flashRef.current - dt * 2.2);

        const foods = foodRef.current;
        let desiredAngle = a.theta;

        // visibility checks
        const dLm = Math.hypot(a.x - LANDMARK.x, a.y - LANDMARK.y);
        const lmVisible = dLm <= LANDMARK_RANGE;
        const lmNear = dLm <= LANDMARK_LOCK_R;

        // Beacon ring only when LANDMARK mode and landmark is visible
        setBeaconActive(modeRef.current === 'LANDMARK' && lmVisible);

        // --- OUTBOUND: purposeful foraging ---
        if (phaseRef.current === 'OUTBOUND') {
            let target = foods[foodIdxRef.current];

            const dFood = Math.hypot(a.x - target.x, a.y - target.y);
            if (dFood < FOOD_R + 6) {
                foodIdxRef.current = (foodIdxRef.current + 1) % foods.length;
                setFoodIdx(foodIdxRef.current);
                target = foods[foodIdxRef.current];
            }

            const wobble = 0.18 * randn() * dt;
            desiredAngle = Math.atan2(target.y - a.y, target.x - a.x) + wobble;

            if (t >= OUTBOUND_SECONDS) {
                phaseRef.current = 'RETURN';
                setPhase('RETURN');
                lmLockedRef.current = false;
            }
        }

        // --- RETURN: distinct primitives ---
        if (phaseRef.current === 'RETURN') {
            const mode = modeRef.current;

            if (Math.hypot(a.x - HOME.x, a.y - HOME.y) < HOME_R) {
                phaseRef.current = 'IDLE';
                setPhase('IDLE');
            }

            if (mode === 'COMPASS') {
                // “Compass homing”: direct home bearing (clean, straight)
                desiredAngle = Math.atan2(HOME.y - a.y, HOME.x - a.x);
            }

            if (mode === 'ODOMETRY') {
                // “Path integration”: go where your internal homing vector points
                desiredAngle = Math.atan2(-odo.y, -odo.x);
            }

            if (mode === 'LANDMARK') {
                // Landmark beaconing: detour to landmark first, then re-anchor odometry, then home by odometry.
                if (!lmLockedRef.current) {
                    // go to landmark (beaconing / telotaxis-like)
                    desiredAngle = Math.atan2(LANDMARK.y - a.y, LANDMARK.x - a.x);

                    if (lmNear) {
                        // “recalibration”: snap estimate toward true displacement from HOME
                        // (external cue anchors internal odometry)
                        odo.x = a.x - HOME.x;
                        odo.y = a.y - HOME.y;

                        lmLockedRef.current = true;
                        flashRef.current = 1.0;
                    }
                } else {
                    // after locking, home using (now-corrected) odometry
                    desiredAngle = Math.atan2(-odo.y, -odo.x);
                }
            }
        }

        // Wall-aware steering
        desiredAngle = steerWithWalls(desiredAngle, a.x, a.y);

        // Turn
        const dth = angleDiff(desiredAngle, a.theta);
        a.theta = wrapPi(a.theta + clamp(dth, -TURN_RATE * dt, TURN_RATE * dt));

        // Move
        const prevX = a.x, prevY = a.y;
        a.x += Math.cos(a.theta) * (SPEED * dt);
        a.y += Math.sin(a.theta) * (SPEED * dt);
        a.x = clamp(a.x, MARGIN, W - MARGIN);
        a.y = clamp(a.y, MARGIN, H - MARGIN);

        // Actual displacement (post-clamp)
        const dX = a.x - prevX;
        const dY = a.y - prevY;

        // Odometry always integrates motion (primitive is “available” even if not used)
        driftRef.current.bx += randn() * DRIFT_WALK_STD * dt;
        driftRef.current.by += randn() * DRIFT_WALK_STD * dt;

        const nx = randn() * ODO_NOISE_STD * Math.sqrt(dt);
        const ny = randn() * ODO_NOISE_STD * Math.sqrt(dt);

        odo.x += dX + driftRef.current.bx * dt + nx;
        odo.y += dY + driftRef.current.by * dt + ny;

        // Trails (downsample a bit for perf)
        const pushEvery = 3;

        // true trail
        if ((trailRef.current.length % pushEvery) === 0) {
            const tr = trailRef.current;
            tr.push({ x: a.x, y: a.y });
            if (tr.length > 420) tr.shift();
            trailRef.current = tr;
            setTrail([...tr]);
        } else {
            // still keep last point “fresh-ish” without spamming
            const tr = trailRef.current;
            if (tr.length) tr[tr.length - 1] = { x: a.x, y: a.y };
        }

        // estimated trail (odometry backtrace)
        if ((odoTrailRef.current.length % pushEvery) === 0) {
            const estX = HOME.x + odo.x;
            const estY = HOME.y + odo.y;
            const otr = odoTrailRef.current;
            otr.push({ x: estX, y: estY });
            if (otr.length > 420) otr.shift();
            odoTrailRef.current = otr;
            setOdoTrail([...otr]);
        }

        // commit state
        agentRef.current = a;
        odoRef.current = odo;
        tRef.current = t;

        setAgent(a);
        setOdoEst(odo);
        setTElapsed(t);
    });

    // --- Derived visuals ---
    const mode = returnMode;
    const showOdoViz = (mode !== 'COMPASS'); // show for ODOMETRY + LANDMARK

    const estPos = { x: HOME.x + odoEst.x, y: HOME.y + odoEst.y };
    const flash = flashRef.current;

    // “believed home direction” arrow (what odometry would do)
    const believedAngle = Math.atan2(-odoEst.y, -odoEst.x);
    const bhX = agent.x + Math.cos(believedAngle) * 42;
    const bhY = agent.y + Math.sin(believedAngle) * 42;

    return html`
    <div class="split-view" style="flex-direction: column;">
      <div class="canvas-container">
        <svg viewBox="0 0 400 300" style="width: 100%; height: 100%;">
          <!-- Arena -->
          <rect x="10" y="10" width="380" height="280" fill="none" stroke="#334155" />

          <!-- HOME -->
          <circle cx=${HOME.x} cy=${HOME.y} r=${HOME_R + 6} fill="#4ade80" opacity="0.18" />
          <circle cx=${HOME.x} cy=${HOME.y} r=${HOME_R} fill="#4ade80" opacity="0.30" />
          <text x=${HOME.x} y=${HOME.y + 4} font-size="10" font-weight="bold" text-anchor="middle" fill="#0f172a">HOME</text>

          <!-- Landmark -->
          <circle cx=${LANDMARK.x} cy=${LANDMARK.y} r="8" fill="#a855f7" />
          <circle cx=${LANDMARK.x} cy=${LANDMARK.y} r=${LANDMARK_RANGE} fill="none" stroke="#a855f7" stroke-dasharray="4" opacity="0.22" />
          <text x=${LANDMARK.x} y=${LANDMARK.y - 12} font-size="10" text-anchor="middle" fill="#a855f7">Landmark</text>

          <!-- Food patches -->
          ${foodRef.current.map((p, i) => html`
            <circle cx=${p.x} cy=${p.y} r=${9} fill="#f59e0b" opacity=${phase === 'OUTBOUND' && i === foodIdx ? "0.95" : "0.25"} />
            <circle cx=${p.x} cy=${p.y} r=${15} fill="none" stroke="#f59e0b" opacity=${phase === 'OUTBOUND' && i === foodIdx ? "0.50" : "0.12"} />
          `)}

          <!-- True Trail -->
          <polyline
            points=${trail.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#94a3b8"
            stroke-opacity="0.55"
            stroke-width="1"
          />

          <!-- Odometry: Estimated path (RED BACKTRACE) -->
          ${showOdoViz && html`
            <polyline
              points=${odoTrail.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#f87171"
              stroke-opacity="0.35"
              stroke-width="2"
              stroke-dasharray="3"
            />
            <!-- Estimated position marker -->
            <circle cx=${estPos.x} cy=${estPos.y} r="6" fill="none" stroke="#f87171" stroke-width="2" opacity="0.9" />
            <line x1=${agent.x} y1=${agent.y} x2=${estPos.x} y2=${estPos.y} stroke="#f87171" stroke-opacity="0.35" stroke-dasharray="3" />
          `}

          <!-- Believed-home arrow (shows homing vector direction) -->
          ${showOdoViz && phase === 'RETURN' && html`
            <line x1=${agent.x} y1=${agent.y} x2=${bhX} y2=${bhY} stroke="#f87171" stroke-opacity="0.8" stroke-width="2" />
            <circle cx=${bhX} cy=${bhY} r="3" fill="#f87171" opacity="0.8" />
          `}

          <!-- Landmark correction flash -->
          ${mode === 'LANDMARK' && flash > 0 && html`
            <circle cx=${agent.x} cy=${agent.y} r=${18 + 18 * (1 - flash)} fill="none" stroke="#facc15" stroke-width="2" opacity=${0.8 * flash} />
          `}

          <!-- Compass widget -->
          ${mode === 'COMPASS' && html`
            <g transform="translate(350, 42)">
              <circle cx="0" cy="0" r="15" fill="none" stroke="#cbd5e1" stroke-width="1" opacity="0.9" />
              <text x="0" y="25" text-anchor="middle" font-size="8" fill="#cbd5e1">COMPASS</text>
              <line x1="0" y1="10" x2="0" y2="-10" stroke="#4ade80" stroke-width="2"
                    transform="rotate(${agent.theta * 180 / Math.PI + 90})" />
            </g>
          `}

          <!-- Agent -->
          <g transform="translate(${agent.x}, ${agent.y}) rotate(${agent.theta * 180 / Math.PI})">
            <circle cx="0" cy="0" r="6" fill="#38bdf8" />
            <line x1="0" y1="0" x2="9" y2="0" stroke="white" stroke-width="2" />
            ${beaconActive && html`<circle cx="0" cy="0" r="12" fill="none" stroke="#facc15" stroke-width="2" />`}
          </g>
        </svg>

        <div class="controls">
          <button class="control-btn" onClick=${reset}>Start / Reset</button>
          ${['COMPASS', 'ODOMETRY', 'LANDMARK'].map(m => html`
            <button class="control-btn ${returnMode === m ? 'active' : ''}" onClick=${() => setReturnMode(m)}>
              ${m}
            </button>
          `)}
          <span style="color:#94a3b8; font-size: 12px; margin-left: 10px;">
            Phase: <strong style="color:#facc15;">${phase}</strong> · t=${tElapsed.toFixed(1)}s
          </span>
        </div>
      </div>

      <div class="caption-area">
        <h3>Level 2: Spatial Primitives (why these are “building blocks”)</h3>
        <ul>
          <li><strong>Compass (direction sense):</strong> keep/compute a heading using celestial/geomagnetic cues in animals :contentReference[oaicite:3]{index=3} (robot analog: magnetometer / GNSS heading).</li>
          <li><strong>Odometry / path integration:</strong> estimate travel distance from self-motion cues (optic flow, step counting; grid-cell-linked distance tracking) . In the viz, the <span style="color:#f87171;">red dashed trail</span> is the agent’s <em>estimated</em> path drifting away from reality.</li>
          <li><strong>Landmark beaconing:</strong> move toward a recognized landmark (“beaconing”) :contentReference[oaicite:5]{index=5}. Here it detours to the landmark first, then the yellow flash shows external re-anchoring of odometry before homing.</li>
        </ul>
      </div>
    </div>
  `;
}