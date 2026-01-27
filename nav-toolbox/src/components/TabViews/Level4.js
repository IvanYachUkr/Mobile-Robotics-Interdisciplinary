import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { useGameLoop } from '../../hooks/useGameLoop.js';

const html = htm.bind(h);

const WORLD_W = 400;
const WORLD_H = 300;
const MARGIN = 12;

const GOAL = { x: 300, y: 100 };

// Map route around the central wall
const MAP_ROUTE = [
  { x: 120, y: 250 },
  { x: 120, y: 30 },
  { x: 300, y: 30 },
  { x: 300, y: 100 },
];

function nearlyEqual(a, b, eps = 0.001) { return Math.abs(a - b) < eps; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Central wall rectangle
function hitsCentralWall(x, y) {
  return x > 150 && x < 170 && y > 50 && y < 250;
}

const KEY_TO_CMD = {
  ArrowUp: 'N', KeyW: 'N',
  ArrowDown: 'S', KeyS: 'S',
  ArrowLeft: 'W', KeyA: 'W',
  ArrowRight: 'E', KeyD: 'E',
};

export default function Level4() {
  const [submode, setSubmode] = useState('MAP'); // MAP | CARDS
  const [agent, setAgent] = useState({ x: 50, y: 250, theta: 0 });

  // Autopilot target (MAP route / go-to-goal in cards)
  const [target, setTarget] = useState(null); // {x,y} or null
  const [mapRouteActive, setMapRouteActive] = useState(false);
  const [mapRouteIndex, setMapRouteIndex] = useState(0);

  // Card mode: continuous direction command
  const [cardCommand, setCardCommand] = useState('STOP'); // N | E | S | W | STOP

  // Status
  const [blocked, setBlocked] = useState(false);

  // refs for stable loop
  const agentRef = useRef(agent);
  const targetRef = useRef(target);
  const submodeRef = useRef(submode);
  const mapRouteActiveRef = useRef(mapRouteActive);
  const mapRouteIndexRef = useRef(mapRouteIndex);
  const cardCommandRef = useRef(cardCommand);

  const blockedTimerRef = useRef(0);

  useEffect(() => { agentRef.current = agent; }, [agent]);
  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { submodeRef.current = submode; }, [submode]);
  useEffect(() => { mapRouteActiveRef.current = mapRouteActive; }, [mapRouteActive]);
  useEffect(() => { mapRouteIndexRef.current = mapRouteIndex; }, [mapRouteIndex]);
  useEffect(() => { cardCommandRef.current = cardCommand; }, [cardCommand]);

  const stopAutopilot = useCallback(() => {
    targetRef.current = null;
    setTarget(null);

    mapRouteActiveRef.current = false;
    setMapRouteActive(false);

    mapRouteIndexRef.current = 0;
    setMapRouteIndex(0);
  }, []);

  const resetAll = useCallback(() => {
    const a = { x: 50, y: 250, theta: 0 };
    agentRef.current = a;
    setAgent(a);

    stopAutopilot();

    setSubmode('MAP');
    submodeRef.current = 'MAP';

    cardCommandRef.current = 'STOP';
    setCardCommand('STOP');

    blockedTimerRef.current = 0;
    setBlocked(false);
  }, [stopAutopilot]);

  const startMapRoute = useCallback(() => {
    // Reset to communicate "map gives full plan immediately"
    const a = { x: 50, y: 250, theta: 0 };
    agentRef.current = a;
    setAgent(a);

    cardCommandRef.current = 'STOP';
    setCardCommand('STOP');

    setSubmode('MAP');
    submodeRef.current = 'MAP';

    mapRouteActiveRef.current = true;
    mapRouteIndexRef.current = 0;
    setMapRouteActive(true);
    setMapRouteIndex(0);

    targetRef.current = MAP_ROUTE[0];
    setTarget(MAP_ROUTE[0]);

    blockedTimerRef.current = 0;
    setBlocked(false);
  }, []);

  const switchToCards = useCallback(() => {
    stopAutopilot();
    setSubmode('CARDS');
    submodeRef.current = 'CARDS';

    cardCommandRef.current = 'STOP';
    setCardCommand('STOP');

    blockedTimerRef.current = 0;
    setBlocked(false);
  }, [stopAutopilot]);

  const switchToMap = useCallback(() => {
    stopAutopilot();
    setSubmode('MAP');
    submodeRef.current = 'MAP';

    cardCommandRef.current = 'STOP';
    setCardCommand('STOP');

    blockedTimerRef.current = 0;
    setBlocked(false);
  }, [stopAutopilot]);

  const hardStopCards = useCallback(() => {
    // stop manual + cancel go-to-goal target
    targetRef.current = null;
    setTarget(null);

    cardCommandRef.current = 'STOP';
    setCardCommand('STOP');

    blockedTimerRef.current = 0;
    setBlocked(false);
  }, []);

  const goToGoalKey = useCallback(() => {
    // G: in CARDS, symbol gives destination
    stopAutopilot();
    setSubmode('CARDS');
    submodeRef.current = 'CARDS';

    cardCommandRef.current = 'STOP';
    setCardCommand('STOP');

    targetRef.current = { ...GOAL };
    setTarget({ ...GOAL });

    blockedTimerRef.current = 0;
    setBlocked(false);
  }, [stopAutopilot]);

  // Keyboard: everything (so you don't need mouse clicks)
  useEffect(() => {
    const onDown = (e) => {
      // global shortcuts
      if (!e.repeat) {
        if (e.code === 'KeyR') { e.preventDefault(); resetAll(); return; }
        if (e.code === 'KeyM') { e.preventDefault(); switchToMap(); return; }
        if (e.code === 'KeyC') { e.preventDefault(); switchToCards(); return; }
        if (e.code === 'KeyP') { e.preventDefault(); startMapRoute(); return; }
        if (e.code === 'KeyG') { e.preventDefault(); goToGoalKey(); return; }
      }

      // stop (also cancels target in cards)
      if (e.code === 'Space') {
        e.preventDefault();
        if (submodeRef.current === 'CARDS') hardStopCards();
        return;
      }

      // movement keys only when in CARDS and no target autopilot
      if (submodeRef.current !== 'CARDS') return;
      if (targetRef.current) return;

      const cmd = KEY_TO_CMD[e.code];
      if (!cmd) return;

      e.preventDefault();
      cardCommandRef.current = cmd;
      setCardCommand(cmd);

      // manual input cancels "blocked"
      blockedTimerRef.current = 0;
      setBlocked(false);
    };

    const onUp = (e) => {
      if (submodeRef.current !== 'CARDS') return;
      if (targetRef.current) return;

      const cmd = KEY_TO_CMD[e.code];
      if (!cmd) return;

      e.preventDefault();
      // release => stop (simple and predictable)
      cardCommandRef.current = 'STOP';
      setCardCommand('STOP');
      blockedTimerRef.current = 0;
      setBlocked(false);
    };

    window.addEventListener('keydown', onDown, { passive: false });
    window.addEventListener('keyup', onUp, { passive: false });
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [resetAll, switchToMap, switchToCards, startMapRoute, goToGoalKey, hardStopCards]);

  useGameLoop((dt) => {
    const a = agentRef.current;

    // --- CARDS MODE ---
    if (submodeRef.current === 'CARDS') {
      // If target exists (G -> go to goal), autopilot toward it
      const t = targetRef.current;
      if (t) {
        const speed = 0.17 * dt;
        const dx = t.x - a.x;
        const dy = t.y - a.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 5) {
          const snapped = { x: t.x, y: t.y, theta: a.theta };
          agentRef.current = snapped;
          setAgent(snapped);

          targetRef.current = null;
          setTarget(null);
          return;
        }

        const ang = Math.atan2(dy, dx);
        let nx = clamp(a.x + Math.cos(ang) * speed, MARGIN, WORLD_W - MARGIN);
        let ny = clamp(a.y + Math.sin(ang) * speed, MARGIN, WORLD_H - MARGIN);

        if (hitsCentralWall(nx, ny)) {
          // stop at wall (you can still manually correct with WASD)
          const updated = { x: a.x, y: a.y, theta: ang };
          agentRef.current = updated;
          setAgent(updated);
          return;
        }

        const updated = { x: nx, y: ny, theta: ang };
        agentRef.current = updated;
        setAgent(updated);
        return;
      }

      // Manual card command (hold-to-move)
      const cmd = cardCommandRef.current;
      if (!cmd || cmd === 'STOP') return;

      const speed = 0.20 * dt;

      let vx = 0, vy = 0, theta = a.theta;
      if (cmd === 'N') { vx = 0; vy = -1; theta = -Math.PI / 2; }
      if (cmd === 'S') { vx = 0; vy = 1; theta = Math.PI / 2; }
      if (cmd === 'E') { vx = 1; vy = 0; theta = 0; }
      if (cmd === 'W') { vx = -1; vy = 0; theta = Math.PI; }

      let nx = a.x + vx * speed;
      let ny = a.y + vy * speed;

      const cx = clamp(nx, MARGIN, WORLD_W - MARGIN);
      const cy = clamp(ny, MARGIN, WORLD_H - MARGIN);

      let blockedNow = (cx !== nx) || (cy !== ny);
      nx = cx; ny = cy;

      if (!blockedNow && hitsCentralWall(nx, ny)) {
        blockedNow = true;
        nx = a.x; ny = a.y;
      }

      if (blockedNow) {
        blockedTimerRef.current += (dt / 1000); // dt is probably ms; normalize a bit
        if (blockedTimerRef.current > 0.25) {
          setBlocked(true);
          cardCommandRef.current = 'STOP';
          setCardCommand('STOP');
          blockedTimerRef.current = 0;
          return;
        }
      } else {
        blockedTimerRef.current = 0;
        if (blocked) setBlocked(false);
      }

      const updated = { x: nx, y: ny, theta };
      const changed =
        !nearlyEqual(updated.x, a.x) ||
        !nearlyEqual(updated.y, a.y) ||
        !nearlyEqual(updated.theta, a.theta, 0.0005);

      if (changed) {
        agentRef.current = updated;
        setAgent(updated);
      }
      return;
    }

    // --- MAP MODE ---
    const t = targetRef.current;
    if (!t) return;

    const speed = 0.15 * dt;
    const dx = t.x - a.x;
    const dy = t.y - a.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 5) {
      const snapped = { x: t.x, y: t.y, theta: a.theta };
      if (!nearlyEqual(snapped.x, a.x) || !nearlyEqual(snapped.y, a.y)) {
        agentRef.current = snapped;
        setAgent(snapped);
      }

      if (mapRouteActiveRef.current) {
        const idx = mapRouteIndexRef.current;
        const nextIdx = idx + 1;

        if (nextIdx < MAP_ROUTE.length) {
          mapRouteIndexRef.current = nextIdx;
          setMapRouteIndex(nextIdx);

          targetRef.current = MAP_ROUTE[nextIdx];
          setTarget(MAP_ROUTE[nextIdx]);
        } else {
          mapRouteActiveRef.current = false;
          setMapRouteActive(false);
          targetRef.current = null;
          setTarget(null);
        }
      } else {
        targetRef.current = null;
        setTarget(null);
      }
      return;
    }

    const ang = Math.atan2(dy, dx);
    let nx = clamp(a.x + Math.cos(ang) * speed, MARGIN, WORLD_W - MARGIN);
    let ny = clamp(a.y + Math.sin(ang) * speed, MARGIN, WORLD_H - MARGIN);

    if (hitsCentralWall(nx, ny)) {
      const updated = { x: a.x, y: a.y, theta: ang };
      agentRef.current = updated;
      setAgent(updated);
      return;
    }

    const updated = { x: nx, y: ny, theta: ang };
    const changed =
      !nearlyEqual(updated.x, a.x) ||
      !nearlyEqual(updated.y, a.y) ||
      !nearlyEqual(updated.theta, a.theta, 0.0005);

    if (changed) {
      agentRef.current = updated;
      setAgent(updated);
    }
  });

  return html`
    <div class="split-view" style="flex-direction: column;">
      <div class="canvas-container" style="display: flex; flex-direction: row;">
        <div style="flex: 2; position: relative; border-right: 1px solid #334155;">
          <svg viewBox="0 0 400 300" style="width: 100%; height: 100%; background: #020617;">
            <text x="10" y="20" fill="#94a3b8" font-size="10">PHYSICAL WORLD</text>

            <rect x="150" y="50" width="20" height="200" fill="#334155" />

            <!-- Goal -->
            <circle cx="${GOAL.x}" cy="${GOAL.y}" r="15" fill="none" stroke="#facc15" stroke-dasharray="2" opacity="0.25" />

            ${submode === 'MAP' && (mapRouteActive || target) && html`
              <polyline
                points="50,250 120,250 120,30 300,30 300,100"
                fill="none"
                stroke="#facc15"
                stroke-dasharray="4"
                opacity="0.45"
              />
            `}

            <!-- Agent -->
            <g transform="translate(${agent.x}, ${agent.y}) rotate(${agent.theta * 180 / Math.PI})">
              <circle cx="0" cy="0" r="8" fill="#38bdf8" />
              <line x1="0" y1="0" x2="8" y2="0" stroke="white" stroke-width="2" />
            </g>

            ${target && html`<circle cx="${target.x}" cy="${target.y}" r="6" fill="#facc15" opacity="0.9" />`}

            ${submode === 'CARDS' && blocked && html`
              <text x="200" y="25" text-anchor="middle" font-size="11" fill="#f87171">
                BLOCKED (auto-stop)
              </text>
            `}
          </svg>
        </div>

        <!-- Right panel is now informational only (no reliance on clicks) -->
        <div style="flex: 1; padding: 1rem; background: #1e293b; display: flex; flex-direction: column; justify-content: center;">
          <div style="margin-bottom: 0.6rem; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px;">
            ${submode === 'MAP' ? 'External Map' : 'Instruction Cards'}
          </div>

          ${submode === 'MAP' ? html`
            <div style="color:#cbd5e1; font-size: 13px; line-height: 1.5;">
              <div style="margin-bottom: 8px;"><strong>Keyboard</strong></div>
              <div><strong>P</strong> — read map (start route)</div>
              <div><strong>M</strong> — map mode</div>
              <div><strong>C</strong> — card mode</div>
              <div><strong>R</strong> — reset</div>
              <div style="margin-top: 10px; color:#94a3b8; font-size:12px;">
                (Mouse click may also work: click the map card area to “read”.)
              </div>
              <div
                onClick=${startMapRoute}
                style="margin-top: 14px; width: 140px; height: 95px; background:#cbd5e1; border: 4px solid white; border-radius: 6px;
                       display:flex; align-items:center; justify-content:center; color:#0f172a; font-weight:bold; font-size:11px;"
              >
                CLICK TO READ
              </div>
            </div>
          ` : html`
            <div style="color:#cbd5e1; font-size: 13px; line-height: 1.6;">
              <div style="margin-bottom: 8px;"><strong>Keyboard controls</strong></div>
              <div><strong>WASD / Arrows</strong> — hold to move</div>
              <div><strong>Space</strong> — stop (also cancels “Go to Goal”)</div>
              <div><strong>G</strong> — “Go to Goal” (symbol gives destination)</div>
              <div style="margin-top: 12px; color:#94a3b8; font-size:12px;">
                Current command: <strong style="color:white;">${cardCommand}</strong>
              </div>
            </div>
          `}
        </div>
      </div>

      <!-- Minimal mouse buttons (optional); keyboard does everything -->
      <div style="display:flex; gap:8px; justify-content:flex-end; padding: 8px 12px;">
        <button class="control-btn" onClick=${resetAll}>Reset (R)</button>
        <button class="control-btn ${submode === 'MAP' ? 'active' : ''}" onClick=${switchToMap}>Map (M)</button>
        <button class="control-btn ${submode === 'CARDS' ? 'active' : ''}" onClick=${switchToCards}>Cards (C)</button>
        <button class="control-btn" onClick=${startMapRoute}>Read Map (P)</button>
      </div>

      <div class="caption-area">
        <h3>Level 4: Spatial Symbols</h3>
        <ul>
          <li><strong>Map:</strong> a compact external symbol can encode a whole route at once (press <strong>P</strong>).</li>
          <li><strong>Cards:</strong> incremental external instructions (WASD/arrows), plus a symbolic “go to goal” command (<strong>G</strong>).</li>
          <li><strong>Communicable:</strong> these symbols can be transmitted between agents.</li>
        </ul>
      </div>
    </div>
  `;
}