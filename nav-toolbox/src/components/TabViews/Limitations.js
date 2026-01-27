import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import htm from 'htm';
import { useGameLoop } from '../../hooks/useGameLoop.js';

const html = htm.bind(h);

const PATH = [
    { x: 20, y: 150 },
    { x: 100, y: 150 },
    { x: 150, y: 50 },  // sharp turn
    { x: 250, y: 250 }, // sharp turn
    { x: 350, y: 150 },
    { x: 380, y: 150 }
];

// ---------- small geometry helpers ----------
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = p.x - a.x, apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby || 1e-9;
    const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
    return { x: a.x + t * abx, y: a.y + t * aby, t };
}

function getLookaheadPoint(pos, lookahead) {
    // 1) find closest point on the polyline
    let best = { d: Infinity, seg: 0, pt: PATH[0], t: 0 };
    for (let i = 0; i < PATH.length - 1; i++) {
        const a = PATH[i], b = PATH[i + 1];
        const cp = closestPointOnSegment(pos, a, b);
        const d = Math.hypot(pos.x - cp.x, pos.y - cp.y);
        if (d < best.d) best = { d, seg: i, pt: { x: cp.x, y: cp.y }, t: cp.t };
    }

    // 2) march forward along the polyline by 'lookahead' distance
    let remaining = lookahead;
    let i = best.seg;

    // start from the projection point on segment i
    let cur = { ...best.pt };

    while (remaining > 0 && i < PATH.length - 1) {
        const a = cur;
        const b = PATH[i + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);

        if (segLen < 1e-6) {
            i++;
            cur = { ...PATH[i] };
            continue;
        }

        if (remaining <= segLen) {
            const ux = (b.x - a.x) / segLen;
            const uy = (b.y - a.y) / segLen;
            return { x: a.x + ux * remaining, y: a.y + uy * remaining };
        }

        remaining -= segLen;
        i++;
        cur = { ...PATH[i] };
    }

    return { ...PATH[PATH.length - 1] };
}

export default function Limitations() {
    const [agentA, setAgentA] = useState({ x: 20, y: 150, theta: 0, index: 1, wait: 0 });
    const [agentB, setAgentB] = useState({ x: 20, y: 150, theta: 0 });
    const [finishedA, setFinishedA] = useState(false);
    const [finishedB, setFinishedB] = useState(false);

    // Oscillation detector for A: counts sign flips in heading error over a small window
    const oscRef = useRef({ lastSign: 0, flips: 0, window: 0.5, t: 0.5, flag: false, flagT: 0 });

    const reset = () => {
        setAgentA({ x: 20, y: 150, theta: 0, index: 1, wait: 0 });
        setAgentB({ x: 20, y: 150, theta: 0 });
        setFinishedA(false);
        setFinishedB(false);
        oscRef.current = { lastSign: 0, flips: 0, window: 0.5, t: 0.5, flag: false, flagT: 0 };
    };

    useGameLoop((dt) => {
        // normalize dt to seconds (works if dt is ms ~16 OR seconds ~0.016)
        const dtSec = dt > 1 ? dt / 1000 : dt;

        const speed = 90 * dtSec; // px/s
        const endPt = PATH[PATH.length - 1];

        // ---------------- Agent A: "naive" waypoint + high-gain steering ----------------
        if (!finishedA) {
            setAgentA((prev) => {
                let next = { ...prev };

                // wait only affects A (do NOT freeze the whole sim)
                if (next.wait > 0) {
                    next.wait = Math.max(0, next.wait - dtSec);
                    return next;
                }

                const target = PATH[next.index];
                const d = Math.hypot(target.x - next.x, target.y - next.y);

                if (d < 10) {
                    if (next.index < PATH.length - 1) {
                        next.index += 1;
                        next.wait = 0.6; // short pause (seconds)
                    } else {
                        setFinishedA(true);
                        return next;
                    }
                }

                // recompute target after possible index change
                const tgt = PATH[next.index];
                const targetAngle = Math.atan2(tgt.y - next.y, tgt.x - next.x);
                const angleDiff = wrapPi(targetAngle - next.theta);

                // oscillation detector (sign flips when |angleDiff| still meaningful)
                const s = Math.abs(angleDiff) > 0.15 ? Math.sign(angleDiff) : 0;
                const osc = oscRef.current;

                if (s !== 0 && osc.lastSign !== 0 && s !== osc.lastSign) osc.flips += 1;
                if (s !== 0) osc.lastSign = s;

                osc.t -= dtSec;
                if (osc.t <= 0) {
                    osc.flag = osc.flips >= 4;     // arbitrary threshold for demo
                    osc.flagT = osc.flag ? 0.8 : 0;
                    osc.flips = 0;
                    osc.t = osc.window;
                }
                if (osc.flagT > 0) {
                    osc.flagT -= dtSec;
                    if (osc.flagT <= 0) osc.flag = false;
                }

                // high-gain steering (over-reacts)
                const k = 10.0;
                let omega = k * angleDiff; // rad/s
                omega = clamp(omega, -14.0, 14.0); // very high max turn-rate
                next.theta = wrapPi(next.theta + omega * dtSec);

                // stop-and-turn behavior: only move when roughly aligned
                if (Math.abs(angleDiff) < 0.45) {
                    next.x += Math.cos(next.theta) * speed;
                    next.y += Math.sin(next.theta) * speed;
                }

                return next;
            });
        }

        // ---------------- Agent B: smooth lookahead (pure pursuit-ish) ----------------
        if (!finishedB) {
            setAgentB((prev) => {
                let next = { ...prev };

                // finish condition
                if (dist(next, endPt) < 10) {
                    setFinishedB(true);
                    return next;
                }

                const lookahead = 45; // px
                const target = getLookaheadPoint(next, lookahead);

                const targetAngle = Math.atan2(target.y - next.y, target.x - next.x);
                const angleDiff = wrapPi(targetAngle - next.theta);

                // smooth steering
                const k = 3.0;
                let omega = k * angleDiff; // rad/s
                omega = clamp(omega, -4.0, 4.0);
                next.theta = wrapPi(next.theta + omega * dtSec);

                // slow down a bit when turning hard (looks "robotic")
                const v = (1 - clamp(Math.abs(angleDiff) / 1.2, 0, 0.5));
                next.x += Math.cos(next.theta) * speed * v;
                next.y += Math.sin(next.theta) * speed * v;

                return next;
            });
        }
    });

    const oscillating = oscRef.current.flag;

    return html`
    <div class="split-view" style="flex-direction: column;">
      <div class="canvas-container">
        <svg viewBox="0 0 400 300" style="width: 100%; height: 100%;">
          <!-- Path -->
          <polyline
            points=${PATH.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#334155"
            stroke-width="20"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.3"
          />
          <polyline
            points=${PATH.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#4ade80"
            stroke-width="2"
            stroke-dasharray="4"
          />

          <!-- Agent A (Red, Naive) -->
          <g transform="translate(${agentA.x}, ${agentA.y}) rotate(${agentA.theta * 180 / Math.PI})">
            <rect x="-10" y="-6" width="20" height="12" fill="#f87171" opacity="0.85" />
            <line x1="0" y1="0" x2="15" y2="0" stroke="white" stroke-width="2" />
          </g>
          <text x=${agentA.x} y=${agentA.y - 12} fill="#f87171" font-size="10" text-anchor="middle">Naive</text>

          <!-- Agent B (Blue, Stable) -->
          <g transform="translate(${agentB.x}, ${agentB.y}) rotate(${agentB.theta * 180 / Math.PI})">
            <rect x="-10" y="-6" width="20" height="12" fill="#38bdf8" opacity="0.85" />
            <line x1="0" y1="0" x2="15" y2="0" stroke="white" stroke-width="2" />
          </g>
          <text x=${agentB.x} y=${agentB.y + 22} fill="#38bdf8" font-size="10" text-anchor="middle">Stable</text>

          <!-- Status -->
          <text x="390" y="285" font-size="10" fill="#f87171" text-anchor="end">
            ${oscillating ? 'UNSTABLE TURNING (sign-flip oscillation)' : ''}
          </text>
        </svg>

        <div class="controls">
          <button class="control-btn" onClick=${reset}>Restart Race</button>
        </div>
      </div>

      <div class="caption-area">
        <h3>Limitation: Representation → Action (Embodiment)</h3>
        <ul>
          <li><strong>Same “Plan”, different behaviour:</strong> Both agents share the same route (green), but differ in control.</li>
          <li><strong>Naive (red):</strong> Over-reactive heading correction + stop-and-turn makes motion jerky and can become unstable.</li>
          <li><strong>Stable (blue):</strong> Lookahead steering produces smooth trajectories and respects turn limits.</li>
          <li><strong>Takeaway:</strong> A representation (map/route) is not an action policy. You need a control loop under physics.</li>
        </ul>
      </div>
    </div>
  `;
}
