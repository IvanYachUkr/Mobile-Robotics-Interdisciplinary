import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export default function Header() {
    return html`
        <header>
            <div>
                <h1>Navigation Toolbox</h1>
                <p class="subtitle">Navigation emerges from four interacting representational levels (sensorimotor to symbolic) working bidirectionally.</p>
            </div>
            <div style="font-size: 0.8em; color: #64748b;">
                Interactive Demo
            </div>
        </header>
    `;
}
