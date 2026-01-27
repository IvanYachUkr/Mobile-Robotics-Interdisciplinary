import { h } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
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
    'center': { x: 200, y: 150, neighbors: ['n3', 'n6', 'n5'] }, // Central hub
    'n5': { x: 350, y: 50, neighbors: ['n3', 'goal_A'] },
    'n6': { x: 200, y: 250, neighbors: ['n4', 'center', 'goal_B'] },
    'goal_A': { x: 350, y: 150, neighbors: ['n5'] }, // goal_B removed neighbor to avoid graph looking weird with new pos, but we need A* to find it.
    // Update: 'goal_B' is now at bottom middle (200, 280), reachable from n6 (200, 250) or n4 (50, 250)? 
    // Let's connect goal_B to n6.
    'goal_B': { x: 200, y: 280, neighbors: ['n6'] }
};

// Update neighbors reverse connections
GRAPH_NODES['n5'].neighbors = ['n3', 'goal_A'];
GRAPH_NODES['n6'].neighbors = ['n4', 'center', 'goal_B'];

// Start Position
const START_POS = { x: 50, y: 50 };

export default function Level3() {
    const [agent, setAgent] = useState({ ...START_POS, theta: 0 });
    const [goalId, setGoalId] = useState('goal_A');
    const [mode, setMode] = useState('VECTOR'); // VECTOR, ROUTE, MAP
    const [plannedPath, setPlannedPath] = useState([]); // Array of Node IDs
    const [currentPathIndex, setCurrentPathIndex] = useState(0);

    // Goal Position helper
    const goalPos = GRAPH_NODES[goalId];

    // Obstacle (U-shape blocking direct vector)
    const obstacles = [
        { x: 100, y: 100, w: 20, h: 100 }, // Wall between start and center
    ];

    const recalculatePath = (targetId) => {
        if (mode === 'MAP') {
            // Find nearest node to agent? Simplified: always plan from 'start' or current node.
            // For demo: Agent moves from start.
            // If agent in motion, we might re-plan from nearest node.
            // Let's simplified: Reset agent to start on mode change or just re-plan from "start" node for visual clarity path.
            // Actually, "New Goal" relocates goal.
            // If mode is MAP, we re-run A*.
            const p = findPath(GRAPH_NODES, 'start', targetId);
            setPlannedPath(p || []);
            setCurrentPathIndex(0);
        } else if (mode === 'ROUTE') {
            // Fixed route irrespective of goal? 
            // "Agent replays a learned route ... inefficient if goal changes"
            // Learned route: Start -> n1 -> n3 -> goal_A.
            // If Goal is goal_B, Route is still Start->GoalA.
            setPlannedPath(['start', 'n1', 'n3', 'n5', 'goal_A']);
            setCurrentPathIndex(0);
        } else {
            setPlannedPath([]);
        }
    };

    // Effect: Recalculate when Goal or Mode changes
    useEffect(() => {
        recalculatePath(goalId);
    }, [goalId, mode]);

    const randomizeGoal = () => {
        setGoalId(prev => prev === 'goal_A' ? 'goal_B' : 'goal_A');
        // If mode is vector, we just change target. 
        // If mode is Route, we keep old path (that's the point).
        // If Map, path updates.
    };

    const resetAgent = () => {
        setAgent({ ...START_POS, theta: 0 });
        setCurrentPathIndex(0);
    };

    useGameLoop((dt) => {
        let speed = 0.1 * dt;
        let nextAgent = { ...agent };
        let targetX = nextAgent.x;
        let targetY = nextAgent.y;

        if (mode === 'VECTOR') {
            // Direct to goal
            targetX = goalPos.x;
            targetY = goalPos.y;

            // Move towards target
            const angle = Math.atan2(targetY - agent.y, targetX - agent.x);
            nextAgent.x += Math.cos(angle) * speed;
            nextAgent.y += Math.sin(angle) * speed;

            // Simple Collision
            for (let obs of obstacles) {
                if (nextAgent.x > obs.x && nextAgent.x < obs.x + obs.w &&
                    nextAgent.y > obs.y && nextAgent.y < obs.y + obs.h) {
                    // Hit wall, stop
                    nextAgent.x = agent.x; // Revert
                    nextAgent.y = agent.y;
                    // Slightly bounce back or just stop -> stop is fine.
                }
            }
        }
        else if ((mode === 'ROUTE' || mode === 'MAP') && plannedPath.length > 0) {
            // Follow path nodes
            const targetNodeId = plannedPath[currentPathIndex];
            if (targetNodeId) {
                const targetNode = GRAPH_NODES[targetNodeId];
                const dist = Math.hypot(targetNode.x - agent.x, targetNode.y - agent.y);

                if (dist < 5) {
                    // Reached node
                    if (currentPathIndex < plannedPath.length - 1) {
                        setCurrentPathIndex(currentPathIndex + 1);
                    }
                } else {
                    // Move to node
                    const angle = Math.atan2(targetNode.y - agent.y, targetNode.x - agent.x);
                    nextAgent.x += Math.cos(angle) * speed;
                    nextAgent.y += Math.sin(angle) * speed;
                }
            }
        }

        // Update Angle for display
        const moveAngle = Math.atan2(nextAgent.y - agent.y, nextAgent.x - agent.x);
        if (Math.hypot(nextAgent.x - agent.x, nextAgent.y - agent.y) > 0.1) {
            nextAgent.theta = moveAngle;
        }

        setAgent(nextAgent);
    });

    return html`
        <div class="split-view" style="flex-direction: column;">
            <div class="canvas-container">
                <svg viewBox="0 0 400 300" style="width: 100%; height: 100%;">
                    
                    <!-- Graph Edges (Only visible in MAP mode?) Prompt says "Map/Graph mode: use predefined graph". 
                         Usually useful to show them faintly always or just in map mode. 
                         Let's show them faintly always to visualize the "Construct".
                    -->
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
                        <polygon points="-8,-8 10,0 -8,8" fill="#38bdf8" />
                    </g>

                </svg>

                <div class="controls">
                    <button class="control-btn" onClick=${resetAgent}>Reset Agent</button>
                    ${['VECTOR', 'ROUTE', 'MAP'].map(m => html`
                        <button 
                            class="control-btn ${mode === m ? 'active' : ''}" 
                            onClick=${() => setMode(m)}
                        >
                            ${m}
                        </button>
                    `)}
                    <div style="width:1px; background:#334155; margin:0 5px;"></div>
                    <button class="control-btn" onClick=${randomizeGoal} style="border-color: #a855f7; color: #a855f7;">Move Goal</button>
                </div>
            </div>

            <div class="caption-area">
                <h3>Level 3: Spatial Constructs</h3>
                <ul>
                    <li><strong>Map Representaton:</strong> Uses a graph (nodes/edges) to represent connectivity, enabling flexibility.</li>
                    <li><strong>Flexible Planning:</strong> In "Map" mode, changing the goal (Purple) re-routes the agent efficiently (Yellow path).</li>
                    <li><strong>Rigid Route:</strong> In "Route" mode, the agent blindly memorizes a sequence. Moves to old goal location even if goal moves.</li>
                    <li><strong>Vector Limitation:</strong> "Vector" mode fails against obstacles (Red Wall) without a map.</li>
                    <li><strong>Robotics Parallel:</strong> SLAM, Topological Maps, A* Planning.</li>
                </ul>
            </div>
        </div>
    `;
}
