import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const PRESET_GRID = [
    // Row 1
    ['#000000', '#434343', '#666666', '#999999', '#CCCCCC', '#EFEFEF', '#FFFFFF'],
    // Row 2
    ['#980000', '#FF0000', '#FF9900', '#FFFF00', '#00FF00', '#00FFFF', '#4A86E8'],
    // Row 3 (Pastels/Lighter)
    ['#E6B8AF', '#F4CCCC', '#FCE5CD', '#FFF2CC', '#D9EAD3', '#D0E0E3', '#C9DAF8'],
    // Row 4 (Darker/Muted)
    ['#DD7E6B', '#EA9999', '#F9CB9C', '#FFE599', '#B6D7A8', '#A2C4C9', '#A4C2F4'],
    // Row 5
    ['#CC4125', '#E06666', '#F6B26B', '#FFD966', '#93C47D', '#76A5AF', '#6D9EEB'],
];

// Simplified 5x4 grid as requested (we can pick a subset or standard palette)
// User asked for 5 col x 4 row.
const GRID_5x4 = [
    ['#000000', '#434343', '#666666', '#999999', '#CCCCCC'], // Grayscale
    ['#980000', '#FF0000', '#FF9900', '#FFEB3B', '#4CAF50'], // Rainbow 1 (Less bright Yellow/Green)
    ['#00BCD4', '#4A86E8', '#0000FF', '#9900FF', '#FF00FF'], // Rainbow 2 (Less bright Cyan)
    ['#E6B8AF', '#F4CCCC', '#D9EAD3', '#C9DAF8', '#FFFFFF'], // Pastels
];

const ColorGrid = ({ isOpen, onClose, onChange, currentColor, position }) => {
    const [hex, setHex] = useState(currentColor || '#000000');

    useEffect(() => {
        if (isOpen) {
            setHex(currentColor || '#000000');
        }
    }, [isOpen, currentColor]);

    if (!isOpen) return null;

    const handleHexChange = (e) => {
        const val = e.target.value;
        setHex(val);
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            onChange(val);
        }
    };

    const handleGridClick = (color) => {
        setHex(color);
        onChange(color);
        // onClose(); // Optional: keep open or close on select? Usually pick -> close.
    };

    return (
        <div
            className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl p-3 flex flex-col gap-3 w-[200px]"
            style={{
                top: position?.y ?? 0,
                left: position?.x ?? 0,
            }}
        >
            {/* Header / Hex Input */}
            <div className="flex items-center gap-2">
                <div
                    className="w-6 h-6 rounded border border-[var(--border-color)] shrink-0"
                    style={{ backgroundColor: hex }}
                />
                <div className="flex items-center bg-[var(--bg-color)] border border-[var(--border-color)] rounded px-2 py-1 flex-1 h-8 focus-within:border-[var(--primary-color)]">
                    <span className="text-xs text-[var(--text-secondary)] mr-1">#</span>
                    <input
                        type="text"
                        value={hex.replace('#', '')}
                        onChange={(e) => handleHexChange({ target: { value: '#' + e.target.value } })}
                        className="w-full text-xs bg-transparent outline-none font-mono uppercase text-[var(--text-primary)]"
                        maxLength={6}
                    />
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)]"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Grid */}
            <div className="flex flex-col gap-1">
                {GRID_5x4.map((row, rI) => (
                    <div key={rI} className="flex gap-1">
                        {row.map((c) => (
                            <button
                                key={c}
                                className={`w-8 h-8 rounded border border-transparent hover:scale-110 transition-transform ${c === hex ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-secondary)] z-10' : ''}`}
                                style={{ backgroundColor: c }}
                                onClick={() => handleGridClick(c)}
                                title={c}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ColorGrid;
