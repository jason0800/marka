import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import useAppStore from "../stores/useAppStore";
import { calculateDistance, calculatePolygonArea } from "../geometry/transforms";
import { findShapeAtPoint } from "../geometry/hitTest";
import OverlayCanvasLayer from "./OverlayCanvasLayer";

const OverlayLayer = ({ page, width, height, viewScale = 1.0 }) => {
    const {
        activeTool,
        setActiveTool,
        addMeasurement,
        updateMeasurement,
        deleteMeasurement,
        measurements,
        calibrationScales,
        pageUnits,
        shapes,
        addShape,
        updateShape,
        deleteShape,
        selectedIds,
        setSelectedIds,
        pushHistory,
        undo,
        redo,
        defaultShapeStyle,
    } = useAppStore();

    const svgRef = useRef(null);

    // ---- Page meta (PDF points) ----
    const pageIndex = page.pageNumber;
    const calibrationScale = calibrationScales[pageIndex] || 1.0; // (pdfPoints per unit) OR (px per unit) - whatever you defined
    const unit = pageUnits[pageIndex] || "px";

    // Keep viewport + viewBox stable (avoid calling getViewport every render)
    const unscaledViewport = useMemo(() => page.getViewport({ scale: 1.0 }), [page]);
    const viewBox = useMemo(
        () => `0 0 ${unscaledViewport.width} ${unscaledViewport.height}`,
        [unscaledViewport.width, unscaledViewport.height]
    );

    // ---- Helpers: unit conversion (assumes calibrationScale is "pdfPoints per unit") ----
    const toUnits = useCallback(
        (pdfPoints) => pdfPoints / Math.max(1e-9, calibrationScale),
        [calibrationScale]
    );
    const toUnits2 = useCallback(
        (pdfPoints2) => pdfPoints2 / Math.max(1e-9, calibrationScale * calibrationScale),
        [calibrationScale]
    );

    // ---- Visual sizing that stays constant on screen ----
    const nonScalingStroke = useMemo(() => 2 / Math.max(1e-6, viewScale), [viewScale]);
    const handleSize = useMemo(() => 8 / Math.max(1e-6, viewScale), [viewScale]);
    const handleHalf = handleSize / 2;
    const rotOffset = useMemo(() => 20 / Math.max(1e-6, viewScale), [viewScale]);

    // ---- Interaction state ----
    const [isDrawing, setIsDrawingState] = useState(false);
    // Use a ref to track drawing state synchronously to prevent race conditions/double-fires
    const isDrawingRef = useRef(false);

    const setIsDrawing = useCallback((val) => {
        isDrawingRef.current = val;
        setIsDrawingState(val);
    }, []);

    const [drawingPoints, setDrawingPoints] = useState([]); // for area/perimeter/length/comment
    const [cursor, setCursor] = useState(null);
    const [editingId, setEditingId] = useState(null);

    // Shape draw (rect/circle/line/arrow)
    const [shapeStart, setShapeStart] = useState(null);

    // Selection / drag
    const [selectionStart, setSelectionStart] = useState(null);
    const [dragStart, setDragStart] = useState(null);
    const [isDraggingItems, setIsDraggingItems] = useState(false);

    // Resize
    const [resizingState, setResizingState] = useState(null); // { id, handle, startShape, startPoint }

    const pageMeasurements = useMemo(
        () => (measurements || []).filter((m) => m.pageIndex === pageIndex),
        [measurements, pageIndex]
    );
    const pageShapes = useMemo(
        () => (shapes || []).filter((s) => s.pageIndex === pageIndex),
        [shapes, pageIndex]
    );

    // ---- Coordinate mapping: Screen -> SVG viewBox coords (PDF points) ----
    const getPagePoint = useCallback((e) => {
        const svg = svgRef.current;
        if (!svg) return null;
        const point = svg.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        const matrix = svg.getScreenCTM()?.inverse();
        if (!matrix) return null;
        return point.matrixTransform(matrix);
    }, []);

    const finishDrawing = useCallback(() => {
        if (!isDrawingRef.current) return;

        if (activeTool === "area" && drawingPoints.length >= 3) {
            addMeasurement({
                id: crypto.randomUUID(),
                type: "area",
                pageIndex,
                points: [...drawingPoints],
            });
            pushHistory();
        } else if (activeTool === "perimeter" && drawingPoints.length >= 2) {
            addMeasurement({
                id: crypto.randomUUID(),
                type: "perimeter",
                pageIndex,
                points: [...drawingPoints],
            });
            pushHistory();
        }

        setIsDrawing(false);
        setDrawingPoints([]);
        setShapeStart(null);

        // Auto-switch to select mode after drawing
        setActiveTool("select");
    }, [activeTool, drawingPoints, addMeasurement, pageIndex, pushHistory, setActiveTool, setIsDrawing]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKeyDown = (e) => {
            if (editingId) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === "Enter") finishDrawing();

            if (e.key === "Delete" || e.key === "Backspace") {
                if (selectedIds.length > 0) {
                    // Check if shapes or measurements
                    const shapeIds = selectedIds.filter(id => pageShapes.some(s => s.id === id));
                    const measIds = selectedIds.filter(id => pageMeasurements.some(m => m.id === id));

                    shapeIds.forEach(id => deleteShape(id));
                    measIds.forEach(id => deleteMeasurement(id));
                    setSelectedIds([]);
                    pushHistory();
                }
            }

            if (e.key === "Escape") {
                setIsDrawing(false);
                setDrawingPoints([]);
                setShapeStart(null);
                setEditingId(null);
                setResizingState(null);
                setSelectionStart(null);
                setIsDraggingItems(false);
                setDragStart(null);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [editingId, finishDrawing, selectedIds, pageShapes, pageMeasurements, deleteShape, deleteMeasurement, setSelectedIds, pushHistory, undo, redo, setIsDrawing]);

    // ---- Mouse handlers ----
    const handleMouseDown = (e) => {
        // Left click only
        if (e.button !== 0) {
            if (e.button === 1) e.preventDefault();
            return;
        }

        // ignore textarea/foreignObject editing interactions
        if (e.target.tagName === "TEXTAREA" || e.target.closest(".foreignObject")) return;

        const point = getPagePoint(e);
        if (!point) return;

        const isShift = e.shiftKey;

        // 1) Resize handles first
        const resizeHandle = e.target.getAttribute("data-resize-handle");
        const resizeId = e.target.getAttribute("data-resize-id");
        if (resizeHandle && resizeId) {
            const shape = pageShapes.find((s) => s.id === resizeId);
            if (shape) {
                pushHistory(); // Save state before resizing
                setResizingState({
                    id: resizeId,
                    handle: resizeHandle,
                    startShape: JSON.parse(JSON.stringify(shape)),
                    startPoint: { x: point.x, y: point.y },
                });
            }
            return;
        }

        // 2) Select tool
        if (activeTool === "select") {
            const targetShapeId = e.target.getAttribute("data-shape-id");
            const targetMeasId = e.target.getAttribute("data-meas-id");
            const hitId = targetShapeId || targetMeasId;

            if (hitId) {
                // DOM Hit (SVG element)
                const isSelected = selectedIds.includes(hitId);

                if (isShift) {
                    setSelectedIds((prev) =>
                        isSelected ? prev.filter((id) => id !== hitId) : [...prev, hitId]
                    );
                } else {
                    if (!isSelected) setSelectedIds([hitId]);
                }

                setDragStart({ x: point.x, y: point.y });
                setIsDraggingItems(true);
                pushHistory();
            } else {
                // CANVAS Hit Test (Manual)
                const hitShape = findShapeAtPoint(point, pageShapes);
                if (hitShape) {
                    // Found a shape on canvas!
                    const isSelected = selectedIds.includes(hitShape.id);
                    if (isShift) {
                        setSelectedIds((prev) =>
                            isSelected ? prev.filter((id) => id !== hitShape.id) : [...prev, hitShape.id]
                        );
                    } else {
                        setSelectedIds([hitShape.id]);
                    }
                    // Prepare drag immediately?
                    setDragStart({ x: point.x, y: point.y });
                    setIsDraggingItems(true);
                    pushHistory();
                    return;
                }

                // If no hit, box selection
                if (!isShift) setSelectedIds([]);
                setSelectionStart({ x: point.x, y: point.y });
            }
            return;
        }

        // 3) Shape tools (start drag)
        if (["rectangle", "circle", "line", "arrow"].includes(activeTool)) {
            setIsDrawing(true);
            setShapeStart({ x: point.x, y: point.y });
            setCursor({ x: point.x, y: point.y });
            setSelectedIds([]);
            return;
        }

        // 4) Measurement tools
        if (["length", "calibrate", "area", "perimeter", "count", "comment"].includes(activeTool)) {
            if (activeTool === "count") {
                addMeasurement({ id: crypto.randomUUID(), type: "count", pageIndex, point });
                pushHistory();
                setActiveTool("select"); // Auto-switch to select
                return;
            }

            if (activeTool === "comment") {
                if (!isDrawingRef.current) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]); // tip
                }
                return;
            }

            if (activeTool === "length" || activeTool === "calibrate") {
                if (!isDrawingRef.current) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]);
                } else {
                    const start = drawingPoints[0];
                    const end = { x: point.x, y: point.y };

                    if (activeTool === "length") {
                        addMeasurement({
                            id: crypto.randomUUID(),
                            type: "length",
                            pageIndex,
                            points: [start, end],
                        });
                        pushHistory();
                        setActiveTool("select"); // Auto-switch to select
                    }

                    // If calibrate: you'll likely show a dialog to set calibrationScale.
                    // Leaving it as "length-like" capture for now.

                    setIsDrawing(false);
                    setDrawingPoints([]);
                }
                return;
            }

            if (activeTool === "area" || activeTool === "perimeter") {
                if (!isDrawingRef.current) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]);
                } else {
                    setDrawingPoints((prev) => [...prev, { x: point.x, y: point.y }]);
                }
            }
        }
    };

    const handleMouseMove = (e) => {
        const point = getPagePoint(e);
        if (!point) return;

        setCursor({ x: point.x, y: point.y });

        // ---- resizing ----
        if (resizingState) {
            const { id, handle, startShape, startPoint } = resizingState;
            const dx = point.x - startPoint.x;
            const dy = point.y - startPoint.y;

            if (startShape.type === "line" || startShape.type === "arrow") {
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
                return;
            }

            const { x: startX, y: startY, width: w0, height: h0, rotation: rot0 = 0 } = startShape;

            if (handle === "rotate") {
                const cx = startX + w0 / 2;
                const cy = startY + h0 / 2;
                const currentAngle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI;
                let newRot = currentAngle + 90;
                if (e.shiftKey) newRot = Math.round(newRot / 15) * 15;
                updateShape(id, { rotation: newRot });
                return;
            }

            // project delta into local space using -rotation
            const rotRad = (rot0 * Math.PI) / 180;
            const cos = Math.cos(-rotRad);
            const sin = Math.sin(-rotRad);

            const localDx = dx * cos - dy * sin;
            const localDy = dx * sin + dy * cos;

            // local bounds
            let newL = 0,
                newT = 0,
                newR = w0,
                newB = h0;

            if (handle.includes("n")) newT += localDy;
            if (handle.includes("s")) newB += localDy;
            if (handle.includes("w")) newL += localDx;
            if (handle.includes("e")) newR += localDx;

            const finalL = Math.min(newL, newR);
            const finalR = Math.max(newL, newR);
            const finalT = Math.min(newT, newB);
            const finalB = Math.max(newT, newB);

            const finalW = Math.max(1, finalR - finalL);
            const finalH = Math.max(1, finalB - finalT);

            const midX = (finalL + finalR) / 2;
            const midY = (finalT + finalB) / 2;

            const diffX = midX - w0 / 2;
            const diffY = midY - h0 / 2;

            // rotate offset back by +rot
            const posCos = cos;
            const posSin = -sin;

            const globalDiffX = diffX * posCos - diffY * posSin;
            const globalDiffY = diffX * posSin + diffY * posCos;

            const newCenterX = startX + w0 / 2 + globalDiffX;
            const newCenterY = startY + h0 / 2 + globalDiffY;

            const finalX = newCenterX - finalW / 2;
            const finalY = newCenterY - finalH / 2;

            updateShape(id, { x: finalX, y: finalY, width: finalW, height: finalH });
            return;
        }

        // ---- dragging selected items ----
        if (activeTool === "select" && isDraggingItems && dragStart && selectedIds.length > 0) {
            const dx = point.x - dragStart.x;
            const dy = point.y - dragStart.y;

            selectedIds.forEach((id) => {
                const shape = pageShapes.find((s) => s.id === id);
                if (!shape) return;

                if (shape.type === "line" || shape.type === "arrow") {
                    updateShape(id, {
                        start: { x: shape.start.x + dx, y: shape.start.y + dy },
                        end: { x: shape.end.x + dx, y: shape.end.y + dy },
                    });
                } else {
                    updateShape(id, { x: shape.x + dx, y: shape.y + dy });
                }
            });

            setDragStart({ x: point.x, y: point.y });
        }
    };

    const handleMouseUp = (e) => {
        if (e.button !== 0) return;

        const point = getPagePoint(e);

        // End resize
        if (resizingState) {
            setResizingState(null);
            return;
        }

        // Selection box finalize
        if (activeTool === "select") {
            if (selectionStart && point) {
                const x = Math.min(selectionStart.x, point.x);
                const y = Math.min(selectionStart.y, point.y);
                const w = Math.abs(point.x - selectionStart.x);
                const h = Math.abs(point.y - selectionStart.y);

                if (w > 2 && h > 2) {
                    const newSelected = [];

                    pageShapes.forEach((s) => {
                        let sb = { x: 0, y: 0, w: 0, h: 0 };
                        if (s.type === "line" || s.type === "arrow") {
                            sb.x = Math.min(s.start.x, s.end.x);
                            sb.y = Math.min(s.start.y, s.end.y);
                            sb.w = Math.abs(s.end.x - s.start.x);
                            sb.h = Math.abs(s.end.y - s.start.y);
                        } else {
                            sb.x = s.x;
                            sb.y = s.y;
                            sb.w = s.width;
                            sb.h = s.height;
                        }

                        if (x < sb.x + sb.w && x + w > sb.x && y < sb.y + sb.h && y + h > sb.y) {
                            newSelected.push(s.id);
                        }
                    });

                    if (e.shiftKey) setSelectedIds((prev) => [...new Set([...prev, ...newSelected])]);
                    else setSelectedIds(newSelected);
                }

                setSelectionStart(null);
            }

            setIsDraggingItems(false);
            setDragStart(null);
            return;
        }

        // finalize shape draw
        if (["rectangle", "circle", "line", "arrow"].includes(activeTool) && isDrawingRef.current && shapeStart && point) {
            if (calculateDistance(shapeStart, point) > 5) {
                const id = crypto.randomUUID();

                const base = {
                    id,
                    type: activeTool,
                    pageIndex,
                    ...defaultShapeStyle, // Sticky properties
                    rotation: 0,
                };

                if (activeTool === "line" || activeTool === "arrow") {
                    addShape({ ...base, start: shapeStart, end: { x: point.x, y: point.y } });
                } else {
                    const x = Math.min(shapeStart.x, point.x);
                    const y = Math.min(shapeStart.y, point.y);
                    const w = Math.abs(point.x - shapeStart.x);
                    const h = Math.abs(point.y - shapeStart.y);
                    addShape({ ...base, x, y, width: w, height: h });
                }
                pushHistory(); // Save state after adding shape
                setActiveTool("select"); // Auto-switch to select
            }

            setIsDrawing(false);
            setShapeStart(null);
            return;
        }

        // finalize comment (tip -> release defines box)
        if (activeTool === "comment" && isDrawingRef.current && drawingPoints.length > 0 && point) {
            const tip = drawingPoints[0];
            const id = crypto.randomUUID();
            addMeasurement({
                id,
                type: "comment",
                pageIndex,
                tip,
                box: { x: point.x, y: point.y, w: 150, h: 50 },
                text: "",
            });
            pushHistory(); // Save state after adding comment
            setIsDrawing(false);
            setDrawingPoints([]);
            setEditingId(id);
        }
    };

    // ---- rendering helpers ----
    const renderSelectionFrame = (s) => {
        const isLine = s.type === "line" || s.type === "arrow";

        const handleStyle = {
            fill: "#b4e6a0",
            stroke: "#3a6b24",
            strokeWidth: 1 / Math.max(1e-6, viewScale),
            vectorEffect: "non-scaling-stroke",
        };

        const renderHandle = (x, y, cursorCss, hName) => (
            <rect
                key={hName}
                x={x - handleHalf}
                y={y - handleHalf}
                width={handleSize}
                height={handleSize}
                cursor={cursorCss}
                data-resize-id={s.id}
                data-resize-handle={hName}
                {...handleStyle}
            />
        );

        if (isLine) {
            return (
                <g>
                    {renderHandle(s.start.x, s.start.y, "move", "start")}
                    {renderHandle(s.end.x, s.end.y, "move", "end")}
                </g>
            );
        }

        const w = s.width;
        const h = s.height;
        const padding = 6 / Math.max(1e-6, viewScale);

        return (
            <g>
                <rect
                    x={-padding}
                    y={-padding}
                    width={w + padding * 2}
                    height={h + padding * 2}
                    fill="none"
                    stroke="var(--primary-color)"
                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
                {renderHandle(-padding, -padding, "nw-resize", "nw")}
                {renderHandle(w / 2, -padding, "n-resize", "n")}
                {renderHandle(w + padding, -padding, "ne-resize", "ne")}
                {renderHandle(w + padding, h / 2, "e-resize", "e")}
                {renderHandle(w + padding, h + padding, "se-resize", "se")}
                {renderHandle(w / 2, h + padding, "s-resize", "s")}
                {renderHandle(-padding, h + padding, "sw-resize", "sw")}
                {renderHandle(-padding, h / 2, "w-resize", "w")}

                <circle
                    cx={w / 2}
                    cy={-rotOffset - padding}
                    r={4 / Math.max(1e-6, viewScale)}
                    fill="#b4e6a0"
                    stroke="#3a6b24"
                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                    vectorEffect="non-scaling-stroke"
                    cursor="grab"
                    data-resize-id={s.id}
                    data-resize-handle="rotate"
                />
            </g>
        );
    };

    const renderShape = (s) => {
        const isSelected = selectedIds.includes(s.id);
        const commonProps = {
            "data-shape-id": s.id,
            stroke: s.stroke,
            strokeWidth: s.strokeWidth,
            strokeDasharray: s.strokeDasharray === 'none' ? undefined : s.strokeDasharray,
            fill: s.fill,
            opacity: s.opacity,
            cursor: activeTool === "select" ? "move" : "default",
            pointerEvents: "all",
            strokeLinecap: "round",
            strokeLinejoin: "round",
        };

        if (s.type === "line") {
            return (
                <g key={s.id}>
                    <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} {...commonProps} strokeLinecap="round" />
                    {isSelected && renderSelectionFrame(s)}
                </g>
            );
        }

        if (s.type === "arrow") {
            return (
                <g key={s.id} data-shape-id={s.id}>
                    <defs>
                        <marker id={`arrow-${s.id}`} markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                            <polygon points="0 0, 6 2, 0 4" fill={s.stroke} />
                        </marker>
                    </defs>

                    <line
                        x1={s.start.x}
                        y1={s.start.y}
                        x2={s.end.x}
                        y2={s.end.y}
                        {...commonProps}
                        markerEnd={`url(#arrow-${s.id})`}
                        strokeLinecap="round"
                    />

                    {/* fat hit-area */}
                    <line
                        x1={s.start.x}
                        y1={s.start.y}
                        x2={s.end.x}
                        y2={s.end.y}
                        stroke="transparent"
                        strokeWidth={15 / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="all"
                        data-shape-id={s.id}
                        style={{ cursor: activeTool === "select" ? "move" : "default" }}
                    />

                    {isSelected && renderSelectionFrame(s)}
                </g>
            );
        }

        // rect/circle: group transform
        const rotation = s.rotation || 0;

        let elem = null;
        if (s.type === "rectangle") {
            elem = <rect x={0} y={0} width={s.width} height={s.height} {...commonProps} />;
        } else if (s.type === "circle") {
            elem = <ellipse cx={s.width / 2} cy={s.height / 2} rx={s.width / 2} ry={s.height / 2} {...commonProps} />;
        }

        return (
            <g
                key={s.id}
                transform={`translate(${s.x}, ${s.y}) rotate(${rotation}, ${s.width / 2}, ${s.height / 2})`}
            >
                {elem}
                {isSelected && renderSelectionFrame(s)}
            </g>
        );
    };

    const renderMeasurement = (m) => {
        const measCommon = {
            "data-meas-id": m.id,
            cursor: activeTool === "select" ? "move" : "default",
        };

        if (m.type === "length" && m.points?.length === 2) {
            const a = m.points[0];
            const b = m.points[1];
            const dist = calculateDistance(a, b);

            return (
                <g key={m.id} {...measCommon}>
                    <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#e74c3c"
                        strokeWidth={nonScalingStroke}
                        vectorEffect="non-scaling-stroke"
                    />
                    <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 6 / Math.max(1e-6, viewScale)}
                        fill="#e74c3c"
                        fontSize={14 / Math.max(1e-6, viewScale)}
                        textAnchor="middle"
                        vectorEffect="non-scaling-stroke"
                    >
                        {toUnits(dist).toFixed(2)} {unit}
                    </text>
                </g>
            );
        }

        if (m.type === "area" && m.points?.length >= 3) {
            const pointsStr = m.points.map((p) => `${p.x},${p.y}`).join(" ");
            const area = calculatePolygonArea(m.points);

            return (
                <g key={m.id} {...measCommon}>
                    <polygon
                        points={pointsStr}
                        fill="rgba(108, 176, 86, 0.25)"
                        stroke="var(--primary-color)"
                        strokeWidth={nonScalingStroke}
                        vectorEffect="non-scaling-stroke"
                    />
                    <text
                        x={m.points[0].x}
                        y={m.points[0].y - 8 / Math.max(1e-6, viewScale)}
                        fill="var(--primary-color)"
                        fontSize={14 / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                    >
                        {toUnits2(area).toFixed(2)} {unit}²
                    </text>
                </g>
            );
        }

        if (m.type === "perimeter" && m.points?.length >= 2) {
            const pointsStr = m.points.map((p) => `${p.x},${p.y}`).join(" ");
            let len = 0;
            for (let i = 0; i < m.points.length - 1; i++) {
                len += calculateDistance(m.points[i], m.points[i + 1]);
            }

            return (
                <g key={m.id} {...measCommon}>
                    <polyline
                        points={pointsStr}
                        fill="none"
                        stroke="#9b59b6"
                        strokeWidth={nonScalingStroke}
                        vectorEffect="non-scaling-stroke"
                    />
                    <text
                        x={m.points[0].x}
                        y={m.points[0].y - 8 / Math.max(1e-6, viewScale)}
                        fill="#9b59b6"
                        fontSize={14 / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                    >
                        {toUnits(len).toFixed(2)} {unit}
                    </text>
                </g>
            );
        }

        if (m.type === "count" && m.point) {
            return (
                <circle
                    key={m.id}
                    {...measCommon}
                    cx={m.point.x}
                    cy={m.point.y}
                    r={8 / Math.max(1e-6, viewScale)}
                    fill="var(--primary-color)"
                    stroke="white"
                    strokeWidth={2 / Math.max(1e-6, viewScale)}
                    vectorEffect="non-scaling-stroke"
                />
            );
        }

        if (m.type === "comment" && m.tip && m.box) {
            const isEditing = editingId === m.id;
            const midX = m.box.x + m.box.w / 2;
            const midY = m.box.y + m.box.h / 2;

            return (
                <g key={m.id} {...measCommon}>
                    <line
                        x1={m.tip.x}
                        y1={m.tip.y}
                        x2={midX}
                        y2={midY}
                        stroke="#333"
                        strokeWidth={1 / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                    />
                    <circle
                        cx={m.tip.x}
                        cy={m.tip.y}
                        r={3 / Math.max(1e-6, viewScale)}
                        fill="#333"
                        vectorEffect="non-scaling-stroke"
                    />
                    <foreignObject
                        x={m.box.x}
                        y={m.box.y}
                        width={m.box.w}
                        height={m.box.h}
                        className="foreignObject"
                    >
                        {isEditing ? (
                            <textarea
                                autoFocus
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    resize: "none",
                                    border: "1px solid var(--primary-color)",
                                    padding: "4px",
                                    fontSize: "12px",
                                }}
                                defaultValue={m.text}
                                onBlur={(ev) => {
                                    updateMeasurement(m.id, { text: ev.target.value });
                                    setEditingId(null);
                                }}
                                onKeyDown={(ev) => {
                                    if (ev.key === "Escape") setEditingId(null);
                                }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    border: "1px solid #ccc",
                                    background: "rgba(255,255,255,0.92)",
                                    padding: "4px",
                                    fontSize: "12px",
                                    overflow: "hidden",
                                    color: "black",
                                }}
                                onClick={(ev) => {
                                    ev.stopPropagation();
                                    setEditingId(m.id);
                                }}
                            >
                                {m.text || "Enter comment..."}
                            </div>
                        )}
                    </foreignObject>
                </g>
            );
        }

        return null;
    };

    return (
        <div style={{ position: "absolute", top: 0, left: 0, width, height, pointerEvents: 'none' }}>
            {/* 1. Canvas Layer (Static shapes) */}
            <OverlayCanvasLayer
                width={width}
                height={height}
                viewScale={viewScale}
                shapes={pageShapes}
                measurements={pageMeasurements}
                selectedIds={selectedIds}
                pageIndex={pageIndex}
                pageUnits={pageUnits}
                calibrationScales={calibrationScales}
            />

            {/* 2. SVG Layer (Interactive/Selected shapes + Tools) */}
            <svg
                ref={svgRef}
                width={width}
                height={height}
                viewBox={viewBox}
                style={{ position: "absolute", top: 0, left: 0, pointerEvents: "all" }} // SVG must catch clicks for handles
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onDoubleClick={() => finishDrawing()}
            >
                <defs>
                    {/* Markers could be large if we render all of them? No, define one generic? 
                             Current code defines markers per-ID. 
                             If shapes are on Canvas, we don't need markers here unless they are selected.
                             We only render selected shapes here. */}
                </defs>

                {/* RENDER ONLY SELECTED SHAPES in SVG */}
                {pageShapes.filter(s => selectedIds.includes(s.id)).map(s => renderShape(s))}

                {/* Render active drawing shape */}
                {isDrawingRef.current && shapeStart && cursor && (
                    (() => {
                        // Temporary shape for preview
                        const tempId = "temp-draw";
                        let s = { id: tempId, type: activeTool, ...defaultShapeStyle, stroke: defaultShapeStyle.stroke, start: shapeStart, end: cursor, x: 0, y: 0, width: 0, height: 0, rotation: 0 };

                        if (activeTool === "line" || activeTool === "arrow") {
                            // s is set needed props
                        } else {
                            const x = Math.min(shapeStart.x, cursor.x);
                            const y = Math.min(shapeStart.y, cursor.y);
                            const w = Math.abs(cursor.x - shapeStart.x);
                            const h = Math.abs(cursor.y - shapeStart.y);
                            s.x = x; s.y = y; s.width = w; s.height = h;
                        }
                        return renderShape(s);
                    })()
                )}

                {/* Measurements - Render ONLY selected or 'comment' box if needed? 
                    Canvas renders unselected measurements.
                */}
                {pageMeasurements.filter(m => selectedIds.includes(m.id) || m.type === "comment").map(m => renderMeasurement(m))}

                {/* Drawing feedback for measurements */}
                {isDrawingRef.current && activeTool === "choice" ? null : null}
                {/* (drawingPoints rendering logic if needed, e.g. polyline for area/perimeter) */}
                {isDrawingRef.current && drawingPoints.length > 0 && (
                    <g pointerEvents="none">
                        {/* Render partial polyline */}
                        {activeTool === "area" || activeTool === "perimeter" ? (
                            <>
                                <polyline
                                    points={[...drawingPoints, cursor].map(p => p ? `${p.x},${p.y}` : "").join(" ")}
                                    fill={activeTool === "area" ? "rgba(108,176,86,0.25)" : "none"}
                                    stroke="var(--primary-color)"
                                    strokeWidth={2 / Math.max(1e-6, viewScale)}
                                />
                                {drawingPoints.map((p, i) => (
                                    <circle
                                        key={i}
                                        cx={p.x}
                                        cy={p.y}
                                        r={3 / Math.max(1e-6, viewScale)}
                                        fill="white"
                                        stroke="#e74c3c"
                                        strokeWidth={1 / Math.max(1e-6, viewScale)}
                                        vectorEffect="non-scaling-stroke"
                                    />
                                ))}
                            </>
                        ) : null}
                        {/* Render line for length */}
                        {activeTool === "length" && cursor ? (
                            <line x1={drawingPoints[0].x} y1={drawingPoints[0].y} x2={cursor.x} y2={cursor.y} stroke="#e74c3c" strokeWidth={2 / Math.max(1e-6, viewScale)} />
                        ) : null}

                        {/* Comment preview */}
                        {activeTool === "comment" && drawingPoints.length > 0 && (
                            <rect
                                x={cursor.x}
                                y={cursor.y}
                                width={150}
                                height={50}
                                fill="rgba(255,255,255,0.5)"
                                stroke="#333"
                                strokeDasharray="3,3"
                                strokeWidth={1 / Math.max(1e-6, viewScale)}
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                    </g>
                )}

                {/* Selection Box */}
                {selectionStart && cursor && (
                    <rect
                        x={Math.min(selectionStart.x, cursor.x)}
                        y={Math.min(selectionStart.y, cursor.y)}
                        width={Math.abs(cursor.x - selectionStart.x)}
                        height={Math.abs(cursor.y - selectionStart.y)}
                        fill="rgba(0, 123, 255, 0.1)"
                        stroke="rgba(0, 123, 255, 0.5)"
                        strokeWidth={1 / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                    />
                )}

            </svg>
        </div>
    );
};

export default OverlayLayer;
