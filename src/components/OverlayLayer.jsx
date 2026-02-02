import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import useAppStore from "../stores/useAppStore";
import { calculateDistance, calculatePolygonArea } from "../geometry/transforms";
import { findShapeAtPoint, findItemAtPoint } from "../geometry/hitTest";
import OverlayCanvasLayer from "./OverlayCanvasLayer";

const OverlayLayer = ({ page, width, height, viewScale = 1.0, renderScale = 1.0, rotation = 0 }) => {
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
    const unscaledViewport = useMemo(() => page.getViewport({ scale: 1.0, rotation }), [page, rotation]);
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

    // ---- Pointer handlers (was Mouse) ----
    const handlePointerDown = (e) => {
        // Left click only
        if (e.button !== 0) {
            return;
        }

        // Capture pointer to ensure we get events even outside the element
        e.target.setPointerCapture(e.pointerId);

        // ignore textarea editing interactions
        if (e.target.tagName === "TEXTAREA") return;

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
                return;
            } else {
                // Check measurements
                const meas = pageMeasurements.find(m => m.id === resizeId);
                if (meas && (meas.type === 'text' || meas.type === 'callout')) {
                    pushHistory();
                    // Normalize to shape-like for resizing logic
                    const startShape = {
                        ...meas,
                        x: meas.box.x,
                        y: meas.box.y,
                        width: meas.box.w,
                        height: meas.box.h,
                        rotation: meas.rotation || 0
                    };
                    setResizingState({
                        id: resizeId,
                        handle: resizeHandle,
                        startShape: JSON.parse(JSON.stringify(startShape)),
                        startPoint: { x: point.x, y: point.y },
                        isMeasurement: true
                    });
                    return;
                }
            }
        }

        // 2) Select tool
        if (activeTool === "select") {
            const targetShapeRef = e.target.closest('[data-shape-id]');
            const targetMeasRef = e.target.closest('[data-meas-id]');

            const targetShapeId = targetShapeRef?.getAttribute("data-shape-id");
            const targetMeasId = targetMeasRef?.getAttribute("data-meas-id");
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
                // Import finding logic (make sure to update imports too!)
                const hit = findItemAtPoint(point, pageShapes, pageMeasurements);
                if (hit) {
                    const hitId = hit.item.id;
                    const isSelected = selectedIds.includes(hitId);
                    if (isShift) {
                        setSelectedIds((prev) =>
                            isSelected ? prev.filter((id) => id !== hitId) : [...prev, hitId]
                        );
                    } else {
                        setSelectedIds([hitId]);
                    }
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
        if (["rectangle", "circle", "line", "arrow", "text", "callout"].includes(activeTool)) {
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

    const handlePointerMove = (e) => {
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

            // Callout tip
            if (handle === 'callout-tip') {
                // Just move the tip
                // For callout, startShape is the measurement
                // We stored it as normalized shape, but for tip we need original fields or jus update directly
                // Actually startShape has 'tip' if we copied all props.
                const newTip = {
                    x: startShape.tip.x + dx,
                    y: startShape.tip.y + dy
                };
                updateMeasurement(id, { tip: newTip });
                return;
            }

            const { x: startX, y: startY, width: w0, height: h0, rotation: rot0 = 0 } = startShape;

            if (handle === "rotate") {
                const cx = startX + w0 / 2;
                const cy = startY + h0 / 2;
                const currentAngle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI;
                let newRot = currentAngle + 90;
                if (e.shiftKey) newRot = Math.round(newRot / 15) * 15;

                if (resizingState.isMeasurement) {
                    // Measurements don't strictly support rotation in rendering yet (foreignObject transform?), 
                    // but let's store it if we added support. 
                    // For now, if no rotation support for text/callout, skip or implement.
                    // The proxy shape has it.
                    updateMeasurement(id, { rotation: newRot });
                } else {
                    updateShape(id, { rotation: newRot });
                }
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

            if (resizingState.isMeasurement) {
                updateMeasurement(id, {
                    box: { x: finalX, y: finalY, w: finalW, h: finalH }
                });
            } else {
                updateShape(id, { x: finalX, y: finalY, width: finalW, height: finalH });
            }
            return;
        }

        // ---- dragging selected items ----
        if (activeTool === "select" && isDraggingItems && dragStart && selectedIds.length > 0) {
            const dx = point.x - dragStart.x;
            const dy = point.y - dragStart.y;

            selectedIds.forEach((id) => {
                const shape = pageShapes.find((s) => s.id === id);
                if (shape) {
                    if (shape.type === "line" || shape.type === "arrow") {
                        updateShape(id, {
                            start: { x: shape.start.x + dx, y: shape.start.y + dy },
                            end: { x: shape.end.x + dx, y: shape.end.y + dy },
                        });
                    } else {
                        updateShape(id, { x: shape.x + dx, y: shape.y + dy });
                    }
                } else {
                    const meas = pageMeasurements.find(m => m.id === id);
                    if (meas && meas.box) {
                        const newBox = { ...meas.box, x: meas.box.x + dx, y: meas.box.y + dy };
                        let patch = { box: newBox };
                        if (meas.type === 'callout' && meas.tip) {
                            patch.tip = { x: meas.tip.x + dx, y: meas.tip.y + dy };
                        }
                        updateMeasurement(id, patch);
                    }
                }
            });

            setDragStart({ x: point.x, y: point.y });
        }
    };

    const handlePointerUp = (e) => {
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

        // finalize text/callout
        if (["text", "callout"].includes(activeTool) && isDrawingRef.current && shapeStart && point) {
            const id = crypto.randomUUID();
            let newMeas = null;

            if (activeTool === "text") {
                const x = Math.min(shapeStart.x, point.x);
                const y = Math.min(shapeStart.y, point.y);
                const w = Math.abs(point.x - shapeStart.x);
                const h = Math.abs(point.y - shapeStart.y);

                // If distinct box dragged
                if (w > 10 && h > 10) {
                    newMeas = {
                        id,
                        type: "text",
                        pageIndex,
                        box: { x, y, w, h },
                        text: "Text",
                        ...defaultShapeStyle
                    };
                } else {
                    // Default box click
                    newMeas = {
                        id,
                        type: "text",
                        pageIndex,
                        box: { x: point.x, y: point.y, w: 200, h: 50 },
                        text: "Text",
                        ...defaultShapeStyle
                    };
                }
            } else if (activeTool === "callout") {
                // For a smoother drag, dragging defines the Tip -> Box relationship?
                // Or dragging defines the Box size? 
                // Let's say: Drag Start = Tip. Drag End = Center of Box (or closest corner).
                // Let's assume Drag End = Box Center for simplicity and "feeling".
                const w = 150;
                const h = 50;
                newMeas = {
                    id,
                    type: "callout",
                    pageIndex,
                    tip: shapeStart,
                    box: { x: point.x - w / 2, y: point.y - h / 2, w, h },
                    text: "Callout",
                    ...defaultShapeStyle
                };
            }

            if (newMeas) {
                addMeasurement(newMeas);
                pushHistory();
                setActiveTool("select");
                setEditingId(id); // Auto-edit
            }

            setIsDrawing(false);
            setShapeStart(null);
            // setCursor(null) // handled by mousemove?
            return;
        }

        // finalize text/callout
        if (["text", "callout"].includes(activeTool) && isDrawingRef.current && shapeStart && point) {
            const id = crypto.randomUUID();
            let newMeas = null;

            if (activeTool === "text") {
                const x = Math.min(shapeStart.x, point.x);
                const y = Math.min(shapeStart.y, point.y);
                const w = Math.abs(point.x - shapeStart.x);
                const h = Math.abs(point.y - shapeStart.y);

                // If distinct box dragged
                if (w > 10 && h > 10) {
                    newMeas = {
                        id,
                        type: "text",
                        pageIndex,
                        box: { x, y, w, h },
                        text: "Text",
                        ...defaultShapeStyle
                    };
                } else {
                    // Default box click
                    newMeas = {
                        id,
                        type: "text",
                        pageIndex,
                        box: { x: point.x, y: point.y, w: 200, h: 50 },
                        text: "Text",
                        ...defaultShapeStyle
                    };
                }
            } else if (activeTool === "callout") {
                newMeas = {
                    id,
                    type: "callout",
                    pageIndex,
                    tip: shapeStart,
                    box: { x: point.x, y: point.y - 25, w: 150, h: 50 }, // Center-ish relative to drag end? Or treat drag end as box position.
                    text: "Callout",
                    ...defaultShapeStyle
                };
            }

            if (newMeas) {
                addMeasurement(newMeas);
                pushHistory();
                setActiveTool("select");
                setEditingId(id); // Auto-edit
            }

            setIsDrawing(false);
            setShapeStart(null);
            // setCursor(null) // handled by mousemove?
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
        const isSelected = selectedIds.includes(m.id);
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

        if ((m.type === "comment" || m.type === "text" || m.type === "callout") && m.box) {
            const isEditing = editingId === m.id;

            // Comment: Line + Dot. Callout: Arrow. Text: None.
            const renderConnector = () => {
                if (m.type === "comment" && m.tip) {
                    return (
                        <>
                            <line
                                x1={m.tip.x}
                                y1={m.tip.y}
                                x2={m.box.x + m.box.w / 2} // connect to center
                                y2={m.box.y + m.box.h / 2}
                                stroke={m.stroke || "#333"}
                                strokeWidth={1 / Math.max(1e-6, viewScale)}
                                vectorEffect="non-scaling-stroke"
                            />
                            <circle
                                cx={m.tip.x}
                                cy={m.tip.y}
                                r={3 / Math.max(1e-6, viewScale)}
                                fill={m.stroke || "#333"}
                                vectorEffect="non-scaling-stroke"
                            />
                        </>
                    );
                }
                if (m.type === "callout" && m.tip) {
                    const arrowId = `callout-arrow-${m.id}`;

                    // Box bounds
                    const bx = m.box.x;
                    const by = m.box.y;
                    const bw = m.box.w;
                    const bh = m.box.h;
                    const boxCx = bx + bw / 2;
                    const boxCy = by + bh / 2;

                    // Tip point
                    const tx = m.tip.x;
                    const ty = m.tip.y;

                    // Determine relative position: Left/Right or Top/Bottom?
                    // "leader goes under the callout text box" -> Tip is BELOW box.
                    // "leader goes above the callout" -> Tip is ABOVE box.

                    // Check vertical overlap
                    const isVerticallyOutside = ty < by || ty > by + bh;
                    const isHorizontallyOutside = tx < bx || tx > bx + bw;

                    // Heuristics:
                    // If tip is clearly above or below (beyond some margin?), use vertical leader.
                    // If tip is to the side, use horizontal leader.

                    // Let's use 4 zones based on center angle? Or just simple projection.
                    // User request: "when the leader goes under the callout text box... first extend straight down... then bend"

                    let startX, startY, kneeX, kneeY;

                    // Simple logic:
                    // If tip.y > box.bottom -> Bottom placement
                    // If tip.y < box.top -> Top placement
                    // Else -> Side placement

                    if (ty > by + bh && !isHorizontallyOutside) {
                        // BOTTOM (Strict: Must be horizontally within box)
                        startX = boxCx;
                        startY = by + bh;

                        const ky = (startY + ty) / 2;
                        kneeX = startX;
                        kneeY = ky;
                    } else if (ty < by && !isHorizontallyOutside) {
                        // TOP (Strict: Must be horizontally within box)
                        startX = boxCx;
                        startY = by;

                        const ky = (startY + ty) / 2;
                        kneeX = startX;
                        kneeY = ky;
                    } else {
                        // SIDES (Left/Right) - Default for corners too
                        const isRight = tx > boxCx;
                        startX = isRight ? bx + bw : bx;
                        startY = boxCy;

                        // Knee is horizontal out
                        const kx = (startX + tx) / 2;
                        kneeX = kx;
                        kneeY = startY;
                    }

                    const points = `${startX},${startY} ${kneeX},${kneeY} ${tx},${ty}`;

                    return (
                        <>
                            <defs>
                                <marker id={arrowId} markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto-start-reverse">
                                    <polygon points="0 0, 6 2, 0 4" fill={m.stroke || "#333"} />
                                </marker>
                            </defs>
                            <polyline
                                points={points}
                                fill="none"
                                stroke={m.stroke || "#333"}
                                strokeWidth={2 / Math.max(1e-6, viewScale)}
                                markerEnd={`url(#${arrowId})`}
                                vectorEffect="non-scaling-stroke"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </>
                    );
                }
                return null;
            };

            const fontSize = m.fontSize || 14;
            const textColor = m.textColor || m.stroke || "black";
            const borderColor = m.stroke || "#333";
            const bgColor = m.fill && m.fill !== 'none' ? m.fill : (m.type === "text" ? "transparent" : "#fff");

            return (
                <g key={m.id} {...measCommon}>
                    {renderConnector()}
                    <g>
                        {/* Background Rect for Styling */}
                        <rect
                            x={m.box.x}
                            y={m.box.y}
                            width={m.box.w}
                            height={m.box.h}
                            fill={bgColor}
                            stroke={borderColor}
                            strokeWidth={m.strokeWidth || 1}
                            strokeDasharray={m.strokeDasharray === 'none' ? undefined : m.strokeDasharray}
                            vectorEffect="non-scaling-stroke"
                            rx={0} ry={0}
                        />

                        <foreignObject
                            x={m.box.x}
                            y={m.box.y}
                            width={m.box.w}
                            height={m.box.h}
                            className="foreignObject"
                            style={{ overflow: 'visible', pointerEvents: 'none' }}
                        >
                            {isEditing ? (
                                <textarea
                                    autoFocus
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        resize: "none", // Remove handle
                                        border: "none", // Handled by rect
                                        padding: "4px",
                                        margin: 0,
                                        fontSize: `${fontSize}px`,
                                        background: "transparent",
                                        color: textColor,
                                        outline: "none",
                                        fontFamily: 'sans-serif',
                                        pointerEvents: 'auto',
                                        lineHeight: "1.2",
                                        overflow: "hidden"
                                    }}
                                    defaultValue={m.text}
                                    onBlur={(ev) => {
                                        updateMeasurement(m.id, { text: ev.target.value });
                                        setEditingId(null);
                                    }}
                                    onKeyDown={(ev) => {
                                        if (ev.key === "Escape") setEditingId(null);
                                        ev.stopPropagation();
                                    }}
                                />
                            ) : (
                                <div
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        border: m.type === "text" ? `1px dashed ${activeTool === 'select' ? '#ccc' : 'transparent'}` : "none",
                                        background: "transparent",
                                        color: textColor,
                                        padding: "4px",
                                        margin: 0,
                                        fontSize: `${fontSize}px`,
                                        fontFamily: 'sans-serif',
                                        overflow: "visible",
                                        whiteSpace: "pre-wrap",
                                        cursor: isSelected ? "move" : "pointer",
                                        pointerEvents: 'auto',
                                        userSelect: 'none',
                                        lineHeight: "1.2"
                                    }}
                                    onDoubleClick={(ev) => {
                                        ev.stopPropagation();
                                        setEditingId(m.id);
                                    }}
                                >
                                    {m.text || ""}
                                </div>
                            )}
                        </foreignObject>
                    </g>

                    {
                        isSelected && (
                            <g transform={`translate(${m.box.x}, ${m.box.y})`}>
                                {renderSelectionFrame({
                                    id: m.id,
                                    x: 0,
                                    y: 0,
                                    width: m.box.w,
                                    height: m.box.h,
                                    rotation: m.rotation || 0,
                                    type: "rectangle" // Proxy
                                })}
                            </g>
                        )
                    }

                    {
                        isSelected && m.type === 'callout' && m.tip && (
                            <circle
                                cx={m.tip.x}
                                cy={m.tip.y}
                                r={6 / Math.max(1e-6, viewScale)}
                                fill="#b4e6a0"
                                stroke="#3a6b24"
                                strokeWidth={1 / Math.max(1e-6, viewScale)}
                                data-resize-id={m.id}
                                data-resize-handle="callout-tip"
                                cursor="crosshair"
                            />
                        )
                    }
                </g >
            );
        }

        return null;
    };

    // Helper to check if shape is "out of bounds"
    const isOutOfBounds = (s) => {
        // Line/Arrow
        if (s.type === "line" || s.type === "arrow" || (s.type === "length" && s.points)) {
            const points = s.points || [s.start, s.end];
            const minX = Math.min(...points.map(p => p.x));
            const maxX = Math.max(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            const maxY = Math.max(...points.map(p => p.y));
            return minX < 0 || minY < 0 || maxX > width || maxY > height;
        }
        // Box shapes
        const x = s.x ?? s.box?.x;
        const y = s.y ?? s.box?.y;
        const w = s.width ?? s.box?.w ?? 0;
        const h = s.height ?? s.box?.h ?? 0;

        return x < 0 || y < 0 || x + w > width || y + h > height;
    };

    return (
        <div style={{ position: "absolute", top: 0, left: 0, width, height, pointerEvents: 'none' }}>
            {/* 1. Canvas Layer (Static shapes) */}
            <OverlayCanvasLayer
                width={width}
                height={height}
                viewScale={viewScale}
                renderScale={renderScale}
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
                className="absolute top-0 left-0 w-full h-full select-none z-10"
                width={width}
                height={height}
                viewBox={viewBox}
                style={{ position: "absolute", top: 0, left: 0, pointerEvents: "all", overflow: "visible" }} // SVG must catch clicks for handles
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={() => finishDrawing()}
            >
                <defs>
                    {/* Markers could be large if we render all of them? No, define one generic? 
                             Current code defines markers per-ID. 
                             If shapes are on Canvas, we don't need markers here unless they are selected.
                             We only render selected shapes here. */}
                </defs>

                {/* RENDER ONLY SELECTED SHAPES in SVG OR Out-Of-Bounds */}
                {pageShapes.filter(s => selectedIds.includes(s.id) || isOutOfBounds(s)).map(s => renderShape(s))}

                {/* Render active drawing shape */}
                {isDrawingRef.current && shapeStart && cursor && (
                    (() => {
                        // Temporary shape for preview
                        const tempId = "temp-draw";

                        if (activeTool === "callout") {
                            // Preview Callout
                            const w = 150;
                            const h = 50;
                            // Box centered on cursor (matches creation logic)
                            const box = {
                                x: cursor.x - w / 2,
                                y: cursor.y - h / 2,
                                w,
                                h
                            };
                            const m = {
                                id: tempId,
                                type: "callout",
                                box,
                                tip: shapeStart,
                                text: "Callout",
                                ...defaultShapeStyle,
                                // Add styling that matches current properties if possible
                                stroke: defaultShapeStyle.stroke || '#000000',
                                strokeWidth: defaultShapeStyle.strokeWidth || 1,
                                fill: defaultShapeStyle.fill || '#ffffff'
                            };
                            return renderMeasurement(m);
                        }

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
                {/* Measurements - Render Only Selected or complex types (comment/text/callout) or Out-Of-Bounds in SVG */}
                {pageMeasurements.filter(m =>
                    selectedIds.includes(m.id) ||
                    m.type === "comment" ||
                    m.type === "text" ||
                    m.type === "callout" ||
                    isOutOfBounds(m)
                ).map(m => renderMeasurement(m))}

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
