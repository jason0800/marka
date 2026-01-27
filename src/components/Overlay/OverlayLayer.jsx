import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import useAppStore from "../../stores/useAppStore";
import { calculateDistance, calculatePolygonArea } from "../../geometry/transforms";
import classes from "./OverlayLayer.module.css";

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
    const [isDrawing, setIsDrawing] = useState(false);
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
        if (!isDrawing) return;

        if (activeTool === "area" && drawingPoints.length >= 3) {
            addMeasurement({
                id: Date.now().toString(),
                type: "area",
                pageIndex,
                points: [...drawingPoints],
            });
            pushHistory();
        } else if (activeTool === "perimeter" && drawingPoints.length >= 2) {
            addMeasurement({
                id: Date.now().toString(),
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
    }, [isDrawing, activeTool, drawingPoints, addMeasurement, pageIndex, pushHistory, setActiveTool]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKeyDown = (e) => {
            if (editingId) return;

            // Undo/Redo
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
                e.preventDefault();
                e.stopPropagation();
                redo();
                return;
            }

            if (e.key === "Enter") finishDrawing();

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

            // Delete selected objects
            if (e.key === "Delete" || e.key === "Backspace") {
                if (selectedIds.length > 0) {
                    e.preventDefault(); // Prevent browser back navigation on Backspace
                    selectedIds.forEach((id) => {
                        // Check if it's a shape
                        const shape = pageShapes.find((s) => s.id === id);
                        if (shape) {
                            deleteShape(id);
                        } else {
                            // Otherwise it's a measurement
                            const measurement = pageMeasurements.find((m) => m.id === id);
                            if (measurement) {
                                deleteMeasurement(id);
                            }
                        }
                    });
                    setSelectedIds([]);
                    pushHistory(); // Save state after deletion
                }
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [editingId, finishDrawing, selectedIds, pageShapes, pageMeasurements, deleteShape, deleteMeasurement, setSelectedIds, pushHistory, undo, redo]);

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
                // Push history before starting to drag (for undo of moves)
                pushHistory();
            } else {
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
                addMeasurement({ id: Date.now().toString(), type: "count", pageIndex, point });
                pushHistory();
                setActiveTool("select"); // Auto-switch to select
                return;
            }

            if (activeTool === "comment") {
                if (!isDrawing) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]); // tip
                }
                return;
            }

            if (activeTool === "length" || activeTool === "calibrate") {
                if (!isDrawing) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]);
                } else {
                    const start = drawingPoints[0];
                    const end = { x: point.x, y: point.y };

                    if (activeTool === "length") {
                        addMeasurement({
                            id: Date.now().toString(),
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
                if (!isDrawing) {
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
        if (["rectangle", "circle", "line", "arrow"].includes(activeTool) && isDrawing && shapeStart && point) {
            if (calculateDistance(shapeStart, point) > 5) {
                const id = Date.now().toString();

                const base = {
                    id,
                    type: activeTool,
                    pageIndex,
                    stroke: "var(--shape-stroke, #000)",
                    strokeWidth: 2, // in PDF points
                    strokeDasharray: "none",
                    fill: "none",
                    opacity: 1,
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
        if (activeTool === "comment" && isDrawing && drawingPoints.length > 0 && point) {
            const tip = drawingPoints[0];
            const id = Date.now().toString();
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

        return (
            <g>
                <rect
                    x={0}
                    y={0}
                    width={w}
                    height={h}
                    fill="none"
                    stroke="var(--primary-color)"
                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
                {renderHandle(0, 0, "nw-resize", "nw")}
                {renderHandle(w / 2, 0, "n-resize", "n")}
                {renderHandle(w, 0, "ne-resize", "ne")}
                {renderHandle(w, h / 2, "e-resize", "e")}
                {renderHandle(w, h, "se-resize", "se")}
                {renderHandle(w / 2, h, "s-resize", "s")}
                {renderHandle(0, h, "sw-resize", "sw")}
                {renderHandle(0, h / 2, "w-resize", "w")}

                <circle
                    cx={w / 2}
                    cy={-rotOffset}
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
        <svg
            ref={svgRef}
            className={classes.overlaySvg}
            width={width}
            height={height}
            viewBox={viewBox}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onDoubleClick={() => finishDrawing()}
        >
            {/* Shapes */}
            {pageShapes.map(renderShape)}

            {/* Measurements */}
            {pageMeasurements.map(renderMeasurement)}

            {/* Drawing Previews */}
            {isDrawing && cursor && (
                <g pointerEvents="none">
                    {/* Measurement previews */}
                    {["length", "calibrate", "comment"].includes(activeTool) && drawingPoints.length > 0 && (
                        <line
                            x1={drawingPoints[0].x}
                            y1={drawingPoints[0].y}
                            x2={cursor.x}
                            y2={cursor.y}
                            stroke={activeTool === "comment" ? "#333" : "#e74c3c"}
                            strokeDasharray="5,5"
                            strokeWidth={nonScalingStroke}
                            vectorEffect="non-scaling-stroke"
                        />
                    )}

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

                    {["area", "perimeter"].includes(activeTool) && drawingPoints.length > 0 && (
                        <>
                            <polyline
                                points={[...drawingPoints.map((p) => `${p.x},${p.y}`), `${cursor.x},${cursor.y}`].join(" ")}
                                fill={activeTool === "area" ? "rgba(108, 176, 86, 0.25)" : "none"}
                                stroke="#e74c3c"
                                strokeDasharray="5,5"
                                strokeWidth={nonScalingStroke}
                                vectorEffect="non-scaling-stroke"
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
                    )}

                    {/* Shape previews */}
                    {activeTool === "rectangle" && shapeStart && (
                        <rect
                            x={Math.min(shapeStart.x, cursor.x)}
                            y={Math.min(shapeStart.y, cursor.y)}
                            width={Math.abs(cursor.x - shapeStart.x)}
                            height={Math.abs(cursor.y - shapeStart.y)}
                            stroke="var(--primary-color)"
                            strokeWidth={nonScalingStroke}
                            fill="none"
                            strokeDasharray="5,5"
                            vectorEffect="non-scaling-stroke"
                        />
                    )}

                    {activeTool === "circle" && shapeStart && (
                        <ellipse
                            cx={(shapeStart.x + cursor.x) / 2}
                            cy={(shapeStart.y + cursor.y) / 2}
                            rx={Math.abs(cursor.x - shapeStart.x) / 2}
                            ry={Math.abs(cursor.y - shapeStart.y) / 2}
                            stroke="var(--primary-color)"
                            strokeWidth={nonScalingStroke}
                            fill="none"
                            strokeDasharray="5,5"
                            vectorEffect="non-scaling-stroke"
                        />
                    )}

                    {(activeTool === "line" || activeTool === "arrow") && shapeStart && (
                        <line
                            x1={shapeStart.x}
                            y1={shapeStart.y}
                            x2={cursor.x}
                            y2={cursor.y}
                            stroke="var(--primary-color)"
                            strokeWidth={nonScalingStroke}
                            strokeDasharray="5,5"
                            vectorEffect="non-scaling-stroke"
                        />
                    )}
                </g>
            )}

            {/* Selection box */}
            {selectionStart && cursor && activeTool === "select" && (
                <rect
                    x={Math.min(selectionStart.x, cursor.x)}
                    y={Math.min(selectionStart.y, cursor.y)}
                    width={Math.abs(cursor.x - selectionStart.x)}
                    height={Math.abs(cursor.y - selectionStart.y)}
                    fill="rgba(0, 120, 215, 0.1)"
                    stroke="rgba(0, 120, 215, 0.5)"
                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                    strokeDasharray="3,3"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
            )}
        </svg>
    );
};

export default OverlayLayer;
