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
    const selectedMeasurements = measurements.filter(m => selectedIds.includes(m.id));

    // Determine what to show
    // Show properties if selection exists OR if we are in a "shape creation" mode (basically always show properties tab unless viewing list)
    // Actually, user requested "sticky properties". 
    // Logic: If selection -> Show Selection Props. If No Selection -> Show Default Props (Sticky).
    const hasSelection = selectedIds.length > 0;
    const showProperties = hasSelection || true; // Always show properties panel effectively, acts as "Tool Options" when no selection.

    // --- Property Handlers ---
    const updateProp = (key, value) => {
        // Always update the default style (Sticky behavior)
        if (key !== 'text') { // Don't stick text obviously
            setDefaultShapeStyle({ [key]: value });
        }

        // If items are selected, update them too
        if (hasSelection) {
            selectedIds.forEach(id => {
                // Update shapes
                if (selectedShapes.find(s => s.id === id)) {
                    updateShape(id, { [key]: value });
                }
            });
        }
    };

    const handleDelete = () => {
        selectedIds.forEach(id => {
            if (selectedShapes.find(s => s.id === id)) deleteShape(id);
            if (selectedMeasurements.find(s => s.id === id)) deleteMeasurement(id);
        });
    };

    // Properties source: First selected item OR Defaults
    const source = hasSelection ? selectedShapes[0] : defaultShapeStyle;

    // Safety check if source is undefined (e.g. selected item is measurement, not shape)
    // If selected item is a measurement, we might want to hide shape properties or show relevant ones?
    // For now, if selection contains ONLY measurements, maybe don't show shape props?
    // Let's keep it simple: if shape properties are relevant, show them.

    const stroke = source?.stroke || defaultShapeStyle.stroke;
    const fill = source?.fill || defaultShapeStyle.fill;
    const strokeWidth = source?.strokeWidth || defaultShapeStyle.strokeWidth;
    const strokeDasharray = source?.strokeDasharray || defaultShapeStyle.strokeDasharray;
    const opacity = source?.opacity ?? defaultShapeStyle.opacity;

    // --- Renderers ---
    const renderProperties = () => (
        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
            {!hasSelection && (
                <div className="text-xs text-[var(--text-secondary)] italic mb-2">
                    Default Styles (Next Shape)
                </div>
            )}
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
    );

    // --- Existing Measurement List Logic ---
    const grouped = measurements.reduce((acc, m) => {
        acc[m.type] = acc[m.type] || [];
        acc[m.type].push(m);
        return acc;
    }, {});

    const renderValue = (m) => {
        const scale = calibrationScales[m.pageIndex] || 1.0;
        const unit = pageUnits[m.pageIndex] || 'px';

        if (m.type === 'length') {
            const dist = Math.sqrt(Math.pow(m.points[1].x - m.points[0].x, 2) + Math.pow(m.points[1].y - m.points[0].y, 2));
            return `${(dist / scale).toFixed(2)} ${unit} `;
        }
        if (m.type === 'area') {
            const area = calculatePolygonArea(m.points);
            return `${(area / (scale * scale)).toFixed(2)} ${unit}²`;
        }
        if (m.type === 'perimeter') {
            let len = 0;
            for (let i = 0; i < m.points.length - 1; i++) {
                len += Math.sqrt(Math.pow(m.points[i + 1].x - m.points[i].x, 2) + Math.pow(m.points[i + 1].y - m.points[i].y, 2));
            }
            return `${(len / scale).toFixed(2)} ${unit} `;
        }
        if (m.type === 'comment') return m.text || "(Untitled)";
        if (m.type === 'count') return `Point`;
        return m.type;
    };

    const renderMeasurementList = () => (
        <div className="flex-1 overflow-y-auto p-3">
            {Object.entries(grouped).map(([type, items]) => (
                <div key={type} className="mb-6">
                    <h3 className="text-[11px] uppercase text-[var(--text-secondary)] m-0 mb-2 ml-1 tracking-[0.5px]">{type.charAt(0).toUpperCase() + type.slice(1)}s ({items.length})</h3>
                    <ul className="list-none p-0 m-0 flex flex-col gap-1">
                        {items.map(m => (
                            <li key={m.id} className="flex items-center justify-between p-2 px-3 bg-[var(--bg-color)] rounded-md border border-transparent transition-all duration-200 hover:border-[var(--border-color)] group">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[10px] text-[var(--text-secondary)]">Pg {m.pageIndex + 1}</span>
                                    <span className="text-[13px] font-medium text-[var(--text-primary)]">{renderValue(m)}</span>
                                </div>
                                <button className="bg-transparent border-none text-[var(--text-secondary)] cursor-pointer p-1 rounded opacity-0 transition-all duration-200 group-hover:opacity-100 hover:text-[#ff4444] hover:bg-red-500/10" onClick={() => deleteMeasurement(m.id)}>
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            {measurements.length === 0 && <p className="p-8 text-center text-[var(--text-secondary)] text-[13px]">No measurements yet.</p>}
        </div>
    );

    return (
        <aside className="w-[260px] bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col h-full overflow-hidden text-[var(--text-primary)]">
            <h2 className="p-3 px-4 text-sm font-semibold border-b border-[var(--border-color)] m-0 bg-[var(--bg-secondary)] shrink-0">
                {showProperties ? "Properties" : "Measurements"}
            </h2>
            {showProperties ? renderProperties() : renderMeasurementList()}
        </aside>
    );
};

export default RightPanel;
