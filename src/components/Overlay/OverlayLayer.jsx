
import { useRef, useState, useEffect } from 'react';
import useAppStore from '../../stores/useAppStore';
import { calculateDistance, calculatePolygonArea } from '../../geometry/transforms'; // Removed getPagePoint from here
import classes from './OverlayLayer.module.css';

const OverlayLayer = ({ page, width, height, viewScale = 1.0 }) => {
    const {
        activeTool,
        addMeasurement,
        updateMeasurement,
        deleteMeasurement,
        measurements,
        calibrationScales,
        pageUnits,
        setPageScale,
        shapes,
        addShape,
        updateShape,
        selectedIds,
        setSelectedIds
    } = useAppStore();

    const svgRef = useRef(null);

    // Interaction State
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawingPoints, setDrawingPoints] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [editingId, setEditingId] = useState(null);

    // For Shapes (drag to resize/draw)
    const [shapeStart, setShapeStart] = useState(null);

    const pageIndex = page.pageNumber;
    const calibrationScale = calibrationScales[pageIndex] || 1.0;
    const unit = pageUnits[pageIndex] || 'px';

    // --- Coordinate System ---
    // We set viewBox to the UN-SCALED Page Dimensions (PDF Points).
    // The SVG 'width' and 'height' props are SCALED (Physical Pixels).
    // This lets SVG handle the visual scaling automatically.
    // getScreenCTM() naturally maps Screen -> viewBox coordinates.
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const viewBox = `0 0 ${unscaledViewport.width} ${unscaledViewport.height}`;

    // Helper: Stroke width should visually remain constant (~2px)
    // Formula: DesiredPixels / viewScale
    const dynamicStroke = 2 / viewScale;
    const handleRadius = 5 / viewScale;

    const getPagePoint = (e, svg) => {
        const point = svg.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        const matrix = svg.getScreenCTM().inverse();
        return point.matrixTransform(matrix);
        // Correct! Point is now in PDF Points (viewBox units).
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
        setShapeStart(null);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (editingId) return;
            if (e.key === 'Enter') finishDrawing();
            if (e.key === 'Escape') {
                setIsDrawing(false);
                setDrawingPoints([]);
                setShapeStart(null);
                setEditingId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDrawing, drawingPoints, activeTool, editingId]);


    // Selection & Dragging State
    const [selectionStart, setSelectionStart] = useState(null);
    const [dragStart, setDragStart] = useState(null);
    const [isDraggingItems, setIsDraggingItems] = useState(false);

    // Resize State
    const [resizingState, setResizingState] = useState(null); // { id, handle: 'nw'|'n'|'ne'..., startShape, startPoint }

    const handleMouseDown = (e) => {
        // ✅ only left-click should interact with tools
        if (e.button !== 0) {
            // optional: prevent browser middle-click autoscroll
            if (e.button === 1) e.preventDefault();
            return;
        }

        if (e.target.tagName === 'TEXTAREA' || e.target.closest('.foreignObject')) return;
        if (!svgRef.current) return;

        const point = getPagePoint(e, svgRef.current);
        const isShift = e.shiftKey;

        // Check Resize Handlers First
        const resizeHandle = e.target.getAttribute('data-resize-handle');
        const resizeId = e.target.getAttribute('data-resize-id');
        if (resizeHandle && resizeId) {
            const shape = shapes.find(s => s.id === resizeId);
            if (shape) {
                setResizingState({
                    id: resizeId,
                    handle: resizeHandle,
                    startShape: { ...shape },
                    startPoint: point
                });
                return;
            }
        }

        // --- Select Tool Logic ---
        if (activeTool === 'select') {
            const targetShapeId = e.target.getAttribute('data-shape-id');
            const targetMeasId = e.target.getAttribute('data-meas-id');

            if (targetShapeId || targetMeasId) {
                const id = targetShapeId || targetMeasId;
                const isSelected = selectedIds.includes(id);

                if (isShift) {
                    setSelectedIds(prev => isSelected ? prev.filter(i => i !== id) : [...prev, id]);
                } else {
                    if (!isSelected) {
                        setSelectedIds([id]);
                    }
                }

                setDragStart(point);
                setIsDraggingItems(true);
            } else {
                if (!isShift) setSelectedIds([]);
                setSelectionStart(point);
            }
            return;
        }

        // --- Shape Tools ---
        if (['rectangle', 'circle', 'line', 'arrow'].includes(activeTool)) {
            setIsDrawing(true);
            setShapeStart(point);
            setCursor(point);
            setSelectedIds([]);
            return;
        }

        // --- Measurement Tools ---
        if (['length', 'calibrate', 'area', 'perimeter', 'count', 'comment'].includes(activeTool)) {
            if (activeTool === 'comment') {
                if (!isDrawing) { setIsDrawing(true); setDrawingPoints([point]); }
            } else if (['length', 'calibrate'].includes(activeTool)) {
                if (!isDrawing) { setIsDrawing(true); setDrawingPoints([point]); }
                else {
                    const start = drawingPoints[0];
                    if (activeTool === 'length') addMeasurement({ id: Date.now().toString(), type: 'length', pageIndex, points: [start, point] });
                    setIsDrawing(false); setDrawingPoints([]);
                }
            } else if (['area', 'perimeter'].includes(activeTool)) {
                if (!isDrawing) { setIsDrawing(true); setDrawingPoints([point]); }
                else setDrawingPoints([...drawingPoints, point]);
            } else if (activeTool === 'count') {
                addMeasurement({ id: Date.now().toString(), type: 'count', pageIndex, point });
            }
        }
    };

    const handleMouseMove = (e) => {
        if (!svgRef.current) return;
        const point = getPagePoint(e, svgRef.current);
        setCursor(point);

        // --- Resizing Logic ---
        if (resizingState) {
            const { id, handle, startShape, startPoint } = resizingState;
            const dx = point.x - startPoint.x;
            const dy = point.y - startPoint.y;

            if (startShape.type === "line" || startShape.type === "arrow") {
                // Line logic (start/end) — keep as-is
                let newStart = { ...startShape.start };
                let newEnd = { ...startShape.end };
                if (handle === "start") {
                    newStart.x += dx;
                    newStart.y += dy;
                }
                if (handle === "end") {
                    newEnd.x += dx;
                    newEnd.y += dy;
                }
                updateShape(id, { start: newStart, end: newEnd });
            } else {
                // Box logic (x, y, w, h) with Rotation — UPDATED to match your “correct” ShapeNode math
                const { x: startX, y: startY, width: w0, height: h0, rotation: rot0 = 0 } = startShape;

                // Rotation handle (keep same behavior)
                if (handle === "rotate") {
                    const cx = startX + w0 / 2;
                    const cy = startY + h0 / 2;
                    const currentAngle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI;
                    let newRot = currentAngle + 90;
                    if (e.shiftKey) newRot = Math.round(newRot / 15) * 15;
                    updateShape(id, { rotation: newRot });
                    return;
                }

                // Project delta into local *unrotated* space using -rotation
                const rotRad = (rot0 * Math.PI) / 180;
                const cos = Math.cos(-rotRad);
                const sin = Math.sin(-rotRad);

                const localDx = dx * cos - dy * sin;
                const localDy = dx * sin + dy * cos;

                // Local bounds (start): L=0, T=0, R=w0, B=h0
                let newL = 0,
                    newT = 0,
                    newR = w0,
                    newB = h0;

                // Apply delta based on handle direction
                if (handle.includes("n")) newT += localDy;
                if (handle.includes("s")) newB += localDy;
                if (handle.includes("w")) newL += localDx;
                if (handle.includes("e")) newR += localDx;

                // Normalize (flip support)
                const finalL = Math.min(newL, newR);
                const finalR = Math.max(newL, newR);
                const finalT = Math.min(newT, newB);
                const finalB = Math.max(newT, newB);

                const finalW = Math.max(1, finalR - finalL);
                const finalH = Math.max(1, finalB - finalT);

                // New local center
                const midX = (finalL + finalR) / 2;
                const midY = (finalT + finalB) / 2;

                // Offset from original local center (w0/2, h0/2)
                const diffX = midX - w0 / 2;
                const diffY = midY - h0 / 2;

                // Rotate that offset back to global space using +rotation
                // We already have cos/sin for -rot, so:
                // cos(+rot) = cos(-rot) ; sin(+rot) = -sin(-rot)
                const posCos = cos;
                const posSin = -sin;

                const globalDiffX = diffX * posCos - diffY * posSin;
                const globalDiffY = diffX * posSin + diffY * posCos;

                const newCenterX = startX + w0 / 2 + globalDiffX;
                const newCenterY = startY + h0 / 2 + globalDiffY;

                const finalX = newCenterX - finalW / 2;
                const finalY = newCenterY - finalH / 2;

                updateShape(id, { x: finalX, y: finalY, width: finalW, height: finalH });
            }
            return;
        }

        if (activeTool === 'select') {
            if (isDraggingItems && dragStart && selectedIds.length > 0) {
                const dx = point.x - dragStart.x;
                const dy = point.y - dragStart.y;

                selectedIds.forEach(id => {
                    const shape = shapes.find(s => s.id === id);
                    if (shape) {
                        if (shape.type === 'line' || shape.type === 'arrow') {
                            updateShape(id, {
                                start: { x: shape.start.x + dx, y: shape.start.y + dy },
                                end: { x: shape.end.x + dx, y: shape.end.y + dy }
                            });
                        } else {
                            updateShape(id, { x: shape.x + dx, y: shape.y + dy });
                        }
                    }
                });
                setDragStart(point);
            }
        }
    };

    const handleMouseUp = (e) => {
        if (e.button !== 0) return; // ✅ left only

        if (resizingState) {
            setResizingState(null);
            return;
        }

        if (activeTool === 'select') {
            if (selectionStart) {
                const point = getPagePoint(e, svgRef.current);
                const x = Math.min(selectionStart.x, point.x);
                const y = Math.min(selectionStart.y, point.y);
                const w = Math.abs(point.x - selectionStart.x);
                const h = Math.abs(point.y - selectionStart.y);

                if (w > 2 && h > 2) {
                    const newSelected = [];
                    pageShapes.forEach(s => {
                        let sb = { x: 0, y: 0, w: 0, h: 0 };
                        if (s.type === 'line' || s.type === 'arrow') {
                            sb.x = Math.min(s.start.x, s.end.x);
                            sb.y = Math.min(s.start.y, s.end.y);
                            sb.w = Math.abs(s.end.x - s.start.x);
                            sb.h = Math.abs(s.end.y - s.start.y);
                        } else {
                            sb.x = s.x; sb.y = s.y; sb.w = s.width; sb.h = s.height;
                        }
                        if (x < sb.x + sb.w && x + w > sb.x && y < sb.y + sb.h && y + h > sb.y) {
                            newSelected.push(s.id);
                        }
                    });

                    if (e.shiftKey) setSelectedIds(prev => [...new Set([...prev, ...newSelected])]);
                    else setSelectedIds(newSelected);
                }
                setSelectionStart(null);
            }
            setIsDraggingItems(false);
            setDragStart(null);
        }

        // Draw Finalize Logic
        if (['rectangle', 'circle', 'line', 'arrow'].includes(activeTool) && isDrawing && shapeStart) {
            const point = getPagePoint(e, svgRef.current);
            if (calculateDistance(shapeStart, point) > 5) {
                let shape = {
                    id: Date.now().toString(),
                    type: activeTool,
                    pageIndex,
                    stroke: 'var(--shape-stroke, #000)',
                    strokeWidth: 2, // Standard width, visual compensation handled by dynamicStroke if needed or just scaling
                    // Actually, if we use viewBox, strokeWidth=2 is 2 Points.
                    // This is ~2/72 inch. It will scale with zoom.
                    // If user wants "Hairline", we use vector-effect.
                    // Let's stick to standard scaling strokes for WYSIWYG printing?
                    // User said "objects are transforming", likely meant shifting.
                    // Let's keep strokes scalable for now, or fixed?
                    // Usually PDF annotations scale stroke.
                    fill: 'none',
                    opacity: 1,
                    rotation: 0
                };

                if (activeTool === 'line' || activeTool === 'arrow') {
                    shape.start = shapeStart; shape.end = point;
                } else {
                    const x = Math.min(shapeStart.x, point.x);
                    const y = Math.min(shapeStart.y, point.y);
                    const w = Math.abs(point.x - shapeStart.x);
                    const h = Math.abs(point.y - shapeStart.y);
                    shape.x = x; shape.y = y; shape.width = w; shape.height = h;
                }
                addShape(shape);
            }
            setIsDrawing(false);
            setShapeStart(null);
        }
        // ... (Keep comment logic)
        if (activeTool === 'comment' && isDrawing) {
            const point = getPagePoint(e, svgRef.current);
            const tip = drawingPoints[0];
            const id = Date.now().toString();
            addMeasurement({ id, type: 'comment', pageIndex, tip, box: { x: point.x, y: point.y, w: 150, h: 50 }, text: '' });
            setIsDrawing(false); setDrawingPoints([]); setEditingId(id);
        }
    };

    const pageMeasurements = measurements.filter(m => m.pageIndex === pageIndex);
    const pageShapes = (shapes || []).filter(s => s.pageIndex === pageIndex);

    const renderSelectionFrame = (s) => {
        const isLine = s.type === 'line' || s.type === 'arrow';

        // ORBIS HANDLES: Square, 8x8px visual (scaled by viewScale)
        // Green fill #b4e6a0, Dark Green Border #3a6b24
        const handleSize = 8 / viewScale;
        const half = handleSize / 2;

        const styleCommon = {
            fill: "#b4e6a0",
            stroke: "#3a6b24",
            strokeWidth: 1 / viewScale,
        };

        const renderHandle = (x, y, cursor, hName) => (
            <rect
                key={hName}
                x={x - half}
                y={y - half}
                width={handleSize}
                height={handleSize}
                {...styleCommon}
                cursor={cursor}
                data-resize-id={s.id}
                data-resize-handle={hName}
            />
        );

        const handles = [];

        if (isLine) {
            handles.push(renderHandle(s.start.x, s.start.y, "move", "start"));
            handles.push(renderHandle(s.end.x, s.end.y, "move", "end"));
        } else {
            const { width: w, height: h } = s;
            // Bounding Box (unscaled stroke)
            handles.push(<rect key="frame" x={0} y={0} width={w} height={h} fill="none" stroke="var(--primary-color)" strokeWidth={1 / viewScale} pointerEvents="none" vectorEffect="non-scaling-stroke" />);

            // 8 Resize Handles
            handles.push(renderHandle(0, 0, "nw-resize", "nw"));
            handles.push(renderHandle(w / 2, 0, "n-resize", "n"));
            handles.push(renderHandle(w, 0, "ne-resize", "ne"));
            handles.push(renderHandle(w, h / 2, "e-resize", "e"));
            handles.push(renderHandle(w, h, "se-resize", "se"));
            handles.push(renderHandle(w / 2, h, "s-resize", "s"));
            handles.push(renderHandle(0, h, "sw-resize", "sw"));
            handles.push(renderHandle(0, h / 2, "w-resize", "w"));

            // Rotation Handle
            // Circle, top center, offset by 20px visual
            const rotOffset = 20 / viewScale;
            handles.push(
                <circle
                    key="rotate"
                    cx={w / 2}
                    cy={-rotOffset}
                    r={4 / viewScale} // 8px diameter
                    fill="#b4e6a0"
                    stroke="#3a6b24"
                    strokeWidth={1 / viewScale}
                    cursor="grab"
                    data-resize-id={s.id}
                    data-resize-handle="rotate"
                />
            );
        }

        return <g>{handles}</g>;
    };

    const renderShape = (s) => {
        const isSelected = selectedIds.includes(s.id);
        const style = {
            stroke: s.stroke,
            strokeWidth: s.strokeWidth, // Let it scale? Yes.
            fill: s.fill,
            opacity: s.opacity,
            cursor: activeTool === 'select' ? 'move' : 'default',
            pointerEvents: 'all'
        };

        const props = { 'data-shape-id': s.id, ...style };

        // ... (Render logic same mostly)
        // Note: vector-effect="non-scaling-stroke" removed to allow print-accurate scaling if desired.
        // Or keep it? If zoom in, stroke stays thin?
        // User probably wants WYSIWYG. Line width 2 = 2 points = 1/36 inch. 
        // If zoom in, it should look thick.
        // So NO vector-effect.

        let elem = null;
        if (s.type === 'rectangle') elem = <rect x={0} y={0} width={s.width} height={s.height} {...props} />;
        else if (s.type === 'circle') {
            const cx = s.width / 2;
            const cy = s.height / 2;
            elem = <ellipse cx={cx} cy={cy} rx={s.width / 2} ry={s.height / 2} {...props} />;
        }
        else if (s.type === 'line') elem = <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} {...props} strokeLinecap="round" />;
        else if (s.type === 'arrow') {
            elem = (
                <g data-shape-id={s.id}>
                    <defs>
                        <marker id={`arrow-${s.id}`} markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                            <polygon points="0 0, 6 2, 0 4" fill={style.stroke} />
                        </marker>
                    </defs>
                    <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} {...props} markerEnd={`url(#arrow-${s.id})`} strokeLinecap="round" />
                    <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} stroke="transparent" strokeWidth="15" pointerEvents="all" data-shape-id={s.id} />
                </g>
            );
        }

        // For Lines/Arrows, return directly (no rotation/group yet)
        if (s.type === 'line' || s.type === 'arrow') {
            return (
                <g key={s.id}>
                    {elem}
                    {isSelected && renderSelectionFrame(s)}
                </g>
            );
        }

        // For Rect/Circle: Wrap in Group with Transform
        const rotation = s.rotation || 0;

        return (
            <g key={s.id} transform={`translate(${s.x}, ${s.y}) rotate(${rotation}, ${s.width / 2}, ${s.height / 2})`}>
                {elem}
                {isSelected && renderSelectionFrame(s)}
            </g>
        );
    };

    return (
        <svg
            ref={svgRef}
            className={classes.overlaySvg}
            width={width}
            height={height}
            viewBox={viewBox}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onDoubleClick={() => finishDrawing()}
            onMouseMove={handleMouseMove}
        >
            {/* Shapes */}
            {pageShapes.map(renderShape)}

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
                    const pointsStr = m.points.map(p => `${p.x},${p.y} `).join(' ');
                    return (
                        <g key={m.id}>
                            <polygon points={pointsStr} fill="rgba(108, 176, 86, 0.3)" stroke="var(--primary-color)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <text x={m.points[0].x} y={m.points[0].y} fill="var(--primary-color)" fontSize="14">
                                {(calculatePolygonArea(m.points) / (scale * scale)).toFixed(2)} {unit}²
                            </text>
                        </g>
                    );
                }
                if (m.type === 'perimeter') {
                    const pointsStr = m.points.map(p => `${p.x},${p.y} `).join(' ');
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
                    return <circle key={m.id} cx={m.point.x} cy={m.point.y} r={8} fill="var(--primary-color)" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />;
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
                                        style={{ width: '100%', height: '100%', resize: 'none', border: '1px solid var(--primary-color)', padding: '4px', fontSize: '12px' }}
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

            Drawing Previews
            {isDrawing && cursor && (
                <g pointerEvents="none">
                    {/* Measurement Previews */}
                    {['length', 'calibrate', 'comment'].includes(activeTool) && drawingPoints.length > 0 && (
                        <line x1={drawingPoints[0].x} y1={drawingPoints[0].y} x2={cursor.x} y2={cursor.y} stroke={activeTool === 'comment' ? '#333' : 'red'} strokeDasharray="5,5" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    )}
                    {activeTool === 'comment' && drawingPoints.length > 0 && (
                        <rect x={cursor.x} y={cursor.y} width={150} height={50} fill="rgba(255,255,255,0.5)" stroke="#333" strokeDasharray="3,3" />
                    )}
                    {['area', 'perimeter'].includes(activeTool) && drawingPoints.length > 0 && (
                        <>
                            <polyline points={[...drawingPoints.map(p => `${p.x},${p.y}`), `${cursor.x},${cursor.y}`].join(' ')} fill={activeTool === 'area' ? "rgba(108, 176, 86, 0.3)" : "none"} stroke="red" strokeDasharray="5,5" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            {drawingPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="white" stroke="red" vectorEffect="non-scaling-stroke" />)}
                        </>
                    )}

                    {/* Shape Previews */}
                    {activeTool === 'rectangle' && shapeStart && (
                        <rect x={Math.min(shapeStart.x, cursor.x)} y={Math.min(shapeStart.y, cursor.y)} width={Math.abs(cursor.x - shapeStart.x)} height={Math.abs(cursor.y - shapeStart.y)} stroke="var(--primary-color)" strokeWidth="2" fill="none" strokeDasharray="5,5" />
                    )}
                    {activeTool === 'circle' && shapeStart && (
                        <ellipse cx={(shapeStart.x + cursor.x) / 2} cy={(shapeStart.y + cursor.y) / 2} rx={Math.abs(cursor.x - shapeStart.x) / 2} ry={Math.abs(cursor.y - shapeStart.y) / 2} stroke="var(--primary-color)" strokeWidth="2" fill="none" strokeDasharray="5,5" />
                    )}
                    {(activeTool === 'line' || activeTool === 'arrow') && shapeStart && (
                        <line x1={shapeStart.x} y1={shapeStart.y} x2={cursor.x} y2={cursor.y} stroke="var(--primary-color)" strokeWidth="2" strokeDasharray="5,5" />
                    )}
                </g>
            )}

            {/* Selection Box */}
            {selectionStart && cursor && activeTool === 'select' && (
                <rect
                    x={Math.min(selectionStart.x, cursor.x)}
                    y={Math.min(selectionStart.y, cursor.y)}
                    width={Math.abs(cursor.x - selectionStart.x)}
                    height={Math.abs(cursor.y - selectionStart.y)}
                    fill="rgba(0, 120, 215, 0.1)"
                    stroke="rgba(0, 120, 215, 0.5)"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                    pointerEvents="none"
                />
            )}
        </svg>
    );
};
export default OverlayLayer;
