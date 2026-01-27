import React, { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Copy, Minus, Plus } from 'lucide-react';
import useAppStore from '../../stores/useAppStore';
import classes from './RightPanel.module.css';
import { calculatePolygonArea } from '../../geometry/transforms';

const STROKE_COLORS = ['#000000', '#FF9999', '#77BBFF', '#88DD88', '#FFDD66'];
const FILL_COLORS = ['none', '#FF9999', '#77BBFF', '#88DD88', '#FFDD66'];

const RightPanel = () => {
    const {
        measurements, deleteMeasurement, calibrationScales, pageUnits,
        selectedIds, shapes, updateShape, updateMeasurement, theme,
        activeTool, deleteShape
    } = useAppStore();

    // Helper to find selected items
    const selectedShapes = shapes.filter(s => selectedIds.includes(s.id));
    const selectedMeasurements = measurements.filter(m => selectedIds.includes(m.id));

    // Determine what to show
    const showProperties = selectedIds.length > 0;

    // --- Property Handlers ---
    const updateProp = (key, value) => {
        selectedIds.forEach(id => {
            // Update shapes
            if (selectedShapes.find(s => s.id === id)) {
                updateShape(id, { [key]: value });
            }
            // Update measurements (if applicable, e.g. color? currently measure styles are hardcoded usually)
            // But we could allow bolding etc. For now focus on shapes.
        });
    };

    const handleDelete = () => {
        selectedIds.forEach(id => {
            if (selectedShapes.find(s => s.id === id)) deleteShape(id);
            if (selectedMeasurements.find(s => s.id === id)) deleteMeasurement(id);
        });
        // Select nothing? Handled by store/overlay typically? 
        // We should clear selection?
        // setSelectedIds([]); // Need to import if we want to clear.
    };

    // Common properties from first selected item
    const firstItem = selectedShapes[0];
    const stroke = firstItem?.stroke || '#000000';
    const fill = firstItem?.fill || 'none';
    const strokeWidth = firstItem?.strokeWidth || 2;
    const strokeDasharray = firstItem?.strokeDasharray || 'none';
    const opacity = firstItem?.opacity ?? 1;

    // --- Renderers ---
    const renderProperties = () => (
        <div className={classes.propertiesContent}>
            <div className={classes.section}>
                <label className={classes.label}>Stroke</label>
                <div className={classes.colorGrid}>
                    {STROKE_COLORS.map(c => (
                        <button
                            key={c}
                            className={`${classes.colorBtn} ${stroke === c ? classes.activeColor : ''}`}
                            style={{ backgroundColor: c }}
                            onClick={() => updateProp('stroke', c)}
                        />
                    ))}

                    {/* Hex Input */}
                    <div className={classes.hexInputGroup}>
                        <span className={classes.hexPrefix}>#</span>
                        <input
                            type="text"
                            value={(stroke || '').replace('#', '')}
                            onChange={(e) => updateProp('stroke', '#' + e.target.value)}
                            className={classes.hexInput}
                            maxLength={6}
                            placeholder="000000"
                        />
                    </div>
                </div>
            </div>

            <div className={classes.section}>
                <label className={classes.label}>Fill</label>
                <div className={classes.colorGrid}>
                    {FILL_COLORS.map(c => (
                        <button
                            key={c}
                            className={`${classes.colorBtn} ${fill === c ? classes.activeColor : ''}`}
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
                    <div className={classes.hexInputGroup}>
                        <span className={classes.hexPrefix}>#</span>
                        <input
                            type="text"
                            value={(fill === 'none' ? '' : (fill || '')).replace('#', '')}
                            onChange={(e) => updateProp('fill', e.target.value ? '#' + e.target.value : 'none')}
                            className={classes.hexInput}
                            maxLength={6}
                            placeholder="None"
                        />
                    </div>
                </div>
            </div>

            <div className={classes.section}>
                <label className={classes.label}>Stroke Width</label>
                <div className={classes.buttonGroup}>
                    {[1, 2, 4].map(w => (
                        <button
                            key={w}
                            className={`${classes.groupBtn} ${strokeWidth === w ? classes.activeBtn : ''}`}
                            onClick={() => updateProp('strokeWidth', w)}
                        >
                            <div style={{ height: w, width: '20px', background: 'currentColor', borderRadius: 2 }}></div>
                        </button>
                    ))}
                </div>
            </div>

            <div className={classes.section}>
                <label className={classes.label}>Stroke Style</label>
                <div className={classes.buttonGroup}>
                    <button
                        className={`${classes.groupBtn} ${strokeDasharray === 'none' ? classes.activeBtn : ''}`}
                        onClick={() => updateProp('strokeDasharray', 'none')}
                        title="Continuous"
                    >
                        <svg width="20" height="4" style={{ display: 'block' }}>
                            <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" />
                        </svg>
                    </button>
                    <button
                        className={`${classes.groupBtn} ${strokeDasharray === '6,3' ? classes.activeBtn : ''}`}
                        onClick={() => updateProp('strokeDasharray', '6,3')}
                        title="Dashed"
                    >
                        <svg width="20" height="4" style={{ display: 'block' }}>
                            <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="6,3" />
                        </svg>
                    </button>
                    <button
                        className={`${classes.groupBtn} ${strokeDasharray === '2,2' ? classes.activeBtn : ''}`}
                        onClick={() => updateProp('strokeDasharray', '2,2')}
                        title="Dotted"
                    >
                        <svg width="20" height="4" style={{ display: 'block' }}>
                            <line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="2,2" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className={classes.section}>
                <div className={classes.rowBetween}>
                    <label className={classes.label}>Opacity</label>
                    <span className={classes.valueLabel}>{Math.round(opacity * 100)}%</span>
                </div>
                <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => updateProp('opacity', parseFloat(e.target.value))}
                    className={classes.slider}
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
            return `${(dist / scale).toFixed(2)} ${unit}`;
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
            return `${(len / scale).toFixed(2)} ${unit}`;
        }
        if (m.type === 'comment') return m.text || "(Untitled)";
        if (m.type === 'count') return `Point`;
        return m.type;
    };

    const renderMeasurementList = () => (
        <div className={classes.listContent}>
            {Object.entries(grouped).map(([type, items]) => (
                <div key={type} className={classes.group}>
                    <h3 className={classes.groupHeader}>{type.charAt(0).toUpperCase() + type.slice(1)}s ({items.length})</h3>
                    <ul className={classes.list}>
                        {items.map(m => (
                            <li key={m.id} className={classes.item}>
                                <div className={classes.itemInfo}>
                                    <span className={classes.itemPage}>Pg {m.pageIndex + 1}</span>
                                    <span className={classes.itemValue}>{renderValue(m)}</span>
                                </div>
                                <button className={classes.deleteIcon} onClick={() => deleteMeasurement(m.id)}>
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            {measurements.length === 0 && <p className={classes.empty}>No measurements yet.</p>}
        </div>
    );

    return (
        <aside className={classes.panel}>
            <h2 className={classes.header}>
                {showProperties ? "Properties" : "Measurements"}
            </h2>
            {showProperties ? renderProperties() : renderMeasurementList()}
        </aside>
    );
};

export default RightPanel;
