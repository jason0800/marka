import React, { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Copy, Minus, Plus } from 'lucide-react';
import useAppStore from '../stores/useAppStore';
import { calculatePolygonArea } from '../geometry/transforms';

const STROKE_COLORS = ['#000000', '#FF9999', '#77BBFF', '#88DD88', '#FFDD66'];
const FILL_COLORS = ['none', '#FF9999', '#77BBFF', '#88DD88', '#FFDD66'];

/**
 * PropertiesPanel Component
 * 
 * Displays context-aware properties for selected shapes.
 * If no shape is selected, the panel is hidden.
 * 
 * Features:
 * - Stroke & Fill Color pickers (Presets + Hex input)
 * - Stroke Width & Style (Continuous, Dashed, Dotted)
 * - Opacity control (0-100%)
 * 
 * "Sticky" Styles:
 * Changes made here update the CURRENT selection, but also update the 
 * `defaultShapeStyle` in the store. This means the next shape you draw 
 * will automatically inherit these settings.
 */
const PropertiesPanel = () => {
    const {
        measurements, deleteMeasurement, calibrationScales, pageUnits,
        selectedIds, shapes, updateShape, updateMeasurement, theme,
        activeTool, deleteShape, defaultShapeStyle, setDefaultShapeStyle
    } = useAppStore();

    // Helper to find selected items
    const selectedShapes = shapes.filter(s => selectedIds.includes(s.id));

    // Logic: If selection -> Show Selection Props. If No Selection -> Hide Panel.
    const hasSelection = selectedIds.length > 0;



    // --- Property Handlers ---
    const updateProp = (key, value) => {
        // 1. "Sticky" Behavior: Always update the global default style
        // so the user's preference persists for the next shape they draw.
        if (key !== 'text') {
            setDefaultShapeStyle({ [key]: value });
        }

        if (hasSelection) {
            selectedIds.forEach(id => {
                if (selectedShapes.find(s => s.id === id)) {
                    updateShape(id, { [key]: value });
                }
            });
        }
    };

    // Properties source: First selected item OR Defaults
    const source = selectedShapes[0] || defaultShapeStyle;

    const stroke = source?.stroke || defaultShapeStyle.stroke;
    const fill = source?.fill || defaultShapeStyle.fill;
    const strokeWidth = source?.strokeWidth || defaultShapeStyle.strokeWidth;
    const strokeDasharray = source?.strokeDasharray || defaultShapeStyle.strokeDasharray;
    const opacity = source?.opacity ?? defaultShapeStyle.opacity;

    // Local state for rotation input to allow typing "-"
    const [tempRotation, setTempRotation] = useState(null);

    // Sync temp rotation if selection changes (optional, but good practice to reset if we switch shapes)
    // Actually, on blur we reset, so switching shapes should be fine if we assume blur happens.
    // But if we click another shape directly, input might keep old temp value if we don't clear it.
    // Let's just use key-based reset or `useEffect` on `selectedIds`.

    React.useEffect(() => {
        setTempRotation(null);
    }, [selectedIds]);

    return (
        <div className="bg-[var(--bg-secondary)] flex flex-col text-[var(--text-primary)] h-full">
            <div className="flex justify-between items-center p-3 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <h2 className="text-sm font-semibold m-0">Properties</h2>
                {hasSelection && (
                    <button
                        className="p-1 rounded text-[var(--text-secondary)] hover:text-[#ff4d4f] hover:bg-[var(--btn-hover)] transition-colors"
                        onClick={() => {
                            selectedIds.forEach(id => {
                                if (shapes.find(s => s.id === id)) deleteShape(id);
                                else deleteMeasurement(id);
                            });
                            useAppStore.getState().setSelectedIds([]); // Clear selection using store getter or passed prop if available
                        }}
                        title="Delete Selected (Delete/Backspace)"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
            </div>

            {!hasSelection ? (
                <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] p-4 text-center">
                    <p className="text-sm">Select an item to view properties</p>
                </div>
            ) : (
                <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[var(--text-secondary)] font-medium">Stroke</label>
                        <div className="flex gap-2 flex-wrap items-center">
                            {STROKE_COLORS.map(c => (
                                <button
                                    key={c}
                                    className={`w-5 h-5 rounded border-2 border-transparent cursor-pointer transition-transform duration-100 hover:scale-110 ${stroke === c ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-secondary)]' : ''}`}
                                    style={{ backgroundColor: c }}
                                    onClick={() => updateProp('stroke', c)}
                                />
                            ))}

                            {/* Hex Input */}
                            <div className="flex items-center bg-[var(--bg-color)] border border-transparent rounded-[6px] px-2 py-0.5 flex-1 h-6 transition-colors duration-200 focus-within:bg-[var(--bg-secondary)] focus-within:border-[var(--primary-color)]">
                                <span className="text-[0.8em] text-[var(--text-secondary)] mr-1 select-none">#</span>
                                <input
                                    type="text"
                                    value={(stroke || '').replace('#', '')}
                                    onChange={(e) => updateProp('stroke', '#' + e.target.value)}
                                    className="w-full text-[11px] border-none bg-transparent text-[var(--text-primary)] outline-none font-mono uppercase"
                                    maxLength={6}
                                    placeholder="000000"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[var(--text-secondary)] font-medium">Fill</label>
                        <div className="flex gap-2 flex-wrap items-center">
                            {FILL_COLORS.map(c => (
                                <button
                                    key={c}
                                    className={`w-5 h-5 rounded border-2 border-transparent cursor-pointer transition-transform duration-100 hover:scale-110 ${fill === c ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-secondary)]' : ''}`}
                                    style={{
                                        backgroundColor: c === 'none' ? '#fff' : c,
                                        background: c === 'none'
                                            ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'><path d='M0 0h4v4H0zm4 4h4v4H4z' fill='%23e0e0e0'/></svg>")`
                                            : c
                                    }}
                                    onClick={() => updateProp('fill', c)}
                                    title={c === 'none' ? 'Transparent' : c}
                                />
                            ))}

                            {/* Hex Input */}
                            <div className="flex items-center bg-[var(--bg-color)] border border-transparent rounded-[6px] px-2 py-0.5 flex-1 h-6 transition-colors duration-200 focus-within:bg-[var(--bg-secondary)] focus-within:border-[var(--primary-color)]">
                                <span className="text-[0.8em] text-[var(--text-secondary)] mr-1 select-none">#</span>
                                <input
                                    type="text"
                                    value={(fill === 'none' ? '' : (fill || '')).replace('#', '')}
                                    onChange={(e) => updateProp('fill', e.target.value ? '#' + e.target.value : 'none')}
                                    className="w-full text-[11px] border-none bg-transparent text-[var(--text-primary)] outline-none font-mono uppercase"
                                    maxLength={6}
                                    placeholder="None"
                                />
                            </div>
                        </div>
                    </div>

                    {/* // line widths */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[var(--text-secondary)] font-medium">Stroke Width</label>
                        <div className="flex gap-1 bg-[var(--bg-color)] p-0.5 rounded-md border border-[var(--border-color)]">
                            {[1.5, 2.75, 3.75].map(w => (
                                <button
                                    key={w}
                                    className={`flex-1 h-7 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeWidth === w ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.25)]' : ''}`}
                                    onClick={() => updateProp('strokeWidth', w)}
                                    aria-pressed={strokeWidth === w}
                                    aria-label={`Stroke width ${w}`}
                                >
                                    <div style={{ height: Math.max(1, w), width: '24px', background: 'currentColor', borderRadius: 99 }}></div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* // line styles */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[var(--text-secondary)] font-medium">Stroke Style</label>
                        <div className="flex gap-1 bg-[var(--bg-color)] p-0.5 rounded-md border border-[var(--border-color)]">
                            <button
                                className={`flex-1 h-7 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeDasharray === 'none' ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.25)]' : ''}`}
                                onClick={() => updateProp('strokeDasharray', 'none')}
                                title="Continuous"
                                aria-pressed={strokeDasharray === 'none'}
                            >
                                <svg width="24" height="4" style={{ display: 'block', overflow: 'visible' }}>
                                    <line x1="0" y1="2" x2="24" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            </button>
                            <button
                                className={`flex-1 h-7 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeDasharray === '8,12' ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.25)]' : ''}`}
                                onClick={() => updateProp('strokeDasharray', '8,12')}
                                title="Dashed"
                                aria-pressed={strokeDasharray === '8,12'}
                            >
                                <svg width="24" height="4" style={{ display: 'block', overflow: 'visible' }}>
                                    <line x1="0" y1="2" x2="24" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4,6" strokeLinecap="round" />
                                </svg>
                            </button>
                            <button
                                className={`flex-1 h-7 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeDasharray === '0,10' ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.25)]' : ''}`}
                                onClick={() => updateProp('strokeDasharray', '0,10')}
                                title="Dotted"
                                aria-pressed={strokeDasharray === '0,10'}
                            >
                                <svg width="24" height="4" style={{ display: 'block', overflow: 'visible' }}>
                                    <line x1="0" y1="2" x2="24" y2="2" stroke="currentColor" strokeWidth="3" strokeDasharray="1,9" strokeLinecap="round" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Opacity Control */}
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs text-[var(--text-secondary)] font-medium">Opacity</label>
                            <div className="flex items-center bg-[var(--bg-color)] px-1.5 py-0.5 rounded min-w-[12px] border border-transparent focus-within:border-[var(--primary-color)] transition-colors">
                                <input
                                    type="text"
                                    value={`${Math.round(opacity * 100)}`}
                                    onChange={(e) => {
                                        let val = parseInt(e.target.value.replace(/[^0-9]/g, '')) || 0;
                                        val = Math.min(100, Math.max(0, val));
                                        updateProp('opacity', val / 100);
                                    }}
                                    className="w-[24px] text-xs text-[var(--text-primary)] bg-transparent outline-none text-right font-mono"
                                />
                                <span className="text-xs text-[var(--text-secondary)] ml-0.5">%</span>
                            </div>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={opacity}
                            onChange={(e) => updateProp('opacity', parseFloat(e.target.value))}
                            className="w-full h-0.5 bg-[var(--border-color)] rounded-sm appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--text-primary)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--bg-secondary)] [&::-webkit-slider-thumb]:shadow-md"
                        />
                    </div>

                    {/* Rotation Control - Hidden for Lines/Arrows */}
                    {!['line', 'arrow'].includes(source?.type) && (
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-[var(--text-secondary)] font-medium">Rotation</label>
                                <div className="flex items-center bg-[var(--bg-color)] px-2 py-0.5 rounded border border-transparent focus-within:border-[var(--primary-color)] transition-colors h-5 w-[50px]">
                                    <input
                                        type="text"
                                        value={tempRotation !== null ? tempRotation : Math.round(source?.rotation || 0)}
                                        onChange={(e) => {
                                            const valStr = e.target.value.replace(/[^0-9-]/g, '');
                                            setTempRotation(valStr);

                                            // Only update actual prop if it's a valid number
                                            if (valStr !== '' && valStr !== '-') {
                                                const val = parseInt(valStr);
                                                if (!isNaN(val)) {
                                                    updateProp('rotation', val);
                                                }
                                            }
                                        }}
                                        onBlur={() => {
                                            // Commit final value (if we left it as '-')
                                            if (tempRotation === '-') {
                                                updateProp('rotation', 0);
                                            }
                                            setTempRotation(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.target.blur();
                                            }
                                            if (e.key === 'ArrowUp') {
                                                e.preventDefault();
                                                const current = parseInt(tempRotation !== null ? tempRotation : (source?.rotation || 0)) || 0;
                                                const newVal = current + (e.shiftKey ? 15 : 1);
                                                updateProp('rotation', newVal);
                                                setTempRotation(String(newVal));
                                            }
                                            if (e.key === 'ArrowDown') {
                                                e.preventDefault();
                                                const current = parseInt(tempRotation !== null ? tempRotation : (source?.rotation || 0)) || 0;
                                                const newVal = current - (e.shiftKey ? 15 : 1);
                                                updateProp('rotation', newVal);
                                                setTempRotation(String(newVal));
                                            }
                                        }}
                                        className="w-full text-xs text-[var(--text-primary)] bg-transparent outline-none text-right font-mono"
                                    />
                                    <span className="text-xs text-[var(--text-secondary)] ml-1 select-none">°</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PropertiesPanel;
