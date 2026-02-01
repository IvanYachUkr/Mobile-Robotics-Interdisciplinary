import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { useGameLoop } from '../../hooks/useGameLoop.js';
import { findPath } from '../../utils/astar.js';

const html = htm.bind(h);

// Define Graph Nodes
const GRAPH_NODES = {
    'start': { x: 50, y: 50, neighbors: ['n1', 'n2'] },
    'n1': { x: 150, y: 50, neighbors: ['start', 'n3'] },
    'n2': { x: 50, y: 150, neighbors: ['start', 'n4'] },
    'n3': { x: 250, y: 50, neighbors: ['n1', 'n5', 'center'] },
    'n4': { x: 50, y: 250, neighbors: ['n2', 'n6'] },
    'center': { x: 200, y: 150, neighbors: ['n3', 'n6', 'n5'] },
    'n5': { x: 350, y: 50, neighbors: ['n3', 'goal_A'] },
    'n6': { x: 200, y: 250, neighbors: ['n4', 'center', 'goal_B'] },
    'goal_A': { x: 350, y: 150, neighbors: ['n5'] },
    'goal_B': { x: 200, y: 280, neighbors: ['n6'] }
};

// Update neighbors reverse connections
GRAPH_NODES['n5'].neighbors = ['n3', 'goal_A'];
GRAPH_NODES['n6'].neighbors = ['n4', 'center', 'goal_B'];

// Start Position
const START_POS = { x: 50, y: 50 };

// Demo phases configuration
const DEMO_PHASES = {
    IDLE: 'IDLE',
    // Phase 1: Vector to goal_A, then return to start
    VECTOR_TO_GOAL: 'VECTOR_TO_GOAL',
    VECTOR_RETURN_TO_START: 'VECTOR_RETURN_TO_START',
    // Phase 2: Goal moves, vector gets stuck
    VECTOR_GOAL_MOVING: 'VECTOR_GOAL_MOVING',
    VECTOR_TO_NEW_GOAL: 'VECTOR_TO_NEW_GOAL',
    VECTOR_STUCK_WAIT: 'VECTOR_STUCK_WAIT',
    // Phase 3: Route demonstration
    RESET_FOR_ROUTE: 'RESET_FOR_ROUTE',
    ROUTE_TO_GOAL: 'ROUTE_TO_GOAL',
    GOAL_MOVED_ROUTE: 'GOAL_MOVED_ROUTE',
    ROUTE_WRONG_GOAL: 'ROUTE_WRONG_GOAL',
    ROUTE_WRONG_WAIT: 'ROUTE_WRONG_WAIT',
    // Phase 4: Map demonstration
    RESET_FOR_MAP: 'RESET_FOR_MAP',
    MAP_TO_GOAL_A: 'MAP_TO_GOAL_A',
    GOAL_MOVED_MAP: 'GOAL_MOVED_MAP',
    MAP_TO_GOAL_B: 'MAP_TO_GOAL_B',
    DEMO_COMPLETE: 'DEMO_COMPLETE'
};

// Messages for each phase
const PHASE_MESSAGES = {
    [DEMO_PHASES.IDLE]: 'Click "Start Demo" to begin the automated demonstration',
    [DEMO_PHASES.VECTOR_TO_GOAL]: '🎯 VECTOR MODE: Moving directly toward the goal...',
    [DEMO_PHASES.VECTOR_RETURN_TO_START]: '🎯 VECTOR MODE: Goal reached! Returning to start...',
    [DEMO_PHASES.VECTOR_GOAL_MOVING]: '⚠️ Goal is moving to a new position...',
    [DEMO_PHASES.VECTOR_TO_NEW_GOAL]: '🎯 VECTOR MODE: Trying to reach the new goal directly...',
    [DEMO_PHASES.VECTOR_STUCK_WAIT]: '❌ STUCK! Vector mode cannot navigate around obstacles!',
    [DEMO_PHASES.RESET_FOR_ROUTE]: '🔄 Resetting for Route demonstration...',
    [DEMO_PHASES.ROUTE_TO_GOAL]: '📍 ROUTE MODE: Following a memorized sequence of waypoints...',
    [DEMO_PHASES.GOAL_MOVED_ROUTE]: '⚠️ Goal moved to a new position!',
    [DEMO_PHASES.ROUTE_WRONG_GOAL]: '📍 ROUTE MODE: Still following memorized route... going to OLD goal position!',
    [DEMO_PHASES.ROUTE_WRONG_WAIT]: '❌ Route mode went to the wrong place! It cannot adapt to goal changes.',
    [DEMO_PHASES.RESET_FOR_MAP]: '🔄 Resetting for Map demonstration...',
    [DEMO_PHASES.MAP_TO_GOAL_A]: '🗺️ MAP MODE: Using A* pathfinding to reach the goal...',
    [DEMO_PHASES.GOAL_MOVED_MAP]: '⚠️ Goal moved! Map mode recalculates the path...',
    [DEMO_PHASES.MAP_TO_GOAL_B]: '✅ MAP MODE: With a map, we know where the goal is and can plan a new route!',
    [DEMO_PHASES.DEMO_COMPLETE]: '🎉 Demo complete! Map mode adapts to changes. Click "Start Demo" to replay.'
};

export default function Level3() {
    const [agent, setAgent] = useState({ ...START_POS, theta: 0 });
    const [goalId, setGoalId] = useState('goal_A');
    const [mode, setMode] = useState('VECTOR');
    const [plannedPath, setPlannedPath] = useState([]);
    const [currentPathIndex, setCurrentPathIndex] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const [demoPhase, setDemoPhase] = useState(DEMO_PHASES.IDLE);
    const [isStuck, setIsStuck] = useState(false);

    // 'goal' | 'start' | 'hold'
    const [vectorTarget, setVectorTarget] = useState('goal');

    const stuckTimerRef = useRef(null);
    const phaseTimerRef = useRef(null);

    const goalPos = GRAPH_NODES[goalId];

    const obstacles = [
        { x: 100, y: 100, w: 20, h: 100 },
    ];

    // Clear timers
    const clearTimers = () => {
        if (stuckTimerRef.current) {
            clearTimeout(stuckTimerRef.current);
            stuckTimerRef.current = null;
        }
        if (phaseTimerRef.current) {
            clearTimeout(phaseTimerRef.current);
            phaseTimerRef.current = null;
        }
    };

    // Calculate path for MAP/ROUTE mode (only when NOT running demo)
    const recalculatePath = (targetId, forceMode = null) => {
        const currentMode = forceMode || mode;
        if (currentMode === 'MAP') {
            const p = findPath(GRAPH_NODES, 'start', targetId);
            setPlannedPath(p || []);
            setCurrentPathIndex(0);
        } else if (currentMode === 'ROUTE') {
            setPlannedPath(['start', 'n1', 'n3', 'n5', 'goal_A']);
            setCurrentPathIndex(0);
        } else {
            setPlannedPath([]);
        }
    };

    useEffect(() => {
        if (isRunning) return;
        recalculatePath(goalId);
    }, [goalId, mode]);

    // Reset agent to start
    const resetAgent = () => {
        setAgent({ ...START_POS, theta: 0 });
        setCurrentPathIndex(0);
        setIsStuck(false);
    };

    // Check if agent reached goal
    const hasReachedGoal = (targetId) => {
        const target = GRAPH_NODES[targetId];
        return Math.hypot(target.x - agent.x, target.y - agent.y) < 10;
    };

    // Check if agent at start
    const hasReachedStart = () => {
        return Math.hypot(START_POS.x - agent.x, START_POS.y - agent.y) < 10;
    };

    // Check if agent reached end of path
    const hasReachedPathEnd = () => {
        if (plannedPath.length === 0) return false;
        const lastNode = GRAPH_NODES[plannedPath[plannedPath.length - 1]];
        return Math.hypot(lastNode.x - agent.x, lastNode.y - agent.y) < 10;
    };

    // Start demo
    const startDemo = () => {
        clearTimers();
        resetAgent();
        setGoalId('goal_A');
        setMode('VECTOR');
        setVectorTarget('goal');
        setDemoPhase(DEMO_PHASES.VECTOR_TO_GOAL);
        setIsRunning(true);
        setIsStuck(false);
    };

    // Stop demo
    const stopDemo = () => {
        clearTimers();
        setIsRunning(false);
        setDemoPhase(DEMO_PHASES.IDLE);
        resetAgent();
        setGoalId('goal_A');
        setMode('VECTOR');
        setVectorTarget('goal');
    };

    // Cleanup timers on unmount
    useEffect(() => {
        return () => clearTimers();
    }, []);

    // Which phases are allowed to actually move the agent
    const movementEnabled = useMemo(() => {
        if (!isRunning) return false;
        return (
            demoPhase === DEMO_PHASES.VECTOR_TO_GOAL ||
            demoPhase === DEMO_PHASES.VECTOR_RETURN_TO_START ||
            demoPhase === DEMO_PHASES.VECTOR_TO_NEW_GOAL ||
            demoPhase === DEMO_PHASES.ROUTE_TO_GOAL ||
            demoPhase === DEMO_PHASES.ROUTE_WRONG_GOAL ||
            demoPhase === DEMO_PHASES.MAP_TO_GOAL_A ||
            demoPhase === DEMO_PHASES.MAP_TO_GOAL_B
        );
    }, [isRunning, demoPhase]);

    /**
     * Phase entry logic (setup + timers)
     * Runs only when demoPhase changes (not every frame).
     */
    useEffect(() => {
        if (!isRunning) return;

        // Clear any phase-scoped timers when entering a new phase
        clearTimers();

        switch (demoPhase) {
            // VECTOR: normal movement to goal_A
            case DEMO_PHASES.VECTOR_TO_GOAL: {
                setMode('VECTOR');
                setGoalId('goal_A');
                setIsStuck(false);
                setVectorTarget('goal');
                break;
            }

            // VECTOR: pause at goal, then return to start
            case DEMO_PHASES.VECTOR_RETURN_TO_START: {
                // Pause on arrival so it doesn't look rushed
                setVectorTarget('hold');
                phaseTimerRef.current = setTimeout(() => {
                    setVectorTarget('start');
                    phaseTimerRef.current = null;
                }, 700);
                break;
            }

            // VECTOR: goal moves while agent stays still at start
            case DEMO_PHASES.VECTOR_GOAL_MOVING: {
                setVectorTarget('hold');      // freeze agent (prevents weird reroute)
                setIsStuck(false);
                setGoalId('goal_B');          // move goal immediately (no “late” feel)
                phaseTimerRef.current = setTimeout(() => {
                    setVectorTarget('goal');
                    setDemoPhase(DEMO_PHASES.VECTOR_TO_NEW_GOAL);
                    phaseTimerRef.current = null;
                }, 1200);
                break;
            }

            // VECTOR: attempt to reach new goal, then declare stuck after a bit
            case DEMO_PHASES.VECTOR_TO_NEW_GOAL: {
                setMode('VECTOR');
                setIsStuck(false);
                setVectorTarget('goal');
                stuckTimerRef.current = setTimeout(() => {
                    setIsStuck(true);
                    setVectorTarget('hold'); // freeze so it doesn't jitter at the obstacle
                    setDemoPhase(DEMO_PHASES.VECTOR_STUCK_WAIT);
                    stuckTimerRef.current = null;
                }, 2000);
                break;
            }

            // VECTOR: show stuck, then transition
            case DEMO_PHASES.VECTOR_STUCK_WAIT: {
                setVectorTarget('hold');
                phaseTimerRef.current = setTimeout(() => {
                    setDemoPhase(DEMO_PHASES.RESET_FOR_ROUTE);
                    phaseTimerRef.current = null;
                }, 3000);
                break;
            }

            // ROUTE: reset everything, then start moving (movement disabled during reset phase)
            case DEMO_PHASES.RESET_FOR_ROUTE: {
                setAgent({ ...START_POS, theta: 0 });
                setGoalId('goal_A');
                setMode('ROUTE');
                setIsStuck(false);
                setPlannedPath(['start', 'n1', 'n3', 'n5', 'goal_A']);
                setCurrentPathIndex(0);

                phaseTimerRef.current = setTimeout(() => {
                    setDemoPhase(DEMO_PHASES.ROUTE_TO_GOAL);
                    phaseTimerRef.current = null;
                }, 1200);
                break;
            }

            // ROUTE: goal moved, reset agent, then run same memorized route to old goal
            case DEMO_PHASES.GOAL_MOVED_ROUTE: {
                setGoalId('goal_B');
                setAgent({ ...START_POS, theta: 0 });
                setCurrentPathIndex(0);

                phaseTimerRef.current = setTimeout(() => {
                    setDemoPhase(DEMO_PHASES.ROUTE_WRONG_GOAL);
                    phaseTimerRef.current = null;
                }, 1200);
                break;
            }

            case DEMO_PHASES.ROUTE_WRONG_WAIT: {
                phaseTimerRef.current = setTimeout(() => {
                    setDemoPhase(DEMO_PHASES.RESET_FOR_MAP);
                    phaseTimerRef.current = null;
                }, 2500);
                break;
            }

            // MAP: reset, plan to A, then start moving
            case DEMO_PHASES.RESET_FOR_MAP: {
                setAgent({ ...START_POS, theta: 0 });
                setGoalId('goal_A');
                setMode('MAP');
                setIsStuck(false);

                const pathToA = findPath(GRAPH_NODES, 'start', 'goal_A');
                setPlannedPath(pathToA || []);
                setCurrentPathIndex(0);

                phaseTimerRef.current = setTimeout(() => {
                    setDemoPhase(DEMO_PHASES.MAP_TO_GOAL_A);
                    phaseTimerRef.current = null;
                }, 1200);
                break;
            }

            // MAP: goal moved, replan to B, then start moving
            case DEMO_PHASES.GOAL_MOVED_MAP: {
                setGoalId('goal_B');
                setAgent({ ...START_POS, theta: 0 });

                const pathToB = findPath(GRAPH_NODES, 'start', 'goal_B');
                setPlannedPath(pathToB || []);
                setCurrentPathIndex(0);

                phaseTimerRef.current = setTimeout(() => {
                    setDemoPhase(DEMO_PHASES.MAP_TO_GOAL_B);
                    phaseTimerRef.current = null;
                }, 1200);
                break;
            }

            default:
                break;
        }

        // On leaving the phase, nuke any timers that belong to it
        return () => clearTimers();
    }, [demoPhase, isRunning]);

    /**
     * Phase transitions based on movement conditions
     * (Only checks movement phases, avoids doing setup here.)
     */
    useEffect(() => {
        if (!isRunning) return;

        switch (demoPhase) {
            case DEMO_PHASES.VECTOR_TO_GOAL: {
                if (hasReachedGoal('goal_A')) {
                    setDemoPhase(DEMO_PHASES.VECTOR_RETURN_TO_START);
                }
                break;
            }

            case DEMO_PHASES.VECTOR_RETURN_TO_START: {
                // Only advance once we are actually returning (after the arrival pause)
                if (vectorTarget === 'start' && hasReachedStart()) {
                    setDemoPhase(DEMO_PHASES.VECTOR_GOAL_MOVING);
                }
                break;
            }

            case DEMO_PHASES.ROUTE_TO_GOAL: {
                if (hasReachedPathEnd()) {
                    setDemoPhase(DEMO_PHASES.GOAL_MOVED_ROUTE);
                }
                break;
            }

            case DEMO_PHASES.ROUTE_WRONG_GOAL: {
                if (hasReachedPathEnd()) {
                    setDemoPhase(DEMO_PHASES.ROUTE_WRONG_WAIT);
                }
                break;
            }

            case DEMO_PHASES.MAP_TO_GOAL_A: {
                if (hasReachedGoal('goal_A')) {
                    setDemoPhase(DEMO_PHASES.GOAL_MOVED_MAP);
                }
                break;
            }

            case DEMO_PHASES.MAP_TO_GOAL_B: {
                if (hasReachedGoal('goal_B')) {
                    setDemoPhase(DEMO_PHASES.DEMO_COMPLETE);
                    setIsRunning(false);
                }
                break;
            }

            default:
                break;
        }
    }, [demoPhase, isRunning, agent.x, agent.y, plannedPath, vectorTarget]);

    useGameLoop((dt) => {
        if (!movementEnabled) return;

        let speed = 0.15 * dt;
        let nextAgent = { ...agent };

        if (mode === 'VECTOR') {
            if (vectorTarget === 'hold') return; // true pause, no jitter, no extra renders

            let targetX, targetY;
            if (vectorTarget === 'start') {
                targetX = START_POS.x;
                targetY = START_POS.y;
            } else {
                targetX = goalPos.x;
                targetY = goalPos.y;
            }

            const angle = Math.atan2(targetY - agent.y, targetX - agent.x);
            nextAgent.x += Math.cos(angle) * speed;
            nextAgent.y += Math.sin(angle) * speed;

            // Collision detection (only when going to goal, not returning)
            if (vectorTarget !== 'start') {
                for (let obs of obstacles) {
                    if (
                        nextAgent.x > obs.x && nextAgent.x < obs.x + obs.w &&
                        nextAgent.y > obs.y && nextAgent.y < obs.y + obs.h
                    ) {
                        nextAgent.x = agent.x;
                        nextAgent.y = agent.y;
                    }
                }
            }
        } else if ((mode === 'ROUTE' || mode === 'MAP') && plannedPath.length > 0) {
            const targetNodeId = plannedPath[currentPathIndex];
            if (targetNodeId) {
                const targetNode = GRAPH_NODES[targetNodeId];
                const dist = Math.hypot(targetNode.x - agent.x, targetNode.y - agent.y);

                if (dist < 5) {
                    if (currentPathIndex < plannedPath.length - 1) {
                        setCurrentPathIndex(i => Math.min(i + 1, plannedPath.length - 1));
                    }
                } else {
                    const angle = Math.atan2(targetNode.y - agent.y, targetNode.x - agent.x);
                    nextAgent.x += Math.cos(angle) * speed;
                    nextAgent.y += Math.sin(angle) * speed;
                }
            }
        }

        // Update angle for display
        const dx = nextAgent.x - agent.x;
        const dy = nextAgent.y - agent.y;
        const moved = Math.hypot(dx, dy) > 0.1;

        if (moved) {
            nextAgent.theta = Math.atan2(dy, dx);
        }

        // Avoid pointless rerenders when nothing changed
        const changed =
            Math.abs(nextAgent.x - agent.x) > 1e-6 ||
            Math.abs(nextAgent.y - agent.y) > 1e-6 ||
            Math.abs((nextAgent.theta ?? 0) - (agent.theta ?? 0)) > 1e-6;

        if (changed) setAgent(nextAgent);
    });

    const currentMessage = PHASE_MESSAGES[demoPhase];

    return html`
        <div class="split-view" style="flex-direction: column;">
            <div class="canvas-container">
                <svg viewBox="0 0 400 300" style="width: 100%; height: 100%;">
                    
                    <!-- Graph Edges -->
                    ${Object.keys(GRAPH_NODES).map(id => {
        const n = GRAPH_NODES[id];
        return n.neighbors.map(nid => {
            const n2 = GRAPH_NODES[nid];
            return html`<line x1=${n.x} y1=${n.y} x2=${n2.x} y2=${n2.y} stroke="#334155" stroke-width="1" opacity="0.5" />`;
        });
    })}

                    <!-- Highlight Planned Path -->
                    ${plannedPath.length > 1 && html`
                        <polyline points=${plannedPath.map(id => `${GRAPH_NODES[id].x},${GRAPH_NODES[id].y}`).join(' ')} 
                                  fill="none" stroke="#facc15" stroke-width="3" opacity="0.7" />
                    `}

                    <!-- Nodes -->
                    ${Object.keys(GRAPH_NODES).filter(id => !id.startsWith('goal')).map(id => {
        const n = GRAPH_NODES[id];
        return html`<circle cx=${n.x} cy=${n.y} r="3" fill="#64748b" />`;
    })}

                    <!-- Obstacles -->
                    ${obstacles.map(o => html`
                        <rect x=${o.x} y=${o.y} width=${o.w} height=${o.h} fill="#f87171" opacity="0.5" />
                        <text x=${o.x + 10} y=${o.y + 50} font-size="8" fill="white" transform="rotate(-90, ${o.x + 10}, ${o.y + 50})" text-anchor="middle">OBSTACLE</text>
                    `)}

                    <!-- Start & Goal -->
                    <circle cx=${START_POS.x} cy=${START_POS.y} r="5" fill="#4ade80" />
                    <text x=${START_POS.x} y=${START_POS.y - 10} fill="white" font-size="10" text-anchor="middle">Start</text>

                    <circle cx=${goalPos.x} cy=${goalPos.y} r="8" fill="#a855f7" />
                    <circle cx=${goalPos.x} cy=${goalPos.y} r="12" fill="none" stroke=${goalId === 'goal_A' ? '#a855f7' : '#f0abfc'} stroke-dasharray="2" >
                        <animate attributeName="r" values="8;12;8" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                    <text x=${goalPos.x} y=${goalPos.y - 15} fill="#a855f7" font-size="12" font-weight="bold" text-anchor="middle">GOAL</text>

                    <!-- Agent -->
                    <g transform="translate(${agent.x}, ${agent.y}) rotate(${agent.theta * 180 / Math.PI})">
                        <polygon points="-8,-8 10,0 -8,8" fill=${isStuck ? '#f87171' : '#38bdf8'} />
                    </g>

                    <!-- Status Message Box -->
                    <rect x="5" y="260" width="390" height="35" rx="5" fill="rgba(15, 23, 42, 0.9)" stroke="#334155" />
                    <text x="200" y="282" fill="white" font-size="11" text-anchor="middle" font-family="system-ui, sans-serif">
                        ${currentMessage}
                    </text>

                    <!-- Mode Indicator -->
                    <rect x="320" y="5" width="75" height="22" rx="3" fill=${mode === 'VECTOR' ? '#3b82f6' : mode === 'ROUTE' ? '#f59e0b' : '#10b981'} />
                    <text x="357" y="20" fill="white" font-size="10" text-anchor="middle" font-weight="bold">${mode}</text>

                </svg>

                <div class="controls">
                    <button class="control-btn" onClick=${isRunning ? stopDemo : startDemo} 
                            style="border-color: ${isRunning ? '#f87171' : '#4ade80'}; color: ${isRunning ? '#f87171' : '#4ade80'};">
                        ${isRunning ? 'Stop Demo' : 'Start Demo'}
                    </button>
                    <button class="control-btn" onClick=${stopDemo}>Reset</button>
                </div>
            </div>

            <div class="caption-area">
                <h3>Level 3: Spatial Constructs - Automated Demo</h3>
                <ul>
                    <li><strong>Vector Mode:</strong> Direct movement fails against obstacles.</li>
                    <li><strong>Route Mode:</strong> Memorized paths cannot adapt when goals move.</li>
                    <li><strong>Map Mode:</strong> Graph-based planning enables flexible navigation!</li>
                </ul>
            </div>
        </div>
    `;
}
