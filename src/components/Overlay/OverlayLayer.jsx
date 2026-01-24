import { useRef, useState, useEffect } from 'react';
import useAppStore from '../../stores/useAppStore';
import { getPagePoint, calculateDistance, calculatePolygonArea } from '../../geometry/transforms';
import classes from './OverlayLayer.module.css';

const OverlayLayer = ({ page, width, height }) => {
    const {
        activeTool,
        addMeasurement,
        updateMeasurement,
        measurements,
        calibrationScales,
        pageUnits,
        setPageScale
    } = useAppStore();

    const svgRef = useRef(null);

    // Interaction State
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawingPoints, setDrawingPoints] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [editingId, setEditingId] = useState(null);

    const pageIndex = page.pageNumber;
    const scale = calibrationScales[pageIndex] || 1.0;
    const unit = pageUnits[pageIndex] || 'px';

    const handleMouseMove = (e) => {
        if (!svgRef.current) return;
        const point = getPagePoint(e, svgRef.current);
        setCursor(point);
    };

    const finishDrawing = () => {
        if (!isDrawing) return;

        if (activeTool === 'area' && drawingPoints.length >= 3) {
            addMeasurement({ id: Date.now().toString(), type: 'area', pageIndex, points: [...drawingPoints] });
        } else if (activeTool === 'perimeter' && drawingPoints.length >= 2) {
            addMeasurement({ id: Date.now().toString(), type: 'perimeter', pageIndex, points: [...drawingPoints] });
        }

        setIsDrawing(false);
        setDrawingPoints([]);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (editingId) return;
            if (e.key === 'Enter') finishDrawing();
            if (e.key === 'Escape') {
                setIsDrawing(false);
                setDrawingPoints([]);
                setEditingId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDrawing, drawingPoints, activeTool, editingId]);


    const handleMouseDown = (e) => {
        if (e.target.tagName === 'TEXTAREA' || e.target.closest('.foreignObject')) return;

        if (!svgRef.current) return;
        const point = getPagePoint(e, svgRef.current);

        if (activeTool === 'comment') {
            if (!isDrawing) {
                setIsDrawing(true);
                setDrawingPoints([point]);
            }
        } else if (['length', 'calibrate'].includes(activeTool)) {
            if (!isDrawing) {
                setIsDrawing(true);
                setDrawingPoints([point]);
            } else {
                const start = drawingPoints[0];
                const end = point;

                if (activeTool === 'calibrate') {
                    const distPixels = calculateDistance(start, end);
                    setTimeout(() => {
                        const input = window.prompt(`Distance is ${distPixels.toFixed(2)} pixels. Enter known length (e.g. "5m", "10ft"):`);
                        if (input) {
                            const match = input.match(/([\d.]+)\s*([a-zA-Z]+)?/);
                            if (match) {
                                const value = parseFloat(match[1]);
                                const u = match[2] || 'units';
                                if (!isNaN(value) && value > 0) {
                                    const newScale = distPixels / value;
                                    setPageScale(pageIndex, newScale, u);
                                }
                            } else {
                                // Fallback simple number
                                const val = parseFloat(input);
                                if (val) setPageScale(pageIndex, distPixels / val, 'units');
                            }
                        }
                    }, 10);
                } else if (activeTool === 'length') {
                    addMeasurement({ id: Date.now().toString(), type: 'length', pageIndex, points: [start, end] });
                }
                setIsDrawing(false);
                setDrawingPoints([]);
            }
        } else if (['area', 'perimeter'].includes(activeTool)) {
            if (!isDrawing) {
                setIsDrawing(true);
                setDrawingPoints([point]);
            } else {
                setDrawingPoints([...drawingPoints, point]);
            }
        } else if (activeTool === 'count') {
            addMeasurement({ id: Date.now().toString(), type: 'count', pageIndex, point: point });
        }
    };

    const handleMouseUp = (e) => {
        if (activeTool === 'comment' && isDrawing) {
            const point = getPagePoint(e, svgRef.current);
            const tip = drawingPoints[0];
            const id = Date.now().toString();
            addMeasurement({
                id,
                type: 'comment',
                pageIndex,
                tip: tip,
                box: { x: point.x, y: point.y, w: 150, h: 50 },
                text: ''
            });
            setIsDrawing(false);
            setDrawingPoints([]);
            setEditingId(id);
        }
    };

    const pageMeasurements = measurements.filter(m => m.pageIndex === pageIndex);

    return (
        <svg
            ref={svgRef}
            className={classes.overlaySvg}
            width={width}
            height={height}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onDoubleClick={() => finishDrawing()}
            onMouseMove={handleMouseMove}
            style={{ width, height }}
        >
            {/* Measurements */}
            {pageMeasurements.map(m => {
                if (m.type === 'length') {
                    return (
                        <g key={m.id}>
                            <line x1={m.points[0].x} y1={m.points[0].y} x2={m.points[1].x} y2={m.points[1].y} stroke="#e74c3c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <text x={(m.points[0].x + m.points[1].x) / 2} y={(m.points[0].y + m.points[1].y) / 2 - 5} fill="red" fontSize="14" textAnchor="middle">
                                {(calculateDistance(m.points[0], m.points[1]) / scale).toFixed(2)} {unit}
                            </text>
                        </g>
                    );
                }
                if (m.type === 'area') {
                    const pointsStr = m.points.map(p => `${p.x},${p.y}`).join(' ');
                    return (
                        <g key={m.id}>
                            <polygon points={pointsStr} fill="rgba(46, 204, 113, 0.3)" stroke="#2ecc71" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <text x={m.points[0].x} y={m.points[0].y} fill="#2ecc71" fontSize="14">
                                {(calculatePolygonArea(m.points) / (scale * scale)).toFixed(2)} {unit}²
                            </text>
                        </g>
                    );
                }
                if (m.type === 'perimeter') {
                    const pointsStr = m.points.map(p => `${p.x},${p.y}`).join(' ');
                    let len = 0;
                    for (let i = 0; i < m.points.length - 1; i++) len += calculateDistance(m.points[i], m.points[i + 1]);

                    return (
                        <g key={m.id}>
                            <polyline points={pointsStr} fill="none" stroke="#9b59b6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <text x={m.points[0].x} y={m.points[0].y - 10} fill="#9b59b6" fontSize="14">
                                {(len / scale).toFixed(2)} {unit}
                            </text>
                        </g>
                    );
                }
                if (m.type === 'count') {
                    return <circle key={m.id} cx={m.point.x} cy={m.point.y} r={8} fill="#3498db" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />;
                }
                if (m.type === 'comment') {
                    const isEditing = editingId === m.id;
                    return (
                        <g key={m.id}>
                            <line x1={m.tip.x} y1={m.tip.y} x2={m.box.x + m.box.w / 2} y2={m.box.y + m.box.h / 2} stroke="#333" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                            <circle cx={m.tip.x} cy={m.tip.y} r={3} fill="#333" vectorEffect="non-scaling-stroke" />
                            <foreignObject x={m.box.x} y={m.box.y} width={m.box.w} height={m.box.h} className="foreignObject">
                                {isEditing ? (
                                    <textarea
                                        autoFocus
                                        style={{ width: '100%', height: '100%', resize: 'none', border: '1px solid #3498db', padding: '4px', fontSize: '12px' }}
                                        defaultValue={m.text}
                                        onBlur={(e) => { updateMeasurement(m.id, { text: e.target.value }); setEditingId(null); }}
                                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); }}
                                    />
                                ) : (
                                    <div
                                        style={{ width: '100%', height: '100%', border: '1px solid #ccc', background: 'rgba(255,255,255,0.9)', padding: '4px', fontSize: '12px', overflow: 'hidden', color: 'black' }}
                                        onClick={(e) => { e.stopPropagation(); setEditingId(m.id); }}
                                    >
                                        {m.text || "Enter comment..."}
                                    </div>
                                )}
                            </foreignObject>
                        </g>
                    );
                }
                return null;
            })}

            {/* Drawing Previews */}
            {isDrawing && cursor && (
                <g pointerEvents="none">
                    {['length', 'calibrate', 'comment'].includes(activeTool) && drawingPoints.length > 0 && (
                        <line x1={drawingPoints[0].x} y1={drawingPoints[0].y} x2={cursor.x} y2={cursor.y} stroke={activeTool === 'comment' ? '#333' : 'red'} strokeDasharray="5,5" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    )}
                    {activeTool === 'comment' && drawingPoints.length > 0 && (
                        <rect x={cursor.x} y={cursor.y} width={150} height={50} fill="rgba(255,255,255,0.5)" stroke="#333" strokeDasharray="3,3" />
                    )}
                    {['area', 'perimeter'].includes(activeTool) && drawingPoints.length > 0 && (
                        <>
                            <polyline points={[...drawingPoints.map(p => `${p.x},${p.y}`), `${cursor.x},${cursor.y}`].join(' ')} fill={activeTool === 'area' ? "rgba(46, 204, 113, 0.3)" : "none"} stroke="red" strokeDasharray="5,5" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            {drawingPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="white" stroke="red" vectorEffect="non-scaling-stroke" />)}
                        </>
                    )}
                </g>
            )}
        </svg>
    );
};
export default OverlayLayer;
