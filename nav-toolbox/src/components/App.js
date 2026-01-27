import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

import Header from './Layout/Header.js';
import Tabs from './Layout/Tabs.js';

// Import Tab Views (Placeholders for now)
import Level1 from './TabViews/Level1.js';
import Level2 from './TabViews/Level2.js';
import Level3 from './TabViews/Level3.js';
import Level4 from './TabViews/Level4.js';
import Bidirectionality from './TabViews/Bidirectionality.js';
import Limitations from './TabViews/Limitations.js';

const html = htm.bind(h);

export default function App() {
    const [activeTab, setActiveTab] = useState(0);

    const tabs = [
        { id: 0, label: '1. Sensorimotor', Component: Level1 },
        { id: 1, label: '2. Spatial Primitives', Component: Level2 },
        { id: 2, label: '3. Spatial Constructs', Component: Level3 },
        { id: 3, label: '4. Spatial Symbols', Component: Level4 },
        { id: 4, label: '5. Bidirectionality', Component: Bidirectionality },
        { id: 5, label: '6. Limitation & Robotics', Component: Limitations },
    ];

    const ActiveComponent = tabs[activeTab].Component;

    // Persist tab selection if desired, or simplified

    return html`
        <${Header} />
        <${Tabs} tabs=${tabs} activeTab=${activeTab} onTabChange=${setActiveTab} />
        <main class="content-area">
            <${ActiveComponent} />
        </main>
    `;
}
