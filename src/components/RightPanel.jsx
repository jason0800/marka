import React, { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Copy, Minus, Plus } from 'lucide-react';
import useAppStore from '../stores/useAppStore';
import { calculatePolygonArea } from '../geometry/transforms';

const STROKE_COLORS = ['#000000', '#FF9999', '#77BBFF', '#88DD88', '#FFDD66'];
const FILL_COLORS = ['none', '#FF9999', '#77BBFF', '#88DD88', '#FFDD66'];

const RightPanel = () => {
    const {
        measurements, deleteMeasurement, calibrationScales, pageUnits,
        selectedIds, shapes, updateShape, updateMeasurement, theme,
        activeTool, deleteShape, defaultShapeStyle, setDefaultShapeStyle
    } = useAppStore();

    // Helper to find selected items
    const selectedShapes = shapes.filter(s => selectedIds.includes(s.id));

    // Logic: If selection -> Show Selection Props. If No Selection -> Hide Panel.
    const hasSelection = selectedIds.length > 0;

    // If no selection, don't render anything
    if (!hasSelection) return null;

    // --- Property Handlers ---
    const updateProp = (key, value) => {
        // Always update the default style (Sticky behavior)
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

    return (
        <aside className="w-[260px] bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col h-full overflow-hidden text-[var(--text-primary)]">
            <h2 className="p-3 px-4 text-sm font-semibold border-b border-[var(--border-color)] m-0 bg-[var(--bg-secondary)] shrink-0">
                Properties
            </h2>
            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--text-secondary)] font-medium">Stroke</label>
                    <div className="flex gap-2 flex-wrap items-center">
                        {STROKE_COLORS.map(c => (
                            <button
                                key={c}
                                className={`w-5 h-5 rounded border-2 border-transparent cursor-pointer transition-transform duration-100 hover:scale-110 ${stroke === c ? '!border-[var(--text-primary)]' : ''}`}
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
                                className="w-full text-[0.85em] border-none bg-transparent text-[var(--text-primary)] outline-none font-mono"
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
                                className={`w-5 h-5 rounded border-2 border-transparent cursor-pointer transition-transform duration-100 hover:scale-110 ${fill === c ? '!border-[var(--text-primary)]' : ''}`}
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
                                className="w-full text-[0.85em] border-none bg-transparent text-[var(--text-primary)] outline-none font-mono"
                                maxLength={6}
                                placeholder="None"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--text-secondary)] font-medium">Stroke Width</label>
                    <div className="flex gap-1 bg-[var(--bg-color)] p-0.5 rounded-md border border-[var(--border-color)]">
                        {[1, 2, 4].map(w => (
                            <button
                                key={w}
                                className={`flex-1 h-6 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeWidth === w ? '!bg-[var(--bg-secondary)] !text-[var(--primary-color)] shadow-sm' : ''}`}
                                onClick={() => updateProp('strokeWidth', w)}
                            >
                                <div style={{ height: w, width: '20px', background: 'currentColor', borderRadius: 2 }}></div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--text-secondary)] font-medium">Stroke Style</label>
                    <div className="flex gap-1 bg-[var(--bg-color)] p-0.5 rounded-md border border-[var(--border-color)]">
                        <button
                            className={`flex-1 h-6 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeDasharray === 'none' ? '!bg-[var(--bg-secondary)] !text-[var(--primary-color)] shadow-sm' : ''}`}
                            onClick={() => updateProp('strokeDasharray', 'none')}
                            title="Continuous"
                        >
                            <svg width="20" height="4" style={{ display: 'block' }}>
                                <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" />
                            </svg>
                        </button>
                        <button
                            className={`flex-1 h-6 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeDasharray === '8,6' ? '!bg-[var(--bg-secondary)] !text-[var(--primary-color)] shadow-sm' : ''}`}
                            onClick={() => updateProp('strokeDasharray', '8,6')}
                            title="Dashed"
                        >
                            <svg width="20" height="4" style={{ display: 'block' }}>
                                <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="6,4" />
                            </svg>
                        </button>
                        <button
                            className={`flex-1 h-6 border-none bg-transparent rounded cursor-pointer flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${strokeDasharray === '2,4' ? '!bg-[var(--bg-secondary)] !text-[var(--primary-color)] shadow-sm' : ''}`}
                            onClick={() => updateProp('strokeDasharray', '2,4')}
                            title="Dotted"
                        >
                            <svg width="20" height="4" style={{ display: 'block' }}>
                                <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="2,3" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                        <label className="text-xs text-[var(--text-secondary)] font-medium">Opacity</label>
                        <span className="text-xs text-[var(--text-primary)] bg-[var(--bg-color)] px-1.5 py-0.5 rounded">{Math.round(opacity * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={opacity}
                        onChange={(e) => updateProp('opacity', parseFloat(e.target.value))}
                        className="w-full h-1 bg-[var(--border-color)] rounded-sm appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--text-primary)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--bg-secondary)] [&::-webkit-slider-thumb]:shadow-md"
                    />
                </div>
            </div>
        </aside>
    );
};

export default RightPanel;
