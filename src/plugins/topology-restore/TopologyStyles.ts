/**
 * TopologyStyles.ts
 * Definitions for the "Premium/Sci-Fi" Topology Theme
 */

// 1. Neon Color Palette
export const NEON_PALETTE = {
    background: '#0f172a', // Deep Space Blue/Grey
    grid: '#1e293b',       // Subtle Grid
    core: '#ef4444',       // Red Neon (High Priority)
    spine: '#3b82f6',      // Blue Neon (Backbone)
    leaf: '#10b981',       // Green Neon (Access)
    pod: '#6366f1',        // Indigo (Groups)
    rail: '#8b5cf6',       // Violet (Planes)
    text: '#f8fafc',       // White-ish
    textMuted: '#94a3b8',  // Grey-ish
    border: 'rgba(255, 255, 255, 0.2)',
};

// 2. Layer Specific Colors (Mapped for Cytoscape)
export const LAYER_COLORS: Record<string, string> = {
    core: NEON_PALETTE.core,
    spine: NEON_PALETTE.spine,
    leaf: NEON_PALETTE.leaf,

    oob: '#fbbf24',    // Amber
    soob: '#a855f7',   // Purple
    lsw: '#f97316',    // Orange
    csw: NEON_PALETTE.core, // Red
    ssw: NEON_PALETTE.spine, // Blue
    asw: NEON_PALETTE.leaf, // Green
    unknown: '#64748b', // Slate
    podGroup: 'rgba(30, 41, 59, 0.5)' // Glassy background for PODs
};

/**
 * Generates the Cytoscape Stylesheet for the Premium Theme
 */
export function getPremiumStyles(): any[] {
    return [
        // --- Global Node Styles ---
        {
            selector: 'node',
            style: {
                'label': 'data(displayLabel)', // Multiline label
                'text-wrap': 'wrap',
                'color': NEON_PALETTE.text,
                'font-size': '9px',
                'font-weight': 'normal',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-outline-color': '#000',
                'text-outline-width': '0px',
                'background-color': '#334155',
                'border-width': '1px',
                'border-color': 'rgba(255,255,255,0.5)',
                'width': '86px',
                'height': '34px',
                'shape': 'round-rectangle',
                'ghost': 'yes',
                'ghost-offset-x': 2,
                'ghost-offset-y': 2,
                'ghost-opacity': 0.3,
                'transition-property': 'background-color, border-color, width, height',
                'transition-duration': '0.3s'
            }
        },


        // --- Layer Specific Styles (Neon Glows - Card Style) ---
        {
            selector: 'node[layer="core"], node[layer="csw"]',
            style: {
                'background-color': 'rgba(239, 68, 68, 0.2)', // Low opacity fill
                'border-color': NEON_PALETTE.core,
                'border-width': '2px',
                'width': '100px',
                'height': '40px'
            }
        },
        {
            selector: 'node[layer="spine"], node[layer="ssw"]',
            style: {
                'background-color': 'rgba(59, 130, 246, 0.2)',
                'border-color': NEON_PALETTE.spine,
                'border-width': '2px',
                'width': '96px',
                'height': '38px'
            }
        },
        {
            selector: 'node[layer="leaf"], node[layer="asw"]',
            style: {
                'background-color': 'rgba(16, 185, 129, 0.2)',
                'border-color': NEON_PALETTE.leaf,
                'border-width': '2px',
                'width': '88px',
                'height': '34px'
            }
        },
        {
            selector: 'node[layer="oob"]',
            style: {
                'background-color': 'rgba(251, 191, 36, 0.2)',
                'border-color': '#fbbf24',
                'border-width': '2px',
                'width': '80px',
                'height': '32px'
            }
        },
        {
            selector: 'node[layer="soob"]',
            style: {
                'background-color': 'rgba(168, 85, 247, 0.2)',
                'border-color': '#a855f7',
                'width': '80px',
                'height': '32px'
            }
        },
        {
            selector: 'node[layer="lsw"]',
            style: {
                'background-color': 'rgba(249, 115, 22, 0.2)',
                'border-color': '#f97316',
                'width': '80px',
                'height': '32px'
            }
        },

        // --- Compound Node (POD) Styles ---
        {
            selector: ':parent', // Container Nodes
            style: {
                'background-color': LAYER_COLORS.podGroup,
                'border-color': NEON_PALETTE.border,
                'border-width': '1px',
                'border-style': 'dashed',
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'color': NEON_PALETTE.textMuted,
                'font-size': '13px',
                'text-margin-y': '-10px', // Move label above box
                'shape': 'roundrectangle',
                'padding': '12px'
            }
        },

        // --- POD Aggregate Node (Collapsed POD) ---
        {
            selector: '.podAggregate',
            style: {
                'width': '120px',
                'height': '120px',
                'shape': 'round-rectangle',
                'background-color': NEON_PALETTE.pod,
                'border-width': '4px',
                'border-color': '#fff',
                'border-style': 'solid',
                'label': 'data(label)',
                'font-size': '14px',
                'font-weight': 'bold',
                'text-wrap': 'wrap',
                'text-max-width': '110px',
                'color': NEON_PALETTE.text,
                'text-valign': 'center',
                'text-halign': 'center',
                'text-outline-color': '#000',
                'text-outline-width': '2px'
            }
        },

        // --- Edge Styles ---
        {
            selector: 'edge',
            style: {
                'width': 1,
                'line-color': '#ffffff', // White lines
                'curve-style': 'bezier',
                'opacity': 0.5, // Increased visibility
                'target-arrow-shape': 'none'
            }
        },
        {
            selector: 'edge:selected',
            style: {
                'width': 3,
                'line-color': NEON_PALETTE.text,
                'opacity': 1,
                'z-index': 999
            }
        },

        // --- Interaction States ---
        {
            selector: 'node:selected',
            style: {
                'border-width': '4px',
                'border-color': '#fff',
                'shadow-blur': '0px',
                'shadow-color': '#fff'
            }
        },
        {
            selector: '.highlighted', // Programmatic highlight
            style: {
                'border-color': '#f59e0b', // Amber/Gold
                'border-width': '4px',
                'shadow-blur': '0px',
                'shadow-color': '#f59e0b',
                'z-index': 9999
            }
        },
        {
            selector: '.dimmed', // For spotlight mode
            style: {
                'opacity': 0.1,
                'z-index': 0
            }
        }
    ];
}
