import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import useAppStore from "../stores/useAppStore";
import { calculateDistance, calculatePolygonArea } from "../geometry/transforms";
import { findShapeAtPoint, findItemAtPoint } from "../geometry/hitTest";
import OverlayCanvasLayer from "./OverlayCanvasLayer";

// Helper: Calculate knee position from standard rules
// Returns { x, y }
const getCalloutKnee = (box, tip, knee = null) => {
    if (knee) return knee;

    // Auto Logic matches render
    const bx = box.x;
    const by = box.y;
    const bw = box.w;
    const bh = box.h;
    const boxCx = bx + bw / 2;
    const boxCy = by + bh / 2;
    const tx = tip ? tip.x : 0;
    const ty = tip ? tip.y : 0;

    const dx = tx - boxCx;
    const dy = ty - boxCy;
    const aspect = bw / bh;

    // Bias towards horizontal attachment (side)
    // "verticalBias" factor: > 1 means we need to be MORE vertical to switch to top/bottom
    // We want to drag up/down more before snapping to vertical.
    // Condition for vertical was: |dy|*aspect > |dx|
    // New condition: |dy| > |dx| * (aspect / bias) ? No.
    // Let's explicitly define a threshold multiplier for the aspect check.
    // If we make aspect "smaller", vertical becomes harder.
    // multiplier = 1.3 (30% bias to horizontal)
    const hBias = 3;

    // Original: abs(dy) * aspect > abs(dx)
    // With bias: abs(dy) * (aspect / hBias) > abs(dx)  => vertical is "harder"
    const isVertical = Math.abs(dy) * aspect > Math.abs(dx) * hBias;

    let kx, ky;
    if (isVertical) {
        kx = boxCx;
        const sy = dy > 0 ? by + bh : by;
        // Fixed Stub Logic: Cap stub length
        const maxStub = 20;
        const distY = Math.abs(ty - sy);
        const actualStub = Math.min(distY / 2, maxStub);

        ky = sy + (ty > sy ? actualStub : -actualStub);
    } else {
        ky = boxCy;
        const sx = dx > 0 ? bx + bw : bx;
        kx = (sx + tx) / 2;
    }
    return { x: kx, y: ky };
};

// Helper: Get connection points for callout line
// Returns { start: {x,y}, knee: {x,y}, end: {x,y} }
const getCalloutPoints = (box, tip, knee, rotation = 0) => {
    const bx = box.x;
    const by = box.y;
    const bw = box.w;
    const bh = box.h;
    const boxCx = bx + bw / 2;
    const boxCy = by + bh / 2;
    const tx = tip ? tip.x : 0;
    const ty = tip ? tip.y : 0;

    const k = getCalloutKnee(box, tip, knee);
    const kx = k.x;
    const ky = k.y;

    // Rotate knee BACK to local aligned space to find intersection
    const rotRad = (rotation * Math.PI) / 180;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);

    const kvxGlobal = kx - boxCx;
    const kvyGlobal = ky - boxCy;

    const localKneeX = boxCx + (kvxGlobal * cos - kvyGlobal * sin);
    const localKneeY = boxCy + (kvxGlobal * sin + kvyGlobal * cos);

    // Now calculate local intersection on AABB
    const lkvx = localKneeX - boxCx;
    const lkvy = localKneeY - boxCy;

    let localStartX, localStartY;

    // Simple Intersection Logic (Local)
    if (Math.abs(localKneeX - boxCx) < 1) { // Vertical
        localStartX = boxCx;
        localStartY = lkvy > 0 ? by + bh : by;
    } else if (Math.abs(localKneeY - boxCy) < 1) { // Horizontal
        localStartY = boxCy;
        localStartX = lkvx > 0 ? bx + bw : bx;
    } else {
        // Off-axis: project to box bounds
        const boxHalfW = bw / 2;
        const boxHalfH = bh / 2;
        const scaleX = Math.abs(lkvx) > 1e-6 ? boxHalfW / Math.abs(lkvx) : 99999;
        const scaleY = Math.abs(lkvy) > 1e-6 ? boxHalfH / Math.abs(lkvy) : 99999;
        const s = Math.min(scaleX, scaleY);
        localStartX = boxCx + lkvx * s;
        localStartY = boxCy + lkvy * s;
    }

    // Determine final knee in Local Space? 
    // Nope, Knee is GLOBAL. But Start is on the box edge.
    // We found Start in LOCAL space. Now rotate Start back to GLOBAL.

    const posCos = Math.cos(rotRad);
    const posSin = Math.sin(rotRad);

    const slvx = localStartX - boxCx;
    const slvy = localStartY - boxCy;

    const globalStartX = boxCx + (slvx * posCos - slvy * posSin);
    const globalStartY = boxCy + (slvx * posSin + slvy * posCos);

    return {
        start: { x: globalStartX, y: globalStartY },
        knee: { x: kx, y: ky },
        end: { x: tx, y: ty }
    };
};



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

    // Page meta (PDF points)
    const pageIndex = page.pageNumber;
    const calibrationScale = calibrationScales[pageIndex] || 1.0; // (pdfPoints per unit) OR (px per unit) - whatever you defined
    const unit = pageUnits[pageIndex] || "px";

    // Keep viewport + viewBox stable (avoid calling getViewport every render)
    const unscaledViewport = useMemo(() => page.getViewport({ scale: 1.0, rotation }), [page, rotation]);
    const viewBox = useMemo(
        () => `0 0 ${unscaledViewport.width} ${unscaledViewport.height}`,
        [unscaledViewport.width, unscaledViewport.height]
    );

    // Helpers: unit conversion
    const toUnits = useCallback(
        (pdfPoints) => pdfPoints / Math.max(1e-9, calibrationScale),
        [calibrationScale]
    );
    const toUnits2 = useCallback(
        (pdfPoints2) => pdfPoints2 / Math.max(1e-9, calibrationScale * calibrationScale),
        [calibrationScale]
    );

    // Visual sizing (constant on screen)
    const nonScalingStroke = useMemo(() => 2 / Math.max(1e-6, viewScale), [viewScale]);
    const handleSize = useMemo(() => 8 / Math.max(1e-6, viewScale), [viewScale]);
    const handleHalf = handleSize / 2;
    const rotOffset = useMemo(() => 20 / Math.max(1e-6, viewScale), [viewScale]);

    // Interaction state
    const [isDrawing, setIsDrawingState] = useState(false);
    const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
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
    const [dragStartItems, setDragStartItems] = useState({});

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

    // Coordinate mapping: Screen -> SVG viewBox coords (PDF points)
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
                setActiveTool('select'); // Return to select mode
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [editingId, finishDrawing, selectedIds, pageShapes, pageMeasurements, deleteShape, deleteMeasurement, setSelectedIds, pushHistory, undo, redo, setIsDrawing]);

    // Pointer handlers
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
                if (meas && (meas.type === 'text' || meas.type === 'callout' || meas.type === 'length' || meas.type === 'area')) {
                    pushHistory();
                    // Normalize to shape-like for resizing logic
                    const startShape = {
                        ...meas,
                        x: meas.box?.x || 0,
                        y: meas.box?.y || 0,
                        width: meas.box?.w || 0,
                        height: meas.box?.h || 0,
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
                let newSelection = [];
                const isSelected = selectedIds.includes(hitId);

                if (isShift) {
                    if (isSelected) {
                        newSelection = selectedIds.filter((id) => id !== hitId);
                    } else {
                        newSelection = [...selectedIds, hitId];
                    }
                } else {
                    if (isSelected) {
                        newSelection = selectedIds;
                    } else {
                        newSelection = [hitId];
                    }
                }

                setSelectedIds(newSelection);

                // Prepare Drag Snapshot for items in newSelection
                const snapshot = {};
                newSelection.forEach(id => {
                    const s = pageShapes.find(x => x.id === id);
                    if (s) {
                        snapshot[id] = JSON.parse(JSON.stringify(s));
                    } else {
                        const m = pageMeasurements.find(x => x.id === id);
                        if (m) {
                            snapshot[id] = JSON.parse(JSON.stringify(m));
                        }
                    }
                });
                setDragStartItems(snapshot);

                setDragStart({ x: point.x, y: point.y });
                setDragDelta({ x: 0, y: 0 }); // Fix shifting
                setIsDraggingItems(true);
                pushHistory();
            } else {
                // CANVAS Hit Test (Manual)
                // Import finding logic (make sure to update imports too!)
                const hit = findItemAtPoint(point, pageShapes, pageMeasurements);
                if (hit) {
                    const hitId = hit.item.id;
                    const isSelected = selectedIds.includes(hitId);

                    let newSelection = [];
                    if (isShift) {
                        if (isSelected) {
                            newSelection = selectedIds.filter((id) => id !== hitId);
                        } else {
                            newSelection = [...selectedIds, hitId];
                        }
                    } else {
                        newSelection = isSelected ? selectedIds : [hitId];
                    }
                    setSelectedIds(newSelection);

                    // Snapshot
                    const snapshot = {};
                    newSelection.forEach(id => {
                        const s = pageShapes.find(x => x.id === id);
                        if (s) {
                            snapshot[id] = JSON.parse(JSON.stringify(s));
                        } else {
                            const m = pageMeasurements.find(x => x.id === id);
                            if (m) {
                                snapshot[id] = JSON.parse(JSON.stringify(m));
                            }
                        }
                    });
                    setDragStartItems(snapshot);

                    setDragStart({ x: point.x, y: point.y });
                    setDragDelta({ x: 0, y: 0 }); // Fix shifting
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

        // Resizing
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
                const newTip = {
                    x: startShape.tip.x + dx,
                    y: startShape.tip.y + dy
                };
                updateMeasurement(id, { tip: newTip });
                return;
            }

            if (handle === 'callout-knee') {
                // Moving the "knee" (bend point)
                // We drag the knee freely but "snap" to either horizontal or vertical alignment relative to the box
                // depending on where the user drags it.
                // Or simpler: The user drags the knee point.
                // We constrain the knee to be EITHER:
                // 1) Vertical line from box key point (top/bottom center) -> knee -> tip
                // 2) Horizontal line from box key point (left/right center) -> knee -> tip

                // Let's implement the logic:
                // Calculate current mouse pos vs box center
                // Calculate box center
                const cx = startShape.box.x + startShape.box.w / 2;
                const cy = startShape.box.y + startShape.box.h / 2;
                const aspect = startShape.box.w / startShape.box.h;
                const rotation = startShape.rotation || 0;

                // Rotated vector from center to mouse point
                // V_global = P - C
                const vGx = point.x - cx;
                const vGy = point.y - cy;

                // Rotate by -rotation to get V_local
                const rad = (-rotation * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                const vLx = vGx * cos - vGy * sin;
                const vLy = vGx * sin + vGy * cos;

                // Determine dominant axis in Local Space
                // Top/Bottom (Vertical) vs Left/Right (Horizontal) relative to box axes
                const isVertical = Math.abs(vLy) * aspect > Math.abs(vLx);

                let localKneeX, localKneeY;

                if (isVertical) {
                    // Snap to Vertical Centerline (Local X = 0)
                    localKneeX = 0;
                    localKneeY = vLy;
                } else {
                    // Snap to Horizontal Centerline (Local Y = 0)
                    localKneeX = vLx;
                    localKneeY = 0;
                }

                // Rotate back to Global Space
                const posRad = (rotation * Math.PI) / 180;
                const posCos = Math.cos(posRad);
                const posSin = Math.sin(posRad);

                const gKneeX = localKneeX * posCos - localKneeY * posSin;
                const gKneeY = localKneeX * posSin + localKneeY * posCos;

                const newKnee = {
                    x: cx + gKneeX,
                    y: cy + gKneeY
                };

                updateMeasurement(id, { knee: newKnee });
                return;
            }

            // Length measurement endpoint dragging
            if (startShape.type === "length" && (handle === "start" || handle === "end")) {
                const newPoints = [...startShape.points];
                if (handle === "start") {
                    newPoints[0] = { x: startShape.points[0].x + dx, y: startShape.points[0].y + dy };
                } else if (handle === "end") {
                    newPoints[1] = { x: startShape.points[1].x + dx, y: startShape.points[1].y + dy };
                }
                updateMeasurement(id, { points: newPoints });
                return;
            }

            // Area measurement vertex dragging
            if (startShape.type === "area" && handle.startsWith("vertex-")) {
                const vertexIndex = parseInt(handle.split("-")[1]);
                const newPoints = [...startShape.points];
                newPoints[vertexIndex] = {
                    x: startShape.points[vertexIndex].x + dx,
                    y: startShape.points[vertexIndex].y + dy
                };
                updateMeasurement(id, { points: newPoints });
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
                    const updates = { rotation: newRot };

                    // Rotate Callout Tip/Knee with the box
                    if (startShape.type === 'callout') {
                        const angleDiff = newRot - (startShape.rotation || 0);
                        const rad = (angleDiff * Math.PI) / 180;
                        const cos = Math.cos(rad);
                        const sin = Math.sin(rad);

                        const rotatePt = (p) => ({
                            x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
                            y: cy + (p.x - cx) * sin + (p.y - cy) * cos
                        });

                        if (startShape.tip) updates.tip = rotatePt(startShape.tip);
                        if (startShape.knee) updates.knee = rotatePt(startShape.knee);
                    }

                    updateMeasurement(id, updates);
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

        // Dragging selected items
        if (activeTool === "select" && isDraggingItems && dragStart && selectedIds.length > 0) {
            const dx = point.x - dragStart.x;
            const dy = point.y - dragStart.y;
            setDragDelta({ x: dx, y: dy });
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

                    const itemsToCheck = [...pageShapes, ...pageMeasurements];
                    itemsToCheck.forEach((s) => {
                        let sb = { x: 0, y: 0, w: 0, h: 0 };

                        if (s.type === "line" || s.type === "arrow") {
                            sb.x = Math.min(s.start.x, s.end.x);
                            sb.y = Math.min(s.start.y, s.end.y);
                            sb.w = Math.abs(s.end.x - s.start.x);
                            sb.h = Math.abs(s.end.y - s.start.y);
                        } else if (s.points && s.points.length > 0) {
                            const xs = s.points.map(p => p.x);
                            const ys = s.points.map(p => p.y);
                            const minX = Math.min(...xs);
                            const minY = Math.min(...ys);
                            sb.x = minX;
                            sb.y = minY;
                            sb.w = Math.max(...xs) - minX;
                            sb.h = Math.max(...ys) - minY;
                        } else if (s.box) {
                            // Text, Callout, Comment
                            sb.x = s.box.x;
                            sb.y = s.box.y;
                            sb.w = s.box.w;
                            sb.h = s.box.h;

                            // Include Callout Tip in bounds
                            if (s.type === 'callout' && s.tip) {
                                const minX = Math.min(sb.x, s.tip.x);
                                const minY = Math.min(sb.y, s.tip.y);
                                const maxX = Math.max(sb.x + sb.w, s.tip.x);
                                const maxY = Math.max(sb.y + sb.h, s.tip.y);
                                sb.x = minX;
                                sb.y = minY;
                                sb.w = maxX - minX;
                                sb.h = maxY - minY;
                            }
                        } else {
                            // Standard Shapes
                            sb.x = s.x || 0;
                            sb.y = s.y || 0;
                            sb.w = s.width || 0;
                            sb.h = s.height || 0;
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

            // Apply Drag
            if (isDraggingItems && dragStart && (dragDelta.x !== 0 || dragDelta.y !== 0)) {
                const { x: dx, y: dy } = dragDelta;

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
                        if (meas) {
                            if (meas.box) {
                                // If dragging a callout, we want to move ONLY the box, keeping the tip stationary.
                                if (meas.type === 'callout') {
                                    // Only move the BOX. Tip stays.
                                    const newBox = { ...meas.box, x: meas.box.x + dx, y: meas.box.y + dy };
                                    const changes = { box: newBox };

                                    // User: "knee should remain the same length away from the text box"
                                    const currentKnee = meas.knee || getCalloutKnee(meas.box, meas.tip, null);
                                    changes.knee = {
                                        x: currentKnee.x + dx,
                                        y: currentKnee.y + dy
                                    };

                                    updateMeasurement(id, changes);
                                } else {
                                    // Other measurements (text, etc) - move whole thing or box
                                    const newBox = { ...meas.box, x: meas.box.x + dx, y: meas.box.y + dy };
                                    updateMeasurement(id, { box: newBox });
                                }
                            } else if (meas.points) {
                                // Length, Area, Perimeter
                                const newPoints = meas.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                                updateMeasurement(id, { points: newPoints });
                            }
                        }
                    }
                });
            }

            setIsDraggingItems(false);
            setDragStart(null);
            setDragDelta({ x: 0, y: 0 });
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
                // Drag Start = Tip. Drag End = Connection Point (Knee/Side).
                const w = 125;
                const h = 25;
                const dx = point.x - shapeStart.x;
                const dy = point.y - shapeStart.y; // Unused for box pos now, but maybe for side decide?

                // Box Position: The cursor is the CONNECTION POINT.
                // Knee Stub: Always stick out 40px from box towards the "outside".
                // If dx >= 0 (Right), Box is to Right of Cursor. Connection is Left-Center. Knee is Left of Cursor.
                // If dx < 0 (Left), Box is to Left of Cursor. Connection is Right-Center. Knee is Right of Cursor.

                const stub = 40;
                let bx, kneeX, by, kneeY;

                if (Math.abs(dy) > Math.abs(dx)) {
                    // Vertical Mode
                    bx = point.x - w / 2;

                    if (dy >= 0) {
                        // Dragged Down -> Box Below
                        by = point.y;
                        kneeY = point.y - stub;
                    } else {
                        // Dragged Up -> Box Above
                        by = point.y - h;
                        kneeY = point.y + stub;
                    }
                    kneeX = point.x;
                } else {
                    // Horizontal Mode (Existing logic)
                    if (dx >= 0) {
                        bx = point.x;
                        kneeX = point.x - stub;
                    } else {
                        bx = point.x - w;
                        kneeX = point.x + stub;
                    }
                    // Center vertically on cursor
                    by = point.y - h / 2;
                    kneeY = point.y;
                }

                newMeas = {
                    id,
                    type: "callout",
                    pageIndex,
                    tip: shapeStart,
                    // Use calculated bx/by
                    box: { x: bx, y: by, w, h },
                    knee: { x: kneeX, y: kneeY }, // Explicit knee.
                    text: "Callout",
                    ...defaultShapeStyle
                };
            }

            if (newMeas) {
                addMeasurement(newMeas);
                pushHistory();
                setActiveTool("select");
                if (activeTool !== "callout") {
                    setEditingId(id); // Auto-edit (except callout)
                }
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

    // Rendering helpers
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

        const renderCircleHandle = (x, y, cursorCss, hName) => (
            <circle
                key={hName}
                cx={x}
                cy={y}
                r={handleSize / 2}
                cursor={cursorCss}
                data-resize-id={s.id}
                data-resize-handle={hName}
                {...handleStyle}
            />
        );

        if (isLine) {
            return (
                <g>
                    {renderCircleHandle(s.start.x, s.start.y, "default", "start")}
                    {renderCircleHandle(s.end.x, s.end.y, "default", "end")}
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
                    cy={-rotOffset / Math.max(1e-6, viewScale) - padding}
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

    const renderShapeHitTarget = (s) => {
        // selected shapes already render in SVG (with real geometry + handles)
        if (selectedIds.includes(s.id)) return null;

        const cursorStyle = { cursor: "move" };
        const sw = 15 / Math.max(1e-6, viewScale);

        if (s.type === "line" || s.type === "arrow") {
            return (
                <line
                    key={`hit-${s.id}`}
                    data-shape-id={s.id}
                    x1={s.start.x}
                    y1={s.start.y}
                    x2={s.end.x}
                    y2={s.end.y}
                    stroke="transparent"
                    strokeWidth={sw}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="all"
                    style={cursorStyle}
                />
            );
        }

        const rot = s.rotation || 0;

        return (
            <g
                key={`hit-${s.id}`}
                data-shape-id={s.id}
                pointerEvents="all"
                style={cursorStyle}
                transform={`translate(${s.x}, ${s.y}) rotate(${rot}, ${s.width / 2}, ${s.height / 2})`}
            >
                {s.type === "rectangle" ? (
                    <rect
                        x={0}
                        y={0}
                        width={s.width}
                        height={s.height}
                        fill="transparent"
                        stroke="transparent"
                        pointerEvents="all"
                    />
                ) : (
                    <ellipse
                        cx={s.width / 2}
                        cy={s.height / 2}
                        rx={s.width / 2}
                        ry={s.height / 2}
                        fill="transparent"
                        stroke="transparent"
                        pointerEvents="all"
                    />
                )}
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
            style: {
                cursor: "move",
                pointerEvents: "all"
            },
            strokeLinecap: "round",
            strokeLinejoin: "round",
        };

        if (s.type === "line") {
            return (
                <g key={s.id}>
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
                        style={{ cursor: "move", pointerEvents: "all" }}
                    />
                    <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} {...commonProps} strokeLinecap="round" />
                    {isSelected && renderSelectionFrame(s)}
                </g>
            );
        }

        if (s.type === "arrow") {
            return (
                <g key={s.id} data-shape-id={s.id}>
                    <defs>
                        <marker id={`arrow-${s.id}-v2`} markerWidth="6" markerHeight="4" refX="2" refY="2" orient="auto">
                            <polygon points="0 0, 6 2, 0 4" fill={s.stroke} />
                        </marker>
                    </defs>

                    {(() => {
                        // Shorten line so visual tip matches s.end
                        const rawSw = s.strokeWidth || 2;
                        const sw = rawSw / Math.max(1e-6, viewScale);
                        const dist = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
                        // refX=2, tip=6. Offset needed = (6-2)*sw = 4*sw.
                        // Ensure we don't shorten past start (dist > offset)
                        const offset = 4 * sw;
                        const t = dist > offset ? (dist - offset) / dist : 0;

                        const endX = s.start.x + (s.end.x - s.start.x) * t;
                        const endY = s.start.y + (s.end.y - s.start.y) * t;

                        return (
                            <line
                                x1={s.start.x}
                                y1={s.start.y}
                                x2={endX}
                                y2={endY}
                                {...commonProps}
                                cursor="move"
                                markerEnd={`url(#arrow-${s.id}-v2)`}
                                strokeLinecap="butt"
                            />
                        );
                    })()}

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
                        style={{ cursor: "move", pointerEvents: "all" }}
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
            style: {
                cursor: activeTool === "select" ? "move" : "default",
            }
        };

        if (m.type === "length" && m.points?.length === 2) {
            const a = m.points[0];
            const b = m.points[1];
            const dist = calculateDistance(a, b);
            const strokeColor = m.stroke || "#e74c3c";
            const strokeWidth = m.strokeWidth || 2;
            const strokeDasharray = m.strokeDasharray === 'none' ? undefined : (m.strokeDasharray === 'dashed' ? '12, 12' : (m.strokeDasharray === 'dotted' ? '2, 8' : m.strokeDasharray));
            const fontSize = m.fontSize || 14;
            const textColor = m.textColor || strokeColor;
            const opacity = m.opacity ?? 1;

            return (
                <g key={m.id} {...measCommon} style={{ ...measCommon.style, opacity }}>
                    {/* Hit Area for dragging */}
                    <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="transparent"
                        strokeWidth={15 / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="all"
                        data-meas-id={m.id} // Ensure it's identifiable
                        style={{ cursor: "move" }}
                    />
                    <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth / Math.max(1e-6, viewScale)}
                        strokeDasharray={strokeDasharray}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none" // Let hit area handle events
                    />
                    <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 6 / Math.max(1e-6, viewScale)}
                        fill={textColor}
                        fontSize={fontSize / Math.max(1e-6, viewScale)}
                        textAnchor="middle"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                    >
                        {toUnits(dist).toFixed(2)} {unit}
                    </text>
                    {isSelected && (
                        <>
                            {/* Handles at endpoints */}
                            <circle
                                cx={a.x}
                                cy={a.y}
                                r={handleSize / 2}
                                fill="#b4e6a0"
                                stroke="#3a6b24"
                                strokeWidth={1 / Math.max(1e-6, viewScale)}
                                vectorEffect="non-scaling-stroke"
                                cursor="default"
                                data-resize-id={m.id}
                                data-resize-handle="start"
                            />
                            <circle
                                cx={b.x}
                                cy={b.y}
                                r={handleSize / 2}
                                fill="#b4e6a0"
                                stroke="#3a6b24"
                                strokeWidth={1 / Math.max(1e-6, viewScale)}
                                vectorEffect="non-scaling-stroke"
                                cursor="default"
                                data-resize-id={m.id}
                                data-resize-handle="end"
                            />
                        </>
                    )}
                </g>
            );
        }

        if (m.type === "area" && m.points?.length >= 3) {
            const pointsStr = m.points.map((p) => `${p.x},${p.y}`).join(" ");
            const area = calculatePolygonArea(m.points);
            const strokeColor = m.stroke || "#2ecc71";
            const strokeWidth = m.strokeWidth || 2;
            const strokeDasharray = m.strokeDasharray === 'none' ? undefined : (m.strokeDasharray === 'dashed' ? '12, 12' : (m.strokeDasharray === 'dotted' ? '2, 8' : m.strokeDasharray));
            const fillColor = m.fill || "rgba(108, 176, 86, 0.25)";
            const fontSize = m.fontSize || 14;
            const textColor = m.textColor || strokeColor;
            const opacity = m.opacity ?? 1;

            return (
                <g key={m.id} {...measCommon} style={{ ...measCommon.style, opacity }}>
                    <polygon
                        points={pointsStr}
                        fill={fillColor}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth / Math.max(1e-6, viewScale)}
                        strokeDasharray={strokeDasharray}
                        vectorEffect="non-scaling-stroke"
                    />
                    <text
                        x={m.points[0].x}
                        y={m.points[0].y - 8 / Math.max(1e-6, viewScale)}
                        fill={textColor}
                        fontSize={fontSize / Math.max(1e-6, viewScale)}
                        vectorEffect="non-scaling-stroke"
                    >
                        {toUnits2(area).toFixed(2)} {unit}²
                    </text>
                    {isSelected && (
                        <>
                            {/* Selection highlight on the polygon */}
                            <polygon
                                points={pointsStr}
                                fill="none"
                                stroke="var(--primary-color)"
                                strokeWidth={nonScalingStroke * 2}
                                vectorEffect="non-scaling-stroke"
                                opacity={0.5}
                                pointerEvents="none"
                            />
                            {/* Handles at each vertex */}
                            {m.points.map((p, idx) => (
                                <circle
                                    key={idx}
                                    cx={p.x}
                                    cy={p.y}
                                    r={handleSize / 2}
                                    fill="#b4e6a0"
                                    stroke="#3a6b24"
                                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                                    vectorEffect="non-scaling-stroke"
                                    cursor="default"
                                    data-resize-id={m.id}
                                    data-resize-handle={`vertex-${idx}`}
                                />
                            ))}
                        </>
                    )}
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

        const isEditing = editingId === m.id;
        const measOpacity = m.opacity ?? 1;

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

                const { start, knee, end } = getCalloutPoints(m.box, m.tip, m.knee, m.rotation || 0);

                // Shorten the last segment for callout (knee -> tip)
                // Vector from knee to tip
                const tipDx = end.x - knee.x;
                const tipDy = end.y - knee.y;
                const len = Math.hypot(tipDx, tipDy);
                const rawSw = m.strokeWidth || 2;
                const sw = rawSw / Math.max(1e-6, viewScale);
                const offset = 4 * sw; // refX=2, tip=6 => diff=4

                let drawTx = end.x;
                let drawTy = end.y;

                if (len > offset) {
                    const t = (len - offset) / len;
                    drawTx = knee.x + tipDx * t;
                    drawTy = knee.y + tipDy * t;
                } else {
                    drawTx = knee.x;
                    drawTy = knee.y;
                }

                const points = `${start.x},${start.y} ${knee.x},${knee.y} ${drawTx},${drawTy}`;

                // Fix: Apply stroke style to Leader
                const strokeDasharray = m.strokeDasharray === 'dashed' ? '12, 12'
                    : m.strokeDasharray === 'dotted' ? '2, 8'
                        : (m.strokeDasharray === 'none' ? undefined : m.strokeDasharray);

                let angle = 0;
                if (len > 1e-6) {
                    angle = Math.atan2(tipDy, tipDx) * (180 / Math.PI);
                } else {
                    // Knee is at tip? Use start -> end direction
                    const startDx = end.x - start.x;
                    const startDy = end.y - start.y;
                    if (Math.hypot(startDx, startDy) > 1e-6) {
                        angle = Math.atan2(startDy, startDx) * (180 / Math.PI);
                    }
                }
                const arrowTransform = `translate(${end.x}, ${end.y}) rotate(${angle}) scale(${sw})`;

                return (
                    <>
                        {/* Manual Arrow Head */}
                        <polygon
                            points="0,0 -8,-3 -8,3"
                            transform={arrowTransform}
                            fill={m.stroke || "#333"}
                            vectorEffect="non-scaling-stroke"
                        />
                        <polyline
                            points={points}
                            fill="none"
                            stroke={m.stroke || "#333"}
                            strokeWidth={sw}
                            vectorEffect="non-scaling-stroke"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={strokeDasharray}
                        />
                        {/* Hit Target for Arrow Tip Marker */}
                        <circle
                            cx={end.x}
                            cy={end.y}
                            r={7.7 / Math.max(1e-6, viewScale)}
                            fill="transparent"
                            stroke="none"
                            data-meas-id={m.id}
                            style={{ pointerEvents: 'all', cursor: 'move' }}
                        />
                    </>
                );
            }
            return null;
        };

        const fontSize = m.fontSize || 14;
        const textColor = m.textColor || m.stroke || "black";
        const borderColor = m.stroke || "#333";
        const bgColor = m.fill || (m.type === "text" ? "transparent" : "#fff");

        return (
            <g key={m.id} {...measCommon}>
                {/* Content Group with Opacity */}
                <g style={{ opacity: measOpacity }}>
                    {renderConnector()}
                    <g transform={m.rotation ? `rotate(${m.rotation}, ${m.box.x + m.box.w / 2}, ${m.box.y + m.box.h / 2})` : undefined}>
                        {/* Background Rect for Styling */}
                        <rect
                            x={m.box.x}
                            y={m.box.y}
                            width={m.box.w}
                            height={m.box.h}
                            fill={bgColor}
                            stroke={borderColor}
                            strokeWidth={m.strokeWidth || 1}
                            strokeDasharray={
                                m.strokeDasharray === 'dashed' ? '12, 12' :
                                    m.strokeDasharray === 'dotted' ? '2, 8' :
                                        (m.strokeDasharray === 'none' ? undefined : m.strokeDasharray)
                            }
                            strokeLinecap="round" // Fix for dotted style disappearing
                            vectorEffect="non-scaling-stroke"
                            rx={0} ry={0}
                        />

                        <foreignObject
                            x={m.box.x}
                            y={m.box.y}
                            width={m.box.w}
                            height={m.box.h}
                            className="foreignObject"
                            style={{
                                overflow: 'visible',
                                pointerEvents: 'all',
                                cursor: activeTool === "select" ? "move" : "default"
                            }}
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
                                        border: "none",
                                        background: "transparent",
                                        color: textColor,
                                        padding: "4px",
                                        margin: 0,
                                        fontSize: `${fontSize}px`,
                                        fontFamily: 'sans-serif',
                                        overflow: "visible",
                                        whiteSpace: "pre-wrap",
                                        cursor: activeTool === "select" ? "move" : "pointer",
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
                </g>

                {/* Handles outside Opacity group */}
                {
                    isSelected && (
                        <g transform={`translate(${m.box.x}, ${m.box.y}) ${m.rotation ? `rotate(${m.rotation}, ${m.box.w / 2}, ${m.box.h / 2})` : ''}`}>
                            {renderSelectionFrame({
                                id: m.id,
                                x: 0,
                                y: 0,
                                width: m.box.w,
                                height: m.box.h,
                                rotation: 0, // Already applied to group
                                type: "rectangle", // Proxy but we can pass extra meta
                                isCallout: m.type === 'callout'
                            })}
                        </g>
                    )
                }

                {
                    isSelected && m.type === 'callout' && (
                        <>
                            {/* Tip Handle - Outside Opacity Group */}
                            {m.tip && (
                                <circle
                                    cx={m.tip.x}
                                    cy={m.tip.y}
                                    r={3.5 / Math.max(1e-6, viewScale)}
                                    fill="#b4e6a0"
                                    stroke="#3a6b24"
                                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                                    data-resize-id={m.id}
                                    data-resize-handle="callout-tip"
                                    cursor="default"
                                />
                            )}

                            {(() => {
                                // Use helper to get current displayed knee
                                const k = getCalloutKnee(m.box, m.tip, m.knee);

                                return (
                                    <circle
                                        cx={k.x}
                                        cy={k.y}
                                        r={3.5 / Math.max(1e-6, viewScale)}
                                        fill="#ffcc80"
                                        stroke="#ef6c00"
                                        strokeWidth={1 / Math.max(1e-6, viewScale)}
                                        data-resize-id={m.id}
                                        data-resize-handle="callout-knee"
                                        cursor="default"
                                    />
                                );
                            })()}
                        </>
                    )
                }
            </g >
        );
    }



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
        <div style={{ position: "absolute", top: 0, left: 0, width, height }}>
            {/* 1) Canvas Layer should not intercept input */}
            <div style={{ pointerEvents: "none" }}>
                <OverlayCanvasLayer
                    width={width}
                    height={height}
                    viewScale={viewScale}
                    renderScale={renderScale}
                    shapes={isDraggingItems ? pageShapes.filter(s => !selectedIds.includes(s.id)) : pageShapes}
                    measurements={
                        (isDraggingItems ? pageMeasurements.filter(m => !selectedIds.includes(m.id)) : pageMeasurements)
                            .filter(m => !["length", "area", "perimeter"].includes(m.type))
                    }
                    selectedIds={selectedIds}
                    pageIndex={pageIndex}
                    pageUnits={pageUnits}
                    calibrationScales={calibrationScales}
                />
            </div>

            {/* 2) SVG Layer should receive input */}
            <svg
                ref={svgRef}
                className="absolute top-0 left-0 w-full h-full select-none z-10"
                width={width}
                height={height}
                viewBox={viewBox}
                style={{ position: "absolute", top: 0, left: 0, pointerEvents: "all", overflow: "visible" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={() => finishDrawing()}
            >
                {/* 1️⃣ INVISIBLE SHAPE HIT TARGETS */}
                {activeTool === "select" && pageShapes.map(renderShapeHitTarget)}

                {/* Selected / OOB Shapes */}
                {pageShapes
                    .filter(s => selectedIds.includes(s.id) || isOutOfBounds(s))
                    .map(s => {
                        let shapeToRender = s;

                        if (dragDelta.x !== 0 || dragDelta.y !== 0) {
                            if (selectedIds.includes(s.id)) {
                                const dx = dragDelta.x, dy = dragDelta.y;
                                if (s.type === "line" || s.type === "arrow") {
                                    shapeToRender = {
                                        ...s,
                                        start: { x: s.start.x + dx, y: s.start.y + dy },
                                        end: { x: s.end.x + dx, y: s.end.y + dy },
                                    };
                                } else {
                                    shapeToRender = { ...s, x: s.x + dx, y: s.y + dy };
                                }
                            }
                        }

                        return renderShape(shapeToRender);
                    })
                }

                {/* Selected / OOB Measurements */}
                {pageMeasurements
                    .filter(m =>
                        selectedIds.includes(m.id) ||
                        ["comment", "text", "callout", "length", "area", "perimeter"].includes(m.type) ||
                        isOutOfBounds(m)
                    )
                    .map(m => {
                        let measToRender = m;

                        if (dragDelta.x !== 0 || dragDelta.y !== 0) {
                            if (selectedIds.includes(m.id)) {
                                const dx = dragDelta.x, dy = dragDelta.y;

                                // IMPORTANT: when dragging callout, only box moves
                                // User request update: "leader should also be able to attach..." & "moving the textbox should only move the textbox"
                                // BUT if we have a manual knee, that knee is usually relative to the box-tip relationship.
                                // If we just move the box and keep the knee absolute, the leader shape distorts awkwardly.
                                // Usually if I drag the box, I want the whole "assembly" (stub) to move with it?
                                // Let's move the knee by delta too if it exists.
                                if (m.type === "callout") {
                                    const newBox = { ...m.box, x: m.box.x + dx, y: m.box.y + dy };
                                    const changes = { box: newBox };

                                    // Fix: If knee is auto (null), calculate its current position and move it
                                    // so it doesn't "re-flow" during drag.
                                    const currentKnee = m.knee || getCalloutKnee(m.box, m.tip, null);
                                    changes.knee = { x: currentKnee.x + dx, y: currentKnee.y + dy };

                                    measToRender = {
                                        ...m,
                                        ...changes
                                    };
                                } else if (m.box) {
                                    measToRender = { ...m, box: { ...m.box, x: m.box.x + dx, y: m.box.y + dy } };
                                } else if (m.points) {
                                    measToRender = {
                                        ...m,
                                        points: m.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
                                    };
                                }
                            }
                        }

                        return renderMeasurement(measToRender);
                    })
                }

                {/* Render active drawing shape */}
                {isDrawingRef.current && shapeStart && cursor && (
                    (() => {
                        // Temporary shape for preview
                        const tempId = "temp-draw";

                        if (activeTool === "callout") {
                            // Preview Callout
                            const w = 125;
                            const h = 25;
                            const dx = cursor.x - shapeStart.x;
                            const dy = cursor.y - shapeStart.y;

                            // Box Position: Cursor is Connection Point.
                            // Knee Stub: Fixed 40px from connection point.
                            const stub = 40;
                            let bx, kneeX, by, kneeY;

                            if (Math.abs(dy) > Math.abs(dx)) {
                                // Vertical Mode
                                bx = cursor.x - w / 2;

                                if (dy >= 0) {
                                    // Dragged Down -> Box Below
                                    by = cursor.y;
                                    kneeY = cursor.y - stub;
                                } else {
                                    // Dragged Up -> Box Above
                                    by = cursor.y - h;
                                    kneeY = cursor.y + stub;
                                }
                                kneeX = cursor.x;
                            } else {
                                // Horizontal Mode (Existing logic)
                                if (dx >= 0) {
                                    bx = cursor.x;
                                    kneeX = cursor.x - stub;
                                } else {
                                    bx = cursor.x - w;
                                    kneeX = cursor.x + stub;
                                }
                                // Center vertically on cursor
                                by = cursor.y - h / 2;
                                kneeY = cursor.y;
                            }

                            const box = {
                                x: bx,
                                y: by,
                                w,
                                h
                            };
                            const m = {
                                id: tempId,
                                type: "callout",
                                box,
                                tip: shapeStart,
                                knee: { x: kneeX, y: kneeY }, // Explicit knee for preview
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
