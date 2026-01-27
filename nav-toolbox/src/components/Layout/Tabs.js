import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export default function Tabs({ tabs, activeTab, onTabChange }) {
    return html`
        <nav class="tabs">
            ${tabs.map(tab => html`
                <button 
                    class=${activeTab === tab.id ? 'active' : ''} 
                    onClick=${() => onTabChange(tab.id)}
                >
                    ${tab.label}
                </button>
            `)}
        </nav>
    `;
}
