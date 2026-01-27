import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import htm from 'htm';
import { useGameLoop } from '../../hooks/useGameLoop.js';

const html = htm.bind(h);

export default function Level1() {
    const sunAngleDisplayRef = useRef(0);
    const [robotPos, setRobotPos] = useState({ x: 100, y: 150, theta: 0 });

    // Shared state for visualization only (refs used for smoothness/perf if needed, but state is fine for simple low count)
    // We use a ref for the sun loop to avoid full re-renders just for the sun pos if possible, 
    // but React is fast enough. Let's use state for simplicity of logic.
    const [sunX, setSunX] = useState(50);
    const [energy, setEnergy] = useState(0);

    useGameLoop((dt) => {
        // 1. Move Sun
        // Sun moves from left (20) to right (380) then resets
        let newSunX = sunX + 0.1 * dt;
        if (newSunX > 380) newSunX = 20;
        setSunX(newSunX);

        // Sun Position (Fixed Y for top)
        const sunPos = { x: newSunX, y: 50 };

        // 2. Scene A: Sunflower (Centers on Sun)
        // Calculated in render

        // 3. Scene B: Solar Panel (Aligns + Energy)
        // Calculated in render, Energy varies
        // Panel is at x=150, y=150
        const panelPos = { x: 133, y: 150 };
        const angleToSun = Math.atan2(sunPos.y - panelPos.y, sunPos.x - panelPos.x);
        // optimal angle is pointing towards sun.
        // Let's say panel angle is trying to match angleToSun. 
        // Simple P-controller or instant for "Sensorimotor" (direct connection)
        // Level 1 implies rigid connection usually. Let's make it instant or slightly lagged.
        // Let's calculate alignment for energy:
        // alignment = cos(error). If perfect, 1.
        // We render it pointing at sun.
        setEnergy(Math.max(0, Math.sin(newSunX / 400 * Math.PI))); // Fake energy curve based on sun height/pos

        // 4. Scene C: Braitenberg Vehicle (Light seeking)
        // Robot at robotPos.
        // Sensors L and R.
        // Vehicle 2a (Fear) or 2b (Aggression/Love)? "Light seeking" -> Aggression (2b: crossed connections)
        // Closer sensor drives opposite wheel faster -> turns towards source.

        // Simulating naive light seeking:
        const rPos = robotPos;
        const speed = 0.05 * dt;

        // Simple steering logic: Look at sun.
        const targetAngle = Math.atan2(sunPos.y - rPos.y, sunPos.x - rPos.x);
        let angleDiff = targetAngle - rPos.theta;

        // Normalize angle
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // Turn
        const turnRate = 0.005 * dt;
        let newTheta = rPos.theta + Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnRate);

        // Move forward if roughly facing
        const moveSpeed = (1 - Math.abs(angleDiff) / Math.PI) * speed * 0.5; // slow down when turning

        const newRx = rPos.x + Math.cos(newTheta) * moveSpeed;
        const newRy = rPos.y + Math.sin(newTheta) * moveSpeed;

        // Clamp robot boundaries (Scene C is rightmost third, approx 266-400)
        // Normalized scenes: A(0-133), B(133-266), C(266-400)
        // Actually lets split 0-400 width.
        // Scene A center: 66, Scene B center: 200, Scene C center: 333
        // Robot constrained to box around 333

        let clampedX = Math.max(280, Math.min(380, newRx));
        let clampedY = Math.max(120, Math.min(230, newRy));

        // Reset if sun resets or robot stuck
        if (newSunX < 25) {
            // Reset robot roughly
            clampedX = 333;
            clampedY = 180;
            newTheta = -Math.PI / 2;
        }

        setRobotPos({ x: clampedX, y: clampedY, theta: newTheta });
    });

    // Helper calculate rotation for Scene A & B
    const sunPos = { x: sunX, y: 40 };

    // ScA: Sunflower at 66, 150
    const flowerPos = { x: 66, y: 150 };
    const flowerAngle = Math.atan2(sunPos.y - flowerPos.y, sunPos.x - flowerPos.x);

    // ScB: Panel at 200, 150
    const panelPos = { x: 200, y: 150 };
    const panelAngle = Math.atan2(sunPos.y - panelPos.y, sunPos.x - panelPos.x);
    // Energy metric: based on angle alignment (which is perfect here) and distance/angle overhead
    // Let's make energy max when sun is directly overhead (x=200)
    const dist = Math.sqrt(Math.pow(sunPos.x - 200, 2) + Math.pow(sunPos.y - 150, 2));
    const energyLevel = Math.max(0, 100 - (Math.abs(sunPos.x - 200) * 0.5));

    return html`
        <div class="split-view" style="flex-direction: column;">
            <div class="canvas-container">
                <svg viewBox="0 0 400 250" style="width: 100%; height: 100%;">
                    <!-- Background separators -->
                    <line x1="133" y1="0" x2="133" y2="250" stroke="#334155" stroke-dasharray="4" />
                    <line x1="266" y1="0" x2="266" y2="250" stroke="#334155" stroke-dasharray="4" />
                    
                    <!-- Labels -->
                    <text x="66" y="240" fill="#94a3b8" font-size="10" text-anchor="middle">Scene A: Tropism</text>
                    <text x="200" y="240" fill="#94a3b8" font-size="10" text-anchor="middle">Scene B: Tracker</text>
                    <text x="333" y="240" fill="#94a3b8" font-size="10" text-anchor="middle">Scene C: Taxis</text>

                    <!-- Sun -->
                    <circle cx=${sunX} cy="40" r="15" fill="#fbbf24" stroke="#f59e0b" stroke-width="2">
                        <animate attributeName="r" values="15;16;15" dur="2s" repeatCount="indefinite" />
                    </circle>

                    <!-- Scene A: Sunflower -->
                    <g transform="translate(66, 150) rotate(${flowerAngle * 180 / Math.PI + 90})">
                        <!-- Stem -->
                        <line x1="0" y1="0" x2="0" y2="50" stroke="#1da80d" stroke-width="4" transform="rotate(-90)" /> 
                        <!-- Head -->
                        <circle cx="0" cy="0" r="12" fill="#8b5cf6" />
                        <rect x="-2" y="-18" width="4" height="10" fill="#8b5cf6" />
                    </g>
                    
                    <!-- Scene B: Solar Panel -->
                    <g transform="translate(200, 150)">
                         <!-- Base -->
                        <rect x="-5" y="20" width="10" height="30" fill="#475569" />
                        <!-- Panel Pivot -->
                        <g transform="rotate(${panelAngle * 180 / Math.PI + 90})">
                             <rect x="-20" y="-5" width="40" height="10" fill="#38bdf8" stroke="white" stroke-width="1" />
                        </g>
                        <!-- Meter -->
                        <rect x="-20" y="60" width="40" height="6" fill="#1e293b" />
                        <rect x="-20" y="60" width=${energyLevel * 0.4} height="6" fill="#4ade80" />
                        <text x="0" y="80" fill="white" font-size="8" text-anchor="middle">${Math.round(energyLevel)}%</text>
                    </g>

                    <!-- Scene C: Robot -->
                    <g transform="translate(${robotPos.x}, ${robotPos.y}) rotate(${robotPos.theta * 180 / Math.PI})">
                        <polygon points="-10,-10 10,0 -10,10" fill="#f87171" />
                        <circle cx="5" cy="-5" r="2" fill="yellow" />
                        <circle cx="5" cy="5" r="2" fill="yellow" />
                    </g>

                </svg>
            </div>
            <div class="caption-area">
                <h3>Level 1: Sensorimotor</h3>
                <ul>
                    <li><strong>Hardware-level connection:</strong> Sensor inputs directly drive motor outputs.</li>
                    <li><strong>No Representation:</strong> The agent has no memory, no map, and no concept of "space".</li>
                    <li><strong>Examples:</strong> Sunflower tracking sun (Tropism), Solar panels (Tracking), Braitenberg vehicles (Taxis).</li>
                    <li><strong>Robotics Parallel:</strong> Reactive collision avoidance, line following.</li>
                </ul>
            </div>
        </div>
    `;
}
