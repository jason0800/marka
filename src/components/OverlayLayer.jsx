import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import useAppStore from "../stores/useAppStore";
import { calculateDistance, calculatePolygonArea, getCloudPath } from "../geometry/transforms";
import { findShapeAtPoint, findItemAtPoint } from "../geometry/hitTest";
import OverlayCanvasLayer from "./OverlayCanvasLayer";
import * as pdfjsLib from 'pdfjs-dist';
import { Scissors, Copy, Clipboard, Trash2, Sliders, XCircle, CheckSquare, Layers, Star, Paintbrush, Play } from 'lucide-react';

const deleteVertexCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M0,0 L0,16.7 L4.6,12 L8.3,19.5 L10.8,18.3 L7.1,10.8 L12,10.8 Z' fill='white' stroke='black' stroke-width='1' stroke-linejoin='miter'/><line x1='14' y1='5' x2='19' y2='5' stroke='white' stroke-width='3.5' stroke-linecap='round'/><line x1='14' y1='5' x2='19' y2='5' stroke='black' stroke-width='1.5' stroke-linecap='round'/></svg>") 0 0, default`;
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
        const maxStub = 30;
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
const snapTo45Degrees = (start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    return {
        x: start.x + r * Math.cos(snappedAngle),
        y: start.y + r * Math.sin(snappedAngle)
    };
};

const OverlayLayer = ({ page, width, height, viewScale: propViewScale = 1.0, renderScale = 1.0, rotation = 0 }) => {
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
        setDefaultShapeStyle,
        viewport,
        snappingEnabled,
        cut,
        copy,
        paste,
        clipboard,
        leftPanelActiveTab,
        setLeftPanelActiveTab,
        formatPaintStyle,
        setFormatPaintStyle,
        currentPage,
    } = useAppStore();

    const viewScale = (viewport && viewport.scale) ? viewport.scale : propViewScale;

    const svgRef = useRef(null);

    // Page meta (PDF points)
    const pageIndex = page.pageNumber;
    const calibrationScale = calibrationScales[pageIndex - 1] || 1.0; // (pdfPoints per unit) OR (px per unit) - whatever you defined
    const unit = pageUnits[pageIndex - 1] || "px";

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
    const drawStartTimeRef = useRef(0);
    const pendingDeselectIdRef = useRef(null);

    const setIsDrawing = useCallback((val) => {
        isDrawingRef.current = val;
        setIsDrawingState(val);
    }, []);

    const [drawingPoints, setDrawingPoints] = useState([]); // for area/perimeter/length/comment
    const [cursor, setCursor] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [snapIndicator, setSnapIndicator] = useState(null);

    // Shape draw (rect/circle/line/arrow)
    const [shapeStart, setShapeStart] = useState(null);

    // Selection / drag
    const [selectionStart, setSelectionStart] = useState(null);
    const [dragStart, setDragStart] = useState(null);
    const [isDraggingItems, setIsDraggingItems] = useState(false);
    const [dragStartItems, setDragStartItems] = useState({});

    // Resize
    const [resizingState, setResizingState] = useState(null); // { id, handle, startShape, startPoint }

    // Context menu state
    const [canvasContextMenu, setCanvasContextMenu] = useState(null);

    // Shift key tracking state for cursor updates and snapping
    const [isShiftPressed, setIsShiftPressed] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Shift") {
                setIsShiftPressed(true);
            }
        };
        const handleKeyUp = (e) => {
            if (e.key === "Shift") {
                setIsShiftPressed(false);
            }
        };
        const handleBlur = () => {
            setIsShiftPressed(false);
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    // Active count group reference
    const activeCountGroupIdRef = useRef(null);

    useEffect(() => {
        if (activeTool !== "count") {
            activeCountGroupIdRef.current = null;
        }
    }, [activeTool]);

    // Auto-close context menu on click elsewhere & handle image paste
    useEffect(() => {
        const handleWindowClick = (e) => {
            if (e.target.closest('.context-menu-container')) {
                return;
            }
            setCanvasContextMenu(null);
        };

        const handlePaste = (e) => {
            if (pageIndex !== currentPage) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // 1. Check for image pasting in system clipboard first
            const items = e.clipboardData?.items;
            if (items) {
                let hasImage = false;
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.type.startsWith('image/')) {
                        hasImage = true;
                        const file = item.getAsFile();
                        if (!file) continue;

                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const dataUrl = event.target.result;
                            const img = new Image();
                            img.onload = () => {
                                let w = img.width || 300;
                                let h = img.height || 200;
                                const maxSide = 400;
                                if (w > maxSide || h > maxSide) {
                                    const ratio = Math.min(maxSide / w, maxSide / h);
                                    w = Math.round(w * ratio);
                                    h = Math.round(h * ratio);
                                }

                                const newId = crypto.randomUUID();
                                const newImageShape = {
                                    id: newId,
                                    type: "image",
                                    src: dataUrl,
                                    x: 100,
                                    y: 100,
                                    width: w,
                                    height: h,
                                    rotation: 0,
                                    stroke: "#000000",
                                    strokeWidth: 0,
                                    fill: "none",
                                    opacity: 1,
                                    pageIndex: pageIndex,
                                };
                                addShape(newImageShape);
                                setSelectedIds([newId]);
                                pushHistory();
                            };
                            img.src = dataUrl;
                        };
                        reader.readAsDataURL(file);
                        e.preventDefault();
                        break;
                    }
                }
                if (hasImage) return;
            }

            // 2. Fallback to app's internal memory clipboard if it contains items
            if (clipboard && clipboard.length > 0) {
                e.preventDefault();
                paste();
                pushHistory();
                return;
            }
        };

        window.addEventListener('click', handleWindowClick);
        window.addEventListener('pointerdown', handleWindowClick);
        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('click', handleWindowClick);
            window.removeEventListener('pointerdown', handleWindowClick);
            window.removeEventListener('paste', handlePaste);
        };
    }, [pageIndex, currentPage, addShape, setSelectedIds, pushHistory, clipboard, paste]);

    const duplicateSelected = () => {
        const selectedShapes = shapes.filter(s => selectedIds.includes(s.id));
        const selectedMeas = measurements.filter(m => selectedIds.includes(m.id));
        const newIds = [];

        selectedShapes.forEach(s => {
            const newId = crypto.randomUUID();
            newIds.push(newId);
            addShape({
                ...s,
                id: newId,
                x: s.x !== undefined ? s.x + 20 : undefined,
                y: s.y !== undefined ? s.y + 20 : undefined,
                start: s.start ? { x: s.start.x + 20, y: s.start.y + 20 } : undefined,
                end: s.end ? { x: s.end.x + 20, y: s.end.y + 20 } : undefined,
                points: s.points ? s.points.map(p => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
            });
        });

        selectedMeas.forEach(m => {
            const newId = crypto.randomUUID();
            newIds.push(newId);
            addMeasurement({
                ...m,
                id: newId,
                points: m.points ? m.points.map(p => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
                point: m.point ? { x: m.point.x + 20, y: m.point.y + 20 } : undefined,
                box: m.box ? { ...m.box, x: m.box.x + 20, y: m.box.y + 20 } : undefined,
                tip: m.tip ? { x: m.tip.x + 20, y: m.tip.y + 20 } : undefined,
                knee: m.knee ? { x: m.knee.x + 20, y: m.knee.y + 20 } : undefined,
            });
        });

        if (newIds.length > 0) {
            setSelectedIds(newIds);
            pushHistory();
        }
    };

    const handleCut = () => {
        cut();
        pushHistory();
        setCanvasContextMenu(null);
    };

    const handleCopy = () => {
        copy();
        setCanvasContextMenu(null);
    };

    const handlePaste = () => {
        paste();
        pushHistory();
        setCanvasContextMenu(null);
    };

    const handleDelete = () => {
        if (selectedIds.length > 0) {
            const shapeIds = selectedIds.filter(id => pageShapes.some(s => s.id === id));
            const measIds = selectedIds.filter(id => pageMeasurements.some(m => m.id === id));
            shapeIds.forEach(id => deleteShape(id));
            measIds.forEach(id => deleteMeasurement(id));
            setSelectedIds([]);
            pushHistory();
        }
        setCanvasContextMenu(null);
    };

    const handleDuplicate = () => {
        duplicateSelected();
        setCanvasContextMenu(null);
    };

    const handleSetAsDefault = () => {
        if (selectedIds.length === 0) return;
        const targetId = selectedIds[0];
        const s = pageShapes.find(x => x.id === targetId);
        const m = pageMeasurements.find(x => x.id === targetId);
        const target = s || m;
        if (target) {
            const newDefaults = {};
            if (target.stroke !== undefined) newDefaults.stroke = target.stroke;
            if (target.fill !== undefined) newDefaults.fill = target.fill;
            if (target.strokeWidth !== undefined) newDefaults.strokeWidth = target.strokeWidth;
            if (target.strokeDasharray !== undefined) newDefaults.strokeDasharray = target.strokeDasharray;
            if (target.opacity !== undefined) newDefaults.opacity = target.opacity;
            if (target.fontSize !== undefined) newDefaults.fontSize = target.fontSize;
            if (target.textColor !== undefined) newDefaults.textColor = target.textColor;
            if (target.shape !== undefined) newDefaults.shape = target.shape;
            if (target.scale !== undefined) newDefaults.scale = target.scale;

            setDefaultShapeStyle(newDefaults);
        }
        setCanvasContextMenu(null);
    };

    const handleDeselectAll = () => {
        setSelectedIds([]);
        setCanvasContextMenu(null);
    };

    const handleSelectAll = () => {
        const allIds = [
            ...pageShapes.map(s => s.id),
            ...pageMeasurements.map(m => m.id)
        ];
        setSelectedIds(allIds);
        setCanvasContextMenu(null);
    };

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetShapeRef = e.target.closest('[data-shape-id]');
        const targetMeasRef = e.target.closest('[data-meas-id]');
        const targetShapeId = targetShapeRef?.getAttribute("data-shape-id");
        const targetMeasId = targetMeasRef?.getAttribute("data-meas-id");
        const hitId = targetShapeId || targetMeasId;

        if (hitId) {
            if (!selectedIds.includes(hitId)) {
                setSelectedIds([hitId]);
            }
            setCanvasContextMenu({
                x: e.clientX,
                y: e.clientY,
                type: 'object',
                targetId: hitId
            });
        } else {
            setCanvasContextMenu({
                x: e.clientX,
                y: e.clientY,
                type: 'canvas',
                targetId: null
            });
        }
    };

    const resizingStateRef = useRef(null);
    const isDraggingItemsRef = useRef(false);
    const isDraggingTextRef = useRef(false);
    useEffect(() => {
        resizingStateRef.current = resizingState;
    }, [resizingState]);
    useEffect(() => {
        isDraggingItemsRef.current = isDraggingItems;
    }, [isDraggingItems]);

    // Reset local drawing states when activeTool changes to prevent leaks
    useEffect(() => {
        setIsDrawing(false);
        setShapeStart(null);
        setDrawingPoints([]);
        setCursor(null);
        setSnapIndicator(null);

        // Deselect everything when switching to any drawing tool
        if (activeTool !== "select") {
            setSelectedIds([]);
        }
    }, [activeTool, setIsDrawing, setSelectedIds]);

    const [pdfVectors, setPdfVectors] = useState({ corners: [], segments: [] });

    useEffect(() => {
        let active = true;
        const fetchVectors = async () => {
            try {
                const opList = await page.getOperatorList();
                if (!active) return;

                const extractedCorners = [];
                const extractedSegments = [];

                const { fnArray, argsArray } = opList;
                const OPS = pdfjsLib.OPS;

                // CTM (Current Transformation Matrix) tracking
                let ctm = [1, 0, 0, 1, 0, 0];
                const ctmStack = [];

                // Helper to transform point by CTM and convert to viewport
                const transform = (x, y) => {
                    const tx = ctm[0] * x + ctm[2] * y + ctm[4];
                    const ty = ctm[1] * x + ctm[3] * y + ctm[5];
                    return unscaledViewport.convertToViewportPoint(tx, ty);
                };

                let currentPoint = { x: 0, y: 0 };
                let pathStartPoint = { x: 0, y: 0 };

                for (let i = 0; i < fnArray.length; i++) {
                    const fn = fnArray[i];
                    const args = argsArray[i];

                    if (fn === OPS.save) {
                        ctmStack.push([...ctm]);
                    } else if (fn === OPS.restore) {
                        if (ctmStack.length > 0) {
                            ctm = ctmStack.pop();
                        }
                    } else if (fn === OPS.transform) {
                        const [a1, b1, c1, d1, e1, f1] = ctm;
                        const [a2, b2, c2, d2, e2, f2] = args;
                        ctm = [
                            a1 * a2 + c1 * b2,
                            b1 * a2 + d1 * b2,
                            a1 * c2 + c1 * d2,
                            b1 * c2 + d1 * d2,
                            a1 * e2 + c1 * f2 + e1,
                            b1 * e2 + d1 * f2 + f1
                        ];
                    } else if (fn === OPS.constructPath) {
                        const [pathOps, pathArgs] = args;
                        let argIdx = 0;
                        for (let j = 0; j < pathOps.length; j++) {
                            const op = pathOps[j];
                            if (op === OPS.moveTo) {
                                const x = pathArgs[argIdx];
                                const y = pathArgs[argIdx + 1];
                                const [vx, vy] = transform(x, y);
                                currentPoint = { x: vx, y: vy };
                                pathStartPoint = { x: vx, y: vy };
                                extractedCorners.push({ x: vx, y: vy });
                                argIdx += 2;
                            } else if (op === OPS.lineTo) {
                                const x = pathArgs[argIdx];
                                const y = pathArgs[argIdx + 1];
                                const [vx, vy] = transform(x, y);
                                const endPt = { x: vx, y: vy };
                                extractedSegments.push({ a: { ...currentPoint }, b: endPt });
                                currentPoint = endPt;
                                extractedCorners.push(endPt);
                                argIdx += 2;
                            } else if (op === OPS.curveTo) {
                                const x = pathArgs[argIdx + 4];
                                const y = pathArgs[argIdx + 5];
                                const [vx, vy] = transform(x, y);
                                const endPt = { x: vx, y: vy };
                                extractedSegments.push({ a: { ...currentPoint }, b: endPt });
                                currentPoint = endPt;
                                extractedCorners.push(endPt);
                                argIdx += 6;
                            } else if (op === OPS.curveTo2) {
                                const x = pathArgs[argIdx + 2];
                                const y = pathArgs[argIdx + 3];
                                const [vx, vy] = transform(x, y);
                                const endPt = { x: vx, y: vy };
                                extractedSegments.push({ a: { ...currentPoint }, b: endPt });
                                currentPoint = endPt;
                                extractedCorners.push(endPt);
                                argIdx += 4;
                            } else if (op === OPS.curveTo3) {
                                const x = pathArgs[argIdx + 2];
                                const y = pathArgs[argIdx + 3];
                                const [vx, vy] = transform(x, y);
                                const endPt = { x: vx, y: vy };
                                extractedSegments.push({ a: { ...currentPoint }, b: endPt });
                                currentPoint = endPt;
                                extractedCorners.push(endPt);
                                argIdx += 4;
                            } else if (op === OPS.closePath) {
                                extractedSegments.push({ a: { ...currentPoint }, b: { ...pathStartPoint } });
                                currentPoint = { ...pathStartPoint };
                            } else if (op === OPS.rectangle) {
                                const x = pathArgs[argIdx];
                                const y = pathArgs[argIdx + 1];
                                const w = pathArgs[argIdx + 2];
                                const h = pathArgs[argIdx + 3];
                                const [vx1, vy1] = transform(x, y);
                                const [vx2, vy2] = transform(x + w, y);
                                const [vx3, vy3] = transform(x + w, y + h);
                                const [vx4, vy4] = transform(x, y + h);
                                const p1 = { x: vx1, y: vy1 };
                                const p2 = { x: vx2, y: vy2 };
                                const p3 = { x: vx3, y: vy3 };
                                const p4 = { x: vx4, y: vy4 };
                                extractedCorners.push(p1, p2, p3, p4);
                                extractedSegments.push(
                                    { a: p1, b: p2 },
                                    { a: p2, b: p3 },
                                    { a: p3, b: p4 },
                                    { a: p4, b: p1 }
                                );
                                argIdx += 4;
                            }
                        }
                    } else if (fn === OPS.moveTo) {
                        const x = args[0];
                        const y = args[1];
                        const [vx, vy] = transform(x, y);
                        currentPoint = { x: vx, y: vy };
                        pathStartPoint = { x: vx, y: vy };
                        extractedCorners.push({ x: vx, y: vy });
                    } else if (fn === OPS.lineTo) {
                        const x = args[0];
                        const y = args[1];
                        const [vx, vy] = transform(x, y);
                        const endPt = { x: vx, y: vy };
                        extractedSegments.push({ a: { ...currentPoint }, b: endPt });
                        currentPoint = endPt;
                        extractedCorners.push(endPt);
                    } else if (fn === OPS.rectangle) {
                        const x = args[0];
                        const y = args[1];
                        const w = args[2];
                        const h = args[3];
                        const [vx1, vy1] = transform(x, y);
                        const [vx2, vy2] = transform(x + w, y);
                        const [vx3, vy3] = transform(x + w, y + h);
                        const [vx4, vy4] = transform(x, y + h);
                        const p1 = { x: vx1, y: vy1 };
                        const p2 = { x: vx2, y: vy2 };
                        const p3 = { x: vx3, y: vy3 };
                        const p4 = { x: vx4, y: vy4 };
                        extractedCorners.push(p1, p2, p3, p4);
                        extractedSegments.push(
                            { a: p1, b: p2 },
                            { a: p2, b: p3 },
                            { a: p3, b: p4 },
                            { a: p4, b: p1 }
                        );
                    }
                }

                // Deduplicate corners to speed up snapping lookup
                const uniqueCorners = [];
                const seen = new Set();
                extractedCorners.forEach(c => {
                    const key = `${Math.round(c.x * 100)},${Math.round(c.y * 100)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueCorners.push(c);
                    }
                });

                setPdfVectors({ corners: uniqueCorners, segments: extractedSegments });
            } catch (err) {
                console.error("Failed to extract vectors from PDF page:", err);
            }
        };

        fetchVectors();
        return () => {
            active = false;
        };
    }, [page, unscaledViewport]);

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
        const transformed = point.matrixTransform(matrix);
        return { x: transformed.x, y: transformed.y };
    }, []);

    // Get snapped coordinates from a raw page point
    const getSnappedPoint = useCallback((rawPoint, excludeId = null) => {
        if (!snappingEnabled || activeTool !== "length") {
            return { point: rawPoint, snapped: false, type: null };
        }

        const threshold = 16 / Math.max(1e-6, viewScale); // 16 screen pixels
        let closestPoint = null;
        let minDistance = Infinity;
        let snapType = null; // 'corner' or 'edge'

        // 1. Check candidate corners parsed from PDF vectors
        pdfVectors.corners.forEach(c => {
            const dist = Math.hypot(rawPoint.x - c.x, rawPoint.y - c.y);
            if (dist < minDistance && dist <= threshold) {
                minDistance = dist;
                closestPoint = { x: c.x, y: c.y };
                snapType = 'corner';
            }
        });

        if (closestPoint) {
            return { point: closestPoint, snapped: true, type: snapType };
        }

        // 2. Check candidate segments parsed from PDF vectors
        pdfVectors.segments.forEach(seg => {
            const { a, b } = seg;
            const abX = b.x - a.x;
            const abY = b.y - a.y;
            const abLenSq = abX * abX + abY * abY;
            if (abLenSq < 1e-6) return;

            const apX = rawPoint.x - a.x;
            const apY = rawPoint.y - a.y;

            let t = (apX * abX + apY * abY) / abLenSq;
            t = Math.max(0, Math.min(1, t)); // clamp to segment bounds

            const projPoint = {
                x: a.x + t * abX,
                y: a.y + t * abY
            };

            const dist = Math.hypot(rawPoint.x - projPoint.x, rawPoint.y - projPoint.y);
            if (dist < minDistance && dist <= threshold) {
                minDistance = dist;
                closestPoint = projPoint;
                snapType = 'edge';
            }
        });

        if (closestPoint) {
            return { point: closestPoint, snapped: true, type: snapType };
        }

        return { point: rawPoint, snapped: false, type: null };
    }, [snappingEnabled, viewScale, activeTool, pdfVectors]);

    const finishDrawing = useCallback((isDoubleClick = false) => {
        if (!isDrawingRef.current) return;

        let pointsToProcess = [...drawingPoints];

        // If finishing via double click, the last point is the second click of the double-click gesture.
        // We want to discard it so that we don't end up with a duplicate or micro-segment at the end.
        if (isDoubleClick && pointsToProcess.length > 1) {
            pointsToProcess.pop();
        }

        // Filter out coincident or extremely close consecutive points in screen coordinates
        let pts = [];
        const scale = viewScale || 1.0;
        const screenThreshold = 2; // 2 screen pixels is enough for micro-movements
        for (const p of pointsToProcess) {
            if (pts.length === 0) {
                pts.push(p);
            } else {
                const prev = pts[pts.length - 1];
                const distPage = Math.hypot(p.x - prev.x, p.y - prev.y);
                const distScreen = distPage * scale;
                if (distScreen > screenThreshold) {
                    pts.push(p);
                }
            }
        }

        if (activeTool === "area" && pts.length >= 3) {
            addMeasurement({
                id: crypto.randomUUID(),
                type: "area",
                pageIndex,
                points: pts,
            });
            pushHistory();
        } else if (activeTool === "perimeter" && pts.length >= 2) {
            addMeasurement({
                id: crypto.randomUUID(),
                type: "perimeter",
                pageIndex,
                points: pts,
            });
            pushHistory();
        } else if (activeTool === "polylength" && pts.length >= 2) {
            addMeasurement({
                id: crypto.randomUUID(),
                type: "polylength",
                pageIndex,
                points: pts,
                stroke: defaultShapeStyle.stroke || "#16a085",
                strokeWidth: defaultShapeStyle.strokeWidth || 2,
                strokeDasharray: defaultShapeStyle.strokeDasharray || "none",
                opacity: defaultShapeStyle.opacity !== undefined ? defaultShapeStyle.opacity : 1,
            });
            pushHistory();
        } else if (activeTool === "polyline" && pts.length >= 2) {
            addShape({
                id: crypto.randomUUID(),
                type: "polyline",
                pageIndex,
                points: pts,
                ...defaultShapeStyle,
            });
            pushHistory();
        } else if (activeTool === "polygon" && pts.length >= 3) {
            addShape({
                id: crypto.randomUUID(),
                type: "polygon",
                pageIndex,
                points: pts,
                ...defaultShapeStyle,
            });
            pushHistory();
        }

        setIsDrawing(false);
        setDrawingPoints([]);
        setShapeStart(null);

        // Auto-switch to select mode after drawing
        setActiveTool("select");
    }, [activeTool, drawingPoints, addMeasurement, addShape, defaultShapeStyle, pageIndex, pushHistory, setActiveTool, setIsDrawing, viewScale]);

    const editingIdRef = useRef(editingId);
    useEffect(() => {
        editingIdRef.current = editingId;
    }, [editingId]);

    const finishDrawingRef = useRef(finishDrawing);
    useEffect(() => {
        finishDrawingRef.current = finishDrawing;
    }, [finishDrawing]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKeyDown = (e) => {
            if (editingIdRef.current) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === "Enter") {
                if (finishDrawingRef.current) finishDrawingRef.current();
            }

            if (e.key === "Delete" || e.key === "Backspace") {
                const { shapes, measurements, selectedIds, deleteShape, deleteMeasurement, setSelectedIds, pushHistory } = useAppStore.getState();
                if (selectedIds.length > 0) {
                    const pageShapes = shapes.filter(s => s.pageIndex === pageIndex);
                    const pageMeasurements = measurements.filter(m => m.pageIndex === pageIndex);
                    const shapeIds = selectedIds.filter(id => pageShapes.some(s => s.id === id));
                    const measIds = selectedIds.filter(id => pageMeasurements.some(m => m.id === id));

                    shapeIds.forEach(id => deleteShape(id));
                    measIds.forEach(id => deleteMeasurement(id));
                    setSelectedIds([]);
                    pushHistory();
                }
            }

            if (e.key === "Escape") {
                const { undo, setActiveTool, setSelectedIds } = useAppStore.getState();
                if (resizingStateRef.current || isDraggingItemsRef.current) {
                    undo();
                    setResizingState(null);
                    setIsDraggingItems(false);
                    setDragStart(null);
                    setDragDelta({ x: 0, y: 0 });
                }
                setIsDrawing(false);
                setDrawingPoints([]);
                setShapeStart(null);
                setEditingId(null);
                setSelectionStart(null);
                setSelectedIds([]);
                activeCountGroupIdRef.current = null;
                setActiveTool('select'); // Return to select mode
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

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

        const rawPoint = getPagePoint(e);
        if (!rawPoint) return;

        // Shift-click to add/remove vertices
        if (e.shiftKey) {
            const resizeHandle = e.target.getAttribute("data-resize-handle");
            const resizeId = e.target.getAttribute("data-resize-id");

            if (resizeHandle && resizeHandle.startsWith('vertex-') && resizeId) {
                // REMOVE VERTEX
                const vertexIdx = parseInt(resizeHandle.split('-')[1], 10);
                const s = pageShapes.find(x => x.id === resizeId);
                const m = pageMeasurements.find(x => x.id === resizeId);

                if (s && s.points) {
                    const newPoints = [...s.points];
                    newPoints.splice(vertexIdx, 1);
                    if (newPoints.length < 2) {
                        deleteShape(resizeId);
                        setSelectedIds([]);
                    } else {
                        updateShape(resizeId, { points: newPoints });
                    }
                    pushHistory();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                } else if (m && m.points) {
                    const newPoints = [...m.points];
                    newPoints.splice(vertexIdx, 1);
                    const minPts = m.type === 'count' ? 1 : (m.type === 'area' ? 3 : 2);
                    if (newPoints.length < minPts) {
                        deleteMeasurement(resizeId);
                        setSelectedIds([]);
                    } else {
                        updateMeasurement(resizeId, { points: newPoints });
                    }
                    pushHistory();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            } else {
                // ADD VERTEX
                const targetShapeRef = e.target.closest('[data-shape-id]');
                const targetMeasRef = e.target.closest('[data-meas-id]');
                const targetShapeId = targetShapeRef?.getAttribute("data-shape-id");
                const targetMeasId = targetMeasRef?.getAttribute("data-meas-id");
                const hitId = targetShapeId || targetMeasId;
                const isShape = !!targetShapeId;

                const item = isShape
                    ? pageShapes.find(x => x.id === hitId)
                    : pageMeasurements.find(x => x.id === hitId);

                if (item) {
                    const isClosed = item.type === 'polygon' || item.type === 'area';
                    if (['polyline', 'polygon', 'area', 'perimeter', 'polylength'].includes(item.type) && item.points) {
                        // find best insert index
                        let minDist = Infinity;
                        let insertIdx = -1;
                        const pts = item.points;
                        const limit = isClosed ? pts.length : pts.length - 1;
                        for (let i = 0; i < limit; i++) {
                            const a = pts[i];
                            const b = pts[(i + 1) % pts.length];
                            const dx = b.x - a.x;
                            const dy = b.y - a.y;
                            const lenSq = dx * dx + dy * dy;
                            let t = 0;
                            if (lenSq > 1e-9) {
                                t = ((rawPoint.x - a.x) * dx + (rawPoint.y - a.y) * dy) / lenSq;
                                t = Math.max(0, Math.min(1, t));
                            }
                            const projX = a.x + t * dx;
                            const projY = a.y + t * dy;
                            const dist = Math.hypot(rawPoint.x - projX, rawPoint.y - projY);
                            if (dist < minDist) {
                                minDist = dist;
                                insertIdx = i + 1;
                            }
                        }

                        if (insertIdx !== -1) {
                            const newPoints = [...pts];
                            newPoints.splice(insertIdx, 0, rawPoint);
                            if (isShape) {
                                updateShape(item.id, { points: newPoints });
                            } else {
                                updateMeasurement(item.id, { points: newPoints });
                            }
                            setSelectedIds([item.id]);
                            pushHistory();
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                    }
                }
            }
        }

        if (activeTool === "format-painter") {
            const targetShapeRef = e.target.closest('[data-shape-id]');
            const targetMeasRef = e.target.closest('[data-meas-id]');
            const targetShapeId = targetShapeRef?.getAttribute("data-shape-id");
            const targetMeasId = targetMeasRef?.getAttribute("data-meas-id");
            const hitId = targetShapeId || targetMeasId;
            const finalHitId = hitId || findItemAtPoint(rawPoint, pageShapes, pageMeasurements)?.item.id;

            if (finalHitId) {
                if (formatPaintStyle) {
                    pushHistory();
                    const isShape = pageShapes.some(s => s.id === finalHitId);
                    if (isShape) {
                        updateShape(finalHitId, formatPaintStyle);
                    } else {
                        updateMeasurement(finalHitId, formatPaintStyle);
                    }
                }
            }
            setActiveTool("select");
            return;
        }

        const shouldSnap = snappingEnabled && activeTool === "length";
        const snapResult = shouldSnap ? getSnappedPoint(rawPoint) : { point: rawPoint, snapped: false };
        const point = snapResult.point;

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
                if (meas && ['text', 'callout', 'length', 'area', 'perimeter', 'angle', 'count', 'polylength'].includes(meas.type)) {
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

            if (isShift && !hitId) {
                const selectedCountId = selectedIds.find(id => {
                    const m = pageMeasurements.find(x => x.id === id);
                    return m && m.type === "count";
                });
                if (selectedCountId) {
                    const existingGroup = pageMeasurements.find(x => x.id === selectedCountId);
                    if (existingGroup && existingGroup.points) {
                        const newPoints = [...existingGroup.points, { x: point.x, y: point.y }];
                        updateMeasurement(selectedCountId, { points: newPoints });
                        pushHistory();
                        return;
                    }
                }
            }

            if (hitId) {
                // DOM Hit (SVG element)
                let newSelection = [];
                const isSelected = selectedIds.includes(hitId);

                if (isShift) {
                    if (isSelected) {
                        newSelection = selectedIds;
                        pendingDeselectIdRef.current = hitId;
                    } else {
                        newSelection = [...selectedIds, hitId];
                        pendingDeselectIdRef.current = null;
                    }
                } else {
                    pendingDeselectIdRef.current = null;
                    if (isSelected) {
                        newSelection = selectedIds;
                    } else {
                        newSelection = [hitId];
                    }
                }

                setSelectedIds(newSelection);

                if (e.ctrlKey) {
                    const duplicatedIds = [];
                    const dupSnapshot = {};
                    newSelection.forEach(id => {
                        const s = pageShapes.find(x => x.id === id);
                        if (s) {
                            const newId = crypto.randomUUID();
                            duplicatedIds.push(newId);
                            const duplicatedShape = { ...s, id: newId };
                            addShape(duplicatedShape);
                            dupSnapshot[newId] = JSON.parse(JSON.stringify(duplicatedShape));
                        } else {
                            const m = pageMeasurements.find(x => x.id === id);
                            if (m) {
                                const newId = crypto.randomUUID();
                                duplicatedIds.push(newId);
                                const duplicatedMeas = { ...m, id: newId };
                                addMeasurement(duplicatedMeas);
                                dupSnapshot[newId] = JSON.parse(JSON.stringify(duplicatedMeas));
                            }
                        }
                    });
                    if (duplicatedIds.length > 0) {
                        newSelection = duplicatedIds;
                        setSelectedIds(newSelection);
                        setDragStartItems(dupSnapshot);
                    }
                } else {
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
                }

                const isClickingText = e.target.tagName.toLowerCase() === "text";
                isDraggingTextRef.current = isClickingText && newSelection.some(id => {
                    const m = pageMeasurements.find(x => x.id === id);
                    return m && ['length', 'angle', 'area', 'perimeter', 'polylength'].includes(m.type);
                });

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

                    if (e.ctrlKey) {
                        const duplicatedIds = [];
                        const dupSnapshot = {};
                        newSelection.forEach(id => {
                            const s = pageShapes.find(x => x.id === id);
                            if (s) {
                                const newId = crypto.randomUUID();
                                duplicatedIds.push(newId);
                                const duplicatedShape = { ...s, id: newId };
                                addShape(duplicatedShape);
                                dupSnapshot[newId] = JSON.parse(JSON.stringify(duplicatedShape));
                            } else {
                                const m = pageMeasurements.find(x => x.id === id);
                                if (m) {
                                    const newId = crypto.randomUUID();
                                    duplicatedIds.push(newId);
                                    const duplicatedMeas = { ...m, id: newId };
                                    addMeasurement(duplicatedMeas);
                                    dupSnapshot[newId] = JSON.parse(JSON.stringify(duplicatedMeas));
                                }
                            }
                        });
                        if (duplicatedIds.length > 0) {
                            newSelection = duplicatedIds;
                            setSelectedIds(newSelection);
                            setDragStartItems(dupSnapshot);
                        }
                    } else {
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
                    }

                    const isClickingTextCanvas = e.target.tagName.toLowerCase() === "text";
                    isDraggingTextRef.current = isClickingTextCanvas && newSelection.some(id => {
                        const m = pageMeasurements.find(x => x.id === id);
                        return m && ['length', 'angle', 'area', 'perimeter', 'polylength'].includes(m.type);
                    });

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
        if (["rectangle", "circle", "line", "arrow", "text", "callout", "highlight", "cloud"].includes(activeTool)) {
            setIsDrawing(true);
            drawStartTimeRef.current = Date.now();
            setShapeStart({ x: point.x, y: point.y });
            setCursor({ x: point.x, y: point.y });
            setSelectedIds([]);

            if (activeTool === "callout") {
                setTimeout(() => {
                    if (isDrawingRef.current && activeTool === "callout") {
                        setCursor(c => c ? { ...c } : null);
                    }
                }, 100);
            }
            return;
        }

        // 4) Measurement tools
        if (["length", "calibrate", "area", "perimeter", "angle", "polyline", "polygon", "count", "comment", "polylength"].includes(activeTool)) {
            if (activeTool === "count") {
                const activeId = activeCountGroupIdRef.current;
                const existingGroup = activeId ? pageMeasurements.find(m => m.id === activeId) : null;
                if (existingGroup && existingGroup.points) {
                    const newPoints = [...existingGroup.points, { x: point.x, y: point.y }];
                    updateMeasurement(activeId, { points: newPoints });
                    pushHistory();
                } else {
                    const newId = crypto.randomUUID();
                    activeCountGroupIdRef.current = newId;
                    addMeasurement({
                        id: newId,
                        type: "count",
                        pageIndex,
                        points: [{ x: point.x, y: point.y }],
                        shape: defaultShapeStyle.shape || "circle",
                        scale: defaultShapeStyle.scale !== undefined ? defaultShapeStyle.scale : 1.0,
                        fill: defaultShapeStyle.fill || "#e67e22",
                        stroke: defaultShapeStyle.stroke || "#ffffff",
                        strokeWidth: defaultShapeStyle.strokeWidth !== undefined ? defaultShapeStyle.strokeWidth : 2,
                        opacity: defaultShapeStyle.opacity !== undefined ? defaultShapeStyle.opacity : 1
                    });
                    pushHistory();
                }
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
                    let end = { x: point.x, y: point.y };
                    if (e.shiftKey) {
                        end = snapTo45Degrees(start, end);
                    }

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

            if (activeTool === "area" || activeTool === "perimeter" || activeTool === "polyline" || activeTool === "polygon" || activeTool === "polylength") {
                if (!isDrawingRef.current) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]);
                } else {
                    let nextPoint = { x: point.x, y: point.y };
                    if ((activeTool === "polyline" || activeTool === "polygon" || activeTool === "polylength") && e.shiftKey && drawingPoints.length > 0) {
                        nextPoint = snapTo45Degrees(drawingPoints[drawingPoints.length - 1], nextPoint);
                    }
                    setDrawingPoints((prev) => [...prev, nextPoint]);
                }
            }

            if (activeTool === "angle") {
                if (!isDrawingRef.current) {
                    setIsDrawing(true);
                    setDrawingPoints([{ x: point.x, y: point.y }]);
                } else if (drawingPoints.length === 1) {
                    let endPoint = { x: point.x, y: point.y };
                    if (e.shiftKey) {
                        endPoint = snapTo45Degrees(drawingPoints[0], endPoint);
                    }
                    setDrawingPoints((prev) => [...prev, endPoint]);
                } else if (drawingPoints.length === 2) {
                    let endPoint = { x: point.x, y: point.y };
                    if (e.shiftKey) {
                        endPoint = snapTo45Degrees(drawingPoints[1], endPoint);
                    }
                    addMeasurement({
                        id: crypto.randomUUID(),
                        type: "angle",
                        pageIndex,
                        points: [drawingPoints[0], drawingPoints[1], endPoint],
                    });
                    pushHistory();
                    setActiveTool("select");
                    setIsDrawing(false);
                    setDrawingPoints([]);
                }
                return;
            }
        }
    };

    const handlePointerMove = (e) => {
        const rawPoint = getPagePoint(e);
        if (!rawPoint) return;

        const shouldSnap = snappingEnabled && activeTool === "length";
        const excludeId = resizingState ? resizingState.id : null;
        const snapResult = shouldSnap ? getSnappedPoint(rawPoint, excludeId) : { point: rawPoint, snapped: false };
        const point = snapResult.point;

        if (snapResult.snapped) {
            setSnapIndicator({ x: snapResult.point.x, y: snapResult.point.y, type: snapResult.type });
        } else {
            setSnapIndicator(null);
        }

        let cursorPt = { x: point.x, y: point.y };
        if (e.shiftKey) {
            if (["line", "arrow"].includes(activeTool) && shapeStart) {
                cursorPt = snapTo45Degrees(shapeStart, cursorPt);
            } else if (["length", "calibrate"].includes(activeTool) && isDrawingRef.current && drawingPoints.length > 0) {
                cursorPt = snapTo45Degrees(drawingPoints[0], cursorPt);
            } else if (["angle", "polyline", "polygon", "polylength"].includes(activeTool) && isDrawingRef.current && drawingPoints.length > 0) {
                const referencePt = drawingPoints[drawingPoints.length - 1];
                cursorPt = snapTo45Degrees(referencePt, cursorPt);
            } else if (["rectangle", "circle", "highlight", "cloud"].includes(activeTool) && shapeStart) {
                const dx = cursorPt.x - shapeStart.x;
                const dy = cursorPt.y - shapeStart.y;
                const size = Math.max(Math.abs(dx), Math.abs(dy));
                cursorPt = {
                    x: shapeStart.x + (Math.sign(dx) || 1) * size,
                    y: shapeStart.y + (Math.sign(dy) || 1) * size
                };
            }
        }
        setCursor(cursorPt);

        // Resizing
        if (resizingState) {
            const { id, handle, startShape, startPoint } = resizingState;
            let targetPt = point;
            if (e.shiftKey && (startShape.type === "line" || startShape.type === "arrow" || startShape.type === "length" || handle === "callout-tip")) {
                targetPt = snapTo45Degrees(startPoint, point);
            }
            const dx = targetPt.x - startPoint.x;
            const dy = targetPt.y - startPoint.y;

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
                    let pt = { x: startShape.points[0].x + dx, y: startShape.points[0].y + dy };
                    if (e.shiftKey) pt = snapTo45Degrees(startShape.points[1], pt);
                    newPoints[0] = pt;
                } else if (handle === "end") {
                    let pt = { x: startShape.points[1].x + dx, y: startShape.points[1].y + dy };
                    if (e.shiftKey) pt = snapTo45Degrees(startShape.points[0], pt);
                    newPoints[1] = pt;
                }
                updateMeasurement(id, { points: newPoints });
                return;
            }

            // Area, perimeter, angle, polyline, polygon, and count vertex dragging
            if (["area", "perimeter", "angle", "polyline", "polygon", "count", "polylength"].includes(startShape.type) && handle.startsWith("vertex-")) {
                const vertexIndex = parseInt(handle.split("-")[1]);
                const newPoints = [...startShape.points];
                let targetPt = {
                    x: startShape.points[vertexIndex].x + dx,
                    y: startShape.points[vertexIndex].y + dy
                };

                if (["angle", "polyline", "polygon", "area", "perimeter", "polylength"].includes(startShape.type) && e.shiftKey) {
                    const startPos = startShape.points[vertexIndex];
                    targetPt = snapTo45Degrees(startPos, targetPt);
                }

                newPoints[vertexIndex] = targetPt;
                if (startShape.type === "polyline" || startShape.type === "polygon") {
                    updateShape(id, { points: newPoints });
                } else {
                    updateMeasurement(id, { points: newPoints });
                }
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

            if (e.shiftKey && (startShape.type === "rectangle" || startShape.type === "circle" || startShape.type === "image" || startShape.type === "highlight" || startShape.type === "cloud")) {
                const aspect = w0 / h0;
                const candidateW = newR - newL;
                const candidateH = newB - newT;
                const signW = Math.sign(candidateW) || 1;
                const signH = Math.sign(candidateH) || 1;

                const absCandidateW = Math.max(1, Math.abs(candidateW));
                const absCandidateH = Math.max(1, Math.abs(candidateH));

                let w = absCandidateW;
                let h = absCandidateH;

                const hasN = handle.includes("n");
                const hasS = handle.includes("s");
                const hasW = handle.includes("w");
                const hasE = handle.includes("e");

                if ((hasN || hasS) && !hasW && !hasE) {
                    // Vertical-only drag
                    w = h * aspect;
                } else if ((hasW || hasE) && !hasN && !hasS) {
                    // Horizontal-only drag
                    h = w / aspect;
                } else if ((hasN || hasS) && (hasW || hasE)) {
                    // Corner drag: project pointer displacement onto unit diagonal to prevent jittering
                    const dirX = hasE ? 1 : -1;
                    const dirY = hasS ? 1 : -1;
                    const scale = (localDx * dirX * aspect + localDy * dirY) / (aspect * aspect + 1);
                    w = Math.max(1, Math.abs(w0 + scale * aspect));
                    h = Math.max(1, Math.abs(h0 + scale));
                }

                // Apply target w and h based on stationary anchors and signs
                // Horizontal anchors
                if (hasW) {
                    newL = w0 - w * signW;
                    newR = w0;
                } else if (hasE) {
                    newL = 0;
                    newR = w * signW;
                } else {
                    newL = 0;
                    newR = w;
                }

                // Vertical anchors
                if (hasN) {
                    newT = h0 - h * signH;
                    newB = h0;
                } else if (hasS) {
                    newT = 0;
                    newB = h * signH;
                } else {
                    newT = 0;
                    newB = h;
                }
            }

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
                const updates = { box: { x: finalX, y: finalY, w: finalW, h: finalH } };
                if (startShape.type === 'callout') {
                    const oldKnee = startShape.knee || getCalloutKnee(startShape.box, startShape.tip, null);
                    const oldCx = startShape.box.x + startShape.box.w / 2;
                    const oldCy = startShape.box.y + startShape.box.h / 2;
                    const newCx = finalX + finalW / 2;
                    const newCy = finalY + finalH / 2;

                    const rot = startShape.rotation || 0;
                    const rad = (-rot * Math.PI) / 180;
                    const cosVal = Math.cos(rad);
                    const sinVal = Math.sin(rad);

                    const dx = oldKnee.x - oldCx;
                    const dy = oldKnee.y - oldCy;
                    const localKneeX = dx * cosVal - dy * sinVal;
                    const localKneeY = dx * sinVal + dy * cosVal;

                    const isVertical = Math.abs(localKneeX) < Math.abs(localKneeY);

                    let newLocalKneeX = localKneeX;
                    let newLocalKneeY = localKneeY;

                    if (isVertical) {
                        newLocalKneeX = 0;
                        const oldH = startShape.box.h;
                        if (localKneeY > 0) {
                            newLocalKneeY = finalH / 2 + (localKneeY - oldH / 2);
                        } else if (localKneeY < 0) {
                            newLocalKneeY = -finalH / 2 + (localKneeY + oldH / 2);
                        } else {
                            newLocalKneeY = 0;
                        }
                    } else {
                        newLocalKneeY = 0;
                        const oldW = startShape.box.w;
                        if (localKneeX > 0) {
                            newLocalKneeX = finalW / 2 + (localKneeX - oldW / 2);
                        } else if (localKneeX < 0) {
                            newLocalKneeX = -finalW / 2 + (localKneeX + oldW / 2);
                        } else {
                            newLocalKneeX = 0;
                        }
                    }

                    const posRad = (rot * Math.PI) / 180;
                    const posCos = Math.cos(posRad);
                    const posSin = Math.sin(posRad);

                    updates.knee = {
                        x: newCx + (newLocalKneeX * posCos - newLocalKneeY * posSin),
                        y: newCy + (newLocalKneeX * posSin + newLocalKneeY * posCos)
                    };
                }
                updateMeasurement(id, updates);
            } else {
                updateShape(id, { x: finalX, y: finalY, width: finalW, height: finalH });
            }
            return;
        }

        // Dragging selected items
        if (activeTool === "select" && isDraggingItems && dragStart && selectedIds.length > 0) {
            let targetPt = point;
            if (e.shiftKey && !isDraggingTextRef.current) {
                targetPt = snapTo45Degrees(dragStart, point);
            }
            const dx = targetPt.x - dragStart.x;
            const dy = targetPt.y - dragStart.y;
            setDragDelta({ x: dx, y: dy });
        }
    };

    const handlePointerUp = (e) => {
        if (e.button !== 0) return;

        const rawPoint = getPagePoint(e);
        if (!rawPoint) return;

        const shouldSnap = snappingEnabled && activeTool === "length";
        const excludeId = resizingState ? resizingState.id : null;
        const snapResult = shouldSnap ? getSnappedPoint(rawPoint, excludeId) : { point: rawPoint, snapped: false };
        const point = snapResult.point;

        setSnapIndicator(null); // Clear indicator on pointer up

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
            if (isDraggingItems && dragStart) {
                const hasDragged = dragDelta.x !== 0 || dragDelta.y !== 0;
                if (hasDragged) {
                    const { x: dx, y: dy } = dragDelta;
                    const isTextDrag = isDraggingTextRef.current;

                    selectedIds.forEach((id) => {
                        const shape = pageShapes.find((s) => s.id === id);
                        if (shape) {
                            if (shape.type === "line" || shape.type === "arrow") {
                                updateShape(id, {
                                    start: { x: shape.start.x + dx, y: shape.start.y + dy },
                                    end: { x: shape.end.x + dx, y: shape.end.y + dy },
                                });
                            } else if (shape.type === "polyline" || shape.type === "polygon") {
                                updateShape(id, {
                                    points: shape.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
                                });
                            } else {
                                updateShape(id, { x: shape.x + dx, y: shape.y + dy });
                            }
                        } else {
                            const meas = pageMeasurements.find(m => m.id === id);
                            if (meas) {
                                if (isTextDrag && ['length', 'angle', 'area', 'perimeter', 'polylength'].includes(meas.type)) {
                                    const currentOffset = meas.textOffset || { x: 0, y: 0 };
                                    updateMeasurement(id, {
                                        textOffset: { x: currentOffset.x + dx, y: currentOffset.y + dy }
                                    });
                                } else if (meas.box) {
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
                                    // Length, Area, Perimeter, Count (Grouped)
                                    const newPoints = meas.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                                    updateMeasurement(id, { points: newPoints });
                                } else if (meas.point) {
                                    // Count (Single)
                                    updateMeasurement(id, {
                                        point: { x: meas.point.x + dx, y: meas.point.y + dy }
                                    });
                                }
                            }
                        }
                    });
                } else {
                    // Clicked without dragging (hasDragged === false)
                    if (pendingDeselectIdRef.current) {
                        setSelectedIds((prev) => prev.filter((id) => id !== pendingDeselectIdRef.current));
                    }
                }
                pendingDeselectIdRef.current = null;
                isDraggingTextRef.current = false;
            }

            setIsDraggingItems(false);
            setDragStart(null);
            setDragDelta({ x: 0, y: 0 });
            return;
        }

        // finalize shape draw
        if (["rectangle", "circle", "line", "arrow", "highlight", "cloud"].includes(activeTool) && isDrawingRef.current && shapeStart && point) {
            let endPt = { x: point.x, y: point.y };
            if (e.shiftKey) {
                if (activeTool === "line" || activeTool === "arrow") {
                    endPt = snapTo45Degrees(shapeStart, endPt);
                } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "highlight" || activeTool === "cloud") {
                    const dx = endPt.x - shapeStart.x;
                    const dy = endPt.y - shapeStart.y;
                    const size = Math.max(Math.abs(dx), Math.abs(dy));
                    endPt = {
                        x: shapeStart.x + (Math.sign(dx) || 1) * size,
                        y: shapeStart.y + (Math.sign(dy) || 1) * size
                    };
                }
            }
            if (calculateDistance(shapeStart, endPt) > 5) {
                const id = crypto.randomUUID();

                const base = {
                    id,
                    type: activeTool,
                    pageIndex,
                    ...defaultShapeStyle, // Sticky properties
                    rotation: 0,
                };

                if (activeTool === "highlight") {
                    base.fill = "#ffeb3b";
                    base.stroke = "transparent";
                    base.opacity = 0.4;
                }

                if (activeTool === "line" || activeTool === "arrow") {
                    addShape({ ...base, start: shapeStart, end: endPt });
                } else {
                    const x = Math.min(shapeStart.x, endPt.x);
                    const y = Math.min(shapeStart.y, endPt.y);
                    const w = Math.abs(endPt.x - shapeStart.x);
                    const h = Math.abs(endPt.y - shapeStart.y);
                    addShape({ ...base, x, y, width: w, height: h });
                }
                pushHistory(); // Save state after adding shape
                setActiveTool("select"); // Auto-switch to select
            }

            setIsDrawing(false);
            setShapeStart(null);
            return;
        }

        // finalize length/calibrate draw
        if (["length", "calibrate"].includes(activeTool) && isDrawingRef.current && drawingPoints.length > 0 && point) {
            const start = drawingPoints[0];
            let end = { x: point.x, y: point.y };
            if (e.shiftKey) {
                end = snapTo45Degrees(start, end);
            }

            if (calculateDistance(start, end) > 5) {
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
                setIsDrawing(false);
                setDrawingPoints([]);
                return;
            }
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

                // If they dragged at all (more than 4px in either direction)
                if (w > 4 || h > 4) {
                    newMeas = {
                        id,
                        type: "text",
                        pageIndex,
                        box: { x, y, w: Math.max(30, w), h: Math.max(20, h) },
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

                const stub = 20;
                let bx, kneeX, by, kneeY;

                if (Math.abs(dy) > Math.abs(dx) * 1.5) {
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
        const isRotating = resizingState && resizingState.handle === "rotate" && resizingState.id === s.id;

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
                transform={s.rotation ? `rotate(${s.rotation}, ${x}, ${y})` : undefined}
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
        const padding = 12 / Math.max(1e-6, viewScale);

        const getRotatedPoint = (xLocal, yLocal) => {
            const cx = s.x + w / 2;
            const cy = s.y + h / 2;
            const lx = xLocal - w / 2;
            const ly = yLocal - h / 2;
            const rad = ((s.rotation || 0) * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            return {
                x: cx + lx * cos - ly * sin,
                y: cy + lx * sin + ly * cos
            };
        };

        const nw = getRotatedPoint(-padding, -padding);
        const n = getRotatedPoint(w / 2, -padding);
        const ne = getRotatedPoint(w + padding, -padding);
        const e = getRotatedPoint(w + padding, h / 2);
        const se = getRotatedPoint(w + padding, h + padding);
        const sPoint = getRotatedPoint(w / 2, h + padding);
        const sw = getRotatedPoint(-padding, h + padding);
        const wPoint = getRotatedPoint(-padding, h / 2);
        const rotPoint = getRotatedPoint(w / 2, -rotOffset - padding);

        return (
            <g>
                <polygon
                    points={`${nw.x},${nw.y} ${ne.x},${ne.y} ${se.x},${se.y} ${sw.x},${sw.y}`}
                    fill="none"
                    stroke="var(--primary-color)"
                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
                {renderHandle(nw.x, nw.y, "nw-resize", "nw")}
                {renderHandle(n.x, n.y, "n-resize", "n")}
                {renderHandle(ne.x, ne.y, "ne-resize", "ne")}
                {renderHandle(e.x, e.y, "e-resize", "e")}
                {renderHandle(se.x, se.y, "se-resize", "se")}
                {renderHandle(sPoint.x, sPoint.y, "s-resize", "s")}
                {renderHandle(sw.x, sw.y, "sw-resize", "sw")}
                {renderHandle(wPoint.x, wPoint.y, "w-resize", "w")}

                <circle
                    cx={rotPoint.x}
                    cy={rotPoint.y}
                    r={4 / Math.max(1e-6, viewScale)}
                    fill="#b4e6a0"
                    stroke="#3a6b24"
                    strokeWidth={1 / Math.max(1e-6, viewScale)}
                    vectorEffect="non-scaling-stroke"
                    cursor="grab"
                    data-resize-id={s.id}
                    data-resize-handle="rotate"
                />
                {isRotating && (() => {
                    const angleLabelPt = getRotatedPoint(w / 2, -rotOffset - padding - 12 / Math.max(1e-6, viewScale));
                    const displayAngle = (Math.round(s.rotation || 0) % 360 + 360) % 360;
                    const fontSz = 10 / Math.max(1e-6, viewScale);
                    const dyOffset = 3 / Math.max(1e-6, viewScale);
                    return (
                        <text
                            x={angleLabelPt.x}
                            y={angleLabelPt.y}
                            dy={dyOffset}
                            fill="#000000"
                            fontSize={fontSz}
                            fontWeight="600"
                            textAnchor="middle"
                            fontFamily="sans-serif"
                            pointerEvents="none"
                        >
                            {displayAngle}°
                        </text>
                    );
                })()}
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
                    pointerEvents="all"
                    style={cursorStyle}
                />
            );
        }

        const rot = s.rotation || 0;
        const hasFill = s.fill && s.fill !== "none" && s.fill !== "transparent";

        return (
            <g
                key={`hit-${s.id}`}
                data-shape-id={s.id}
                pointerEvents="all"
                style={cursorStyle}
                transform={`translate(${s.x}, ${s.y}) rotate(${rot}, ${s.width / 2}, ${s.height / 2})`}
            >
                {(s.type === "rectangle" || s.type === "highlight" || s.type === "cloud") ? (
                    <rect
                        x={0}
                        y={0}
                        width={s.width}
                        height={s.height}
                        fill={hasFill ? "transparent" : "none"}
                        stroke={hasFill ? "none" : "transparent"}
                        strokeWidth={hasFill ? 0 : sw}
                        pointerEvents={hasFill ? "all" : "stroke"}
                    />
                ) : (
                    <ellipse
                        cx={s.width / 2}
                        cy={s.height / 2}
                        rx={s.width / 2}
                        ry={s.height / 2}
                        fill={hasFill ? "transparent" : "none"}
                        stroke={hasFill ? "none" : "transparent"}
                        strokeWidth={hasFill ? 0 : sw}
                        pointerEvents={hasFill ? "all" : "stroke"}
                    />
                )}
            </g>
        );
    };

    const renderShape = (s, isShadow = false) => {
        const isSelected = isShadow ? false : selectedIds.includes(s.id);
        const strokeColor = isShadow ? "#cbd5e1" : s.stroke;
        const fillColor = isShadow ? "none" : s.fill;
        const hasFill = fillColor && fillColor !== "none" && fillColor !== "transparent";
        const canAddVertex = ["polyline", "polygon", "area", "perimeter", "polylength"].includes(s.type);
        const isDragging = isDraggingItems || !!resizingState;
        const commonProps = {
            "data-shape-id": isShadow ? undefined : s.id,
            stroke: strokeColor,
            strokeWidth: s.strokeWidth,
            strokeDasharray: isShadow ? undefined : (s.strokeDasharray === 'none' ? undefined : s.strokeDasharray),
            fill: fillColor,
            fillOpacity: isShadow ? 0.7 : (s.opacity ?? 1),
            strokeOpacity: isShadow ? 0.7 : (s.strokeOpacity ?? 1),
            style: {
                cursor: isShadow
                    ? "default"
                    : (activeTool === "format-painter"
                        ? "copy"
                        : (activeTool === "select"
                            ? (isDragging
                                ? "default"
                                : (isShiftPressed && canAddVertex ? "copy" : "move"))
                            : "default")),
                pointerEvents: isShadow ? "none" : (hasFill ? "all" : "stroke")
            },
            strokeLinecap: "round",
            strokeLinejoin: "round",
        };

        if (s.type === "polyline" && s.points?.length >= 2) {
            const pointsStr = s.points.map((p) => `${p.x},${p.y}`).join(" ");
            return (
                <g key={s.id + (isShadow ? "-shadow" : "")}>
                    {!isShadow && (
                        <polyline
                            points={pointsStr}
                            stroke="transparent"
                            strokeWidth={15}
                            fill="none"
                            pointerEvents="stroke"
                            data-shape-id={s.id}
                            style={{ cursor: "move" }}
                        />
                    )}
                    <polyline
                        points={pointsStr}
                        {...commonProps}
                        fill="none"
                        strokeLinecap="butt"
                        strokeLinejoin="miter"
                    />
                </g>
            );
        }

        if (s.type === "polygon" && s.points?.length >= 3) {
            const pointsStr = s.points.map((p) => `${p.x},${p.y}`).join(" ");
            const hasFill = s.fill && s.fill !== "none" && s.fill !== "transparent";
            return (
                <g key={s.id + (isShadow ? "-shadow" : "")}>
                    {!isShadow && (
                        <polygon
                            points={pointsStr}
                            stroke="transparent"
                            strokeWidth={15}
                            fill={hasFill ? s.fill : "transparent"}
                            pointerEvents={hasFill ? "all" : "stroke"}
                            data-shape-id={s.id}
                            style={{ cursor: "move" }}
                        />
                    )}
                    <polygon
                        points={pointsStr}
                        {...commonProps}
                        strokeLinecap="butt"
                        strokeLinejoin="miter"
                    />
                </g>
            );
        }

        if (s.type === "line") {
            return (
                <g key={s.id + (isShadow ? "-shadow" : "")}>
                    {/* fat hit-area */}
                    {!isShadow && (
                        <line
                            x1={s.start.x}
                            y1={s.start.y}
                            x2={s.end.x}
                            y2={s.end.y}
                            stroke="transparent"
                            strokeWidth={15}
                            pointerEvents="all"
                            data-shape-id={s.id}
                            style={{ cursor: "move", pointerEvents: "all" }}
                        />
                    )}
                    <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} {...commonProps} strokeLinecap="butt" />
                </g>
            );
        }

        if (s.type === "arrow") {
            const arrowMarkerId = `arrow-${s.id}-v2${isShadow ? '-shadow' : ''}`;
            return (
                <g key={s.id + (isShadow ? "-shadow" : "")} data-shape-id={isShadow ? undefined : s.id}>
                    <defs>
                        <marker id={arrowMarkerId} markerWidth="6" markerHeight="4" refX="2" refY="2" orient="auto">
                            <polygon points="0 0, 6 2, 0 4" fill={strokeColor} />
                        </marker>
                    </defs>

                    {(() => {
                        // Shorten line so visual tip matches s.end
                        const rawSw = s.strokeWidth || 2;
                        const dist = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
                        const offset = 4 * rawSw;
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
                                cursor={isShadow ? "default" : "move"}
                                markerEnd={`url(#${arrowMarkerId})`}
                                strokeLinecap="butt"
                            />
                        );
                    })()}

                    {/* fat hit-area */}
                    {!isShadow && (
                        <line
                            x1={s.start.x}
                            y1={s.start.y}
                            x2={s.end.x}
                            y2={s.end.y}
                            stroke="transparent"
                            strokeWidth={15}
                            pointerEvents="all"
                            data-shape-id={s.id}
                            style={{ cursor: "move", pointerEvents: "all" }}
                        />
                    )}
                </g>
            );
        }

        // rect/circle: group transform
        const rotation = s.rotation || 0;
        let elem = null;

        if (s.type === "rectangle") {
            elem = <rect x={0} y={0} width={s.width} height={s.height} {...commonProps} strokeLinejoin="miter" />;
        } else if (s.type === "highlight") {
            elem = <rect x={0} y={0} width={s.width} height={s.height} {...commonProps} style={{ ...commonProps.style, mixBlendMode: "multiply" }} strokeLinejoin="miter" />;
        } else if (s.type === "cloud") {
            elem = <path d={getCloudPath(s.width, s.height)} {...commonProps} strokeLinejoin="miter" />;
        } else if (s.type === "circle") {
            elem = <ellipse cx={s.width / 2} cy={s.height / 2} rx={s.width / 2} ry={s.height / 2} {...commonProps} />;
        } else if (s.type === "image") {
            if (isShadow) {
                elem = (
                    <rect
                        x={0}
                        y={0}
                        width={s.width}
                        height={s.height}
                        fill="none"
                        fillOpacity={0.15}
                        stroke="#cbd5e1"
                        strokeWidth={1}
                    />
                );
            } else {
                const borderRect = (s.strokeWidth > 0 && s.stroke && s.stroke !== 'none' && s.stroke !== 'transparent') ? (
                    <rect
                        x={0}
                        y={0}
                        width={s.width}
                        height={s.height}
                        fill="none"
                        stroke={s.stroke}
                        strokeWidth={s.strokeWidth}
                        strokeDasharray={s.strokeDasharray === 'none' ? undefined : s.strokeDasharray}
                        strokeOpacity={s.strokeOpacity ?? 1}
                        pointerEvents="none"
                    />
                ) : null;

                elem = (
                    <g>
                        <image
                            href={s.src}
                            x={0}
                            y={0}
                            width={s.width}
                            height={s.height}
                            opacity={s.opacity ?? 1}
                            style={{ cursor: "move", pointerEvents: "all" }}
                            data-shape-id={s.id}
                        />
                        {borderRect}
                    </g>
                );
            }
        }

        return (
            <g key={s.id + (isShadow ? "-shadow" : "")}>
                <g
                    transform={`translate(${s.x}, ${s.y}) rotate(${rotation}, ${s.width / 2}, ${s.height / 2})`}
                >
                    {elem}
                </g>
            </g>
        );
    };

    const renderMeasurement = (m, isShadow = false) => {
        const isSelected = isShadow ? false : selectedIds.includes(m.id);
        const canAddVertex = ["area", "perimeter", "polylength"].includes(m.type);
        const isDragging = isDraggingItems || !!resizingState;
        const measCommon = {
            "data-meas-id": isShadow ? undefined : m.id,
            style: {
                cursor: isShadow
                    ? "default"
                    : (activeTool === "format-painter"
                        ? "copy"
                        : (activeTool === "select"
                            ? (isDragging
                                ? "default"
                                : (isShiftPressed && canAddVertex ? "copy" : "move"))
                            : "default")),
                pointerEvents: isShadow ? "none" : "all"
            }
        };

        if (m.type === "length" && m.points?.length === 2) {
            const a = m.points[0];
            const b = m.points[1];
            const dist = calculateDistance(a, b);
            const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "#e74c3c");
            const strokeWidth = m.strokeWidth || 2;
            const strokeDasharray = isShadow ? undefined : (m.strokeDasharray === 'none' ? undefined : (m.strokeDasharray === 'dashed' ? '12, 12' : (m.strokeDasharray === 'dotted' ? '2, 8' : m.strokeDasharray)));
            const fontSize = m.fontSize || 14;
            const textColor = isShadow ? "#cbd5e1" : (m.textColor || strokeColor);
            const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
            const textOpacity = isShadow ? 0.7 : (m.textOpacity ?? 1);

            return (
                <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon} style={{ ...measCommon.style }}>
                    {/* Hit Area for dragging */}
                    {!isShadow && (
                        <line
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke="transparent"
                            strokeWidth={15}
                            pointerEvents="all"
                            data-meas-id={m.id}
                            style={{ cursor: "move" }}
                        />
                    )}
                    <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        strokeOpacity={strokeOpacity}
                        strokeLinecap="butt"
                        pointerEvents="none"
                    />
                    {!isShadow && (
                        <text
                            x={(a.x + b.x) / 2 + (m.textOffset?.x || 0)}
                            y={(a.y + b.y) / 2 - 6 + (m.textOffset?.y || 0)}
                            fill={textColor}
                            fillOpacity={textOpacity}
                            fontSize={fontSize}
                            textAnchor="middle"
                            pointerEvents="all"
                            style={{
                                cursor: "move",
                                fontWeight: m.bold ? 'bold' : 'normal',
                                fontStyle: m.italic ? 'italic' : 'normal',
                                textDecoration: [
                                    m.underline ? 'underline' : '',
                                    m.crossout ? 'line-through' : ''
                                ].filter(Boolean).join(' ') || 'none'
                            }}
                        >
                            {toUnits(dist).toFixed(2)} {unit}
                        </text>
                    )}
                </g>
            );
        }

        if (m.type === "angle" && m.points?.length === 3) {
            const p0 = m.points[0];
            const p1 = m.points[1]; // Vertex
            const p2 = m.points[2];
            const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "#3498db");
            const strokeWidth = m.strokeWidth || 2;
            const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
            const textOpacity = isShadow ? 0.7 : (m.textOpacity ?? 1);
            const fontSize = m.fontSize || 14;
            const textColor = isShadow ? "#94a3b8" : (m.textColor || strokeColor);

            const v1 = { x: p0.x - p1.x, y: p0.y - p1.y };
            const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
            const d1 = Math.hypot(v1.x, v1.y);
            const d2 = Math.hypot(v2.x, v2.y);
            let angleDeg = 0;
            let arcPath = "";
            if (d1 > 1e-3 && d2 > 1e-3) {
                const dot = v1.x * v2.x + v1.y * v2.y;
                const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (d1 * d2))));
                angleDeg = angleRad * 180 / Math.PI;

                const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x);
                const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const r = Math.min(24, d1 * 0.6, d2 * 0.6);
                const startX = p1.x + r * Math.cos(a1);
                const startY = p1.y + r * Math.sin(a1);
                const endX = p1.x + r * Math.cos(a2);
                const endY = p1.y + r * Math.sin(a2);
                let diff = a2 - a1;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                const sweepFlag = diff > 0 ? 1 : 0;
                arcPath = `M ${startX} ${startY} A ${r} ${r} 0 0 ${sweepFlag} ${endX} ${endY}`;
            }

            return (
                <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon} style={{ ...measCommon.style }}>
                    {!isShadow && (
                        <>
                            <polyline
                                points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                                stroke="transparent"
                                strokeWidth={15}
                                fill="none"
                                pointerEvents="stroke"
                                data-meas-id={m.id}
                                style={{ cursor: "move" }}
                            />
                        </>
                    )}
                    <polyline
                        points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeOpacity={strokeOpacity}
                        strokeLinecap="butt"
                        strokeLinejoin="miter"
                        pointerEvents="none"
                    />
                    {arcPath && (
                        <path d={arcPath} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeOpacity={strokeOpacity} pointerEvents="none" />
                    )}
                    {!isShadow && (
                        <text
                            x={p1.x + (m.textOffset?.x || 0)}
                            y={p1.y - 12 - (fontSize / 2) + (m.textOffset?.y || 0)}
                            fill={textColor}
                            fillOpacity={textOpacity}
                            fontSize={fontSize}
                            textAnchor="middle"
                            pointerEvents="all"
                            style={{
                                cursor: "move",
                                fontWeight: m.bold ? 'bold' : 'normal',
                                fontStyle: m.italic ? 'italic' : 'normal',
                                textDecoration: [
                                    m.underline ? 'underline' : '',
                                    m.crossout ? 'line-through' : ''
                                ].filter(Boolean).join(' ') || 'none'
                            }}
                        >
                            {angleDeg.toFixed(1)}°
                        </text>
                    )}
                </g>
            );
        }

        if (m.type === "area" && m.points?.length >= 3) {
            const pointsStr = m.points.map((p) => `${p.x},${p.y}`).join(" ");
            const area = calculatePolygonArea(m.points);
            const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "#2ecc71");
            const strokeWidth = m.strokeWidth || 2;
            const strokeDasharray = isShadow ? undefined : (m.strokeDasharray === 'none' ? undefined : (m.strokeDasharray === 'dashed' ? '12, 12' : (m.strokeDasharray === 'dotted' ? '2, 8' : m.strokeDasharray)));
            const fillColor = isShadow ? "none" : (m.fill || "rgba(108, 176, 86, 0.25)");
            const fontSize = m.fontSize || 14;
            const textColor = isShadow ? "#94a3b8" : (m.textColor || strokeColor);
            const opacity = isShadow ? 0.7 : (m.opacity ?? 1);
            const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
            const textOpacity = isShadow ? 0.7 : (m.textOpacity ?? 1);

            return (
                <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon} style={{ ...measCommon.style }}>
                    <polygon
                        points={pointsStr}
                        fill={fillColor}
                        fillOpacity={opacity}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeOpacity={strokeOpacity}
                        strokeDasharray={strokeDasharray}
                    />
                    {!isShadow && (
                        <text
                            x={m.points[0].x + (m.textOffset?.x || 0)}
                            y={m.points[0].y - 8 + (m.textOffset?.y || 0)}
                            fill={textColor}
                            fillOpacity={textOpacity}
                            fontSize={fontSize}
                            pointerEvents="all"
                            style={{
                                cursor: "move",
                                fontWeight: m.bold ? 'bold' : 'normal',
                                fontStyle: m.italic ? 'italic' : 'normal',
                                textDecoration: [
                                    m.underline ? 'underline' : '',
                                    m.crossout ? 'line-through' : ''
                                ].filter(Boolean).join(' ') || 'none'
                            }}
                        >
                            {toUnits2(area).toFixed(2)} {unit}²
                        </text>
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
            const strokeColor = isShadow ? "#cbd5e1" : "#9b59b6";
            const strokeWidth = m.strokeWidth || 2;
            const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
            const textOpacity = isShadow ? 0.7 : (m.textOpacity ?? 1);

            return (
                <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon} style={{ ...measCommon.style }}>
                    <polyline
                        points={pointsStr}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeOpacity={strokeOpacity}
                    />
                    {!isShadow && (
                        <text
                            x={m.points[0].x + (m.textOffset?.x || 0)}
                            y={m.points[0].y - 8 + (m.textOffset?.y || 0)}
                            fill="#9b59b6"
                            fillOpacity={textOpacity}
                            fontSize={14}
                            pointerEvents="all"
                            style={{
                                cursor: "move",
                                fontWeight: m.bold ? 'bold' : 'normal',
                                fontStyle: m.italic ? 'italic' : 'normal',
                                textDecoration: [
                                    m.underline ? 'underline' : '',
                                    m.crossout ? 'line-through' : ''
                                ].filter(Boolean).join(' ') || 'none'
                            }}
                        >
                            {toUnits(len).toFixed(2)} {unit}
                        </text>
                    )}
                </g>
            );
        }

        if (m.type === "polylength" && m.points?.length >= 2) {
            const pointsStr = m.points.map((p) => `${p.x},${p.y}`).join(" ");
            let totalLen = 0;
            for (let i = 0; i < m.points.length - 1; i++) {
                totalLen += calculateDistance(m.points[i], m.points[i + 1]);
            }
            const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "#16a085");
            const strokeWidth = m.strokeWidth || 2;
            const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
            const textOpacity = isShadow ? 0.7 : (m.textOpacity ?? 1);
            const textColor = isShadow ? "#cbd5e1" : (m.textColor || strokeColor);
            const fontSize = m.fontSize || 14;

            return (
                <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon} style={{ ...measCommon.style }}>
                    <polyline
                        points={pointsStr}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeOpacity={strokeOpacity}
                        strokeDasharray={isShadow ? undefined : (m.strokeDasharray === 'none' ? undefined : (m.strokeDasharray === 'dashed' ? '12, 12' : (m.strokeDasharray === 'dotted' ? '2, 8' : m.strokeDasharray)))}
                    />
                    {!isShadow && (
                        <text
                            x={m.points[0].x + (m.textOffset?.x || 0)}
                            y={m.points[0].y - 8 + (m.textOffset?.y || 0)}
                            fill={textColor}
                            fillOpacity={textOpacity}
                            fontSize={fontSize}
                            pointerEvents="all"
                            style={{
                                cursor: "move",
                                fontWeight: m.bold ? 'bold' : 'normal',
                                fontStyle: m.italic ? 'italic' : 'normal',
                                textDecoration: [
                                    m.underline ? 'underline' : '',
                                    m.crossout ? 'line-through' : ''
                                ].filter(Boolean).join(' ') || 'none'
                            }}
                        >
                            {toUnits(totalLen).toFixed(2)} {unit}
                        </text>
                    )}
                </g>
            );
        }

        if (m.type === "count") {
            const pts = m.points || (m.point ? [m.point] : []);
            const renderCountPoint = (p, idx, m, isShadow, measCommon) => {
                const shapeType = m.shape || "circle";
                const fillColor = isShadow ? "none" : (m.fill || "var(--primary-color)");
                const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "white");
                const fillOpacity = isShadow ? 0.7 : (m.opacity ?? 1);
                const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
                const strokeWidth = m.strokeWidth !== undefined ? m.strokeWidth : 2;
                const scale = m.scale !== undefined ? m.scale : 1.0;
                const r = 8 * scale;

                const commonProps = {
                    "data-meas-id": isShadow ? undefined : m.id,
                    fill: fillColor,
                    fillOpacity: fillOpacity,
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    strokeOpacity: strokeOpacity,
                    style: { ...measCommon.style },
                    key: `${m.id}-pt-${idx}${isShadow ? "-shadow" : ""}`,
                };

                if (shapeType === "square") {
                    return (
                        <rect
                            x={p.x - r}
                            y={p.y - r}
                            width={r * 2}
                            height={r * 2}
                            {...commonProps}
                        />
                    );
                }
                if (shapeType === "triangle") {
                    const points = `${p.x},${p.y - r * 1.1} ${p.x - r},${p.y + r * 0.9} ${p.x + r},${p.y + r * 0.9}`;
                    return (
                        <polygon
                            points={points}
                            {...commonProps}
                        />
                    );
                }
                if (shapeType === "diamond") {
                    const points = `${p.x},${p.y - r * 1.1} ${p.x + r * 1.1},${p.y} ${p.x},${p.y + r * 1.1} ${p.x - r * 1.1},${p.y}`;
                    return (
                        <polygon
                            points={points}
                            {...commonProps}
                        />
                    );
                }
                return (
                    <circle
                        cx={p.x}
                        cy={p.y}
                        r={r}
                        {...commonProps}
                    />
                );
            };

            return (
                <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon}>
                    {pts.map((p, idx) => renderCountPoint(p, idx, m, isShadow, measCommon))}
                </g>
            );
        }

        const isEditing = editingId === m.id;
        const strokeOpacity = isShadow ? 0.7 : (m.strokeOpacity ?? 1);
        const textOpacity = isShadow ? 0.7 : (m.textOpacity ?? 1);

        // Comment: Line + Dot. Callout: Arrow. Text: None.
        const renderConnector = () => {
            if (m.type === "comment" && m.tip) {
                const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "#333");
                return (
                    <>
                        <line
                            x1={m.tip.x}
                            y1={m.tip.y}
                            x2={m.box.x + m.box.w / 2} // connect to center
                            y2={m.box.y + m.box.h / 2}
                            stroke={strokeColor}
                            strokeWidth={1}
                            strokeOpacity={strokeOpacity}
                        />
                        <circle
                            cx={m.tip.x}
                            cy={m.tip.y}
                            r={3}
                            fill={strokeColor}
                            fillOpacity={strokeOpacity}
                        />
                    </>
                );
            }
            if (m.type === "callout" && m.tip) {
                const { start, knee, end } = getCalloutPoints(m.box, m.tip, m.knee, m.rotation || 0);

                // Shorten the last segment for callout (knee -> tip)
                // Vector from knee to tip
                const tipDx = end.x - knee.x;
                const tipDy = end.y - knee.y;
                const len = Math.hypot(tipDx, tipDy);
                const rawSw = m.strokeWidth || 2;
                const sw = rawSw;
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
                const strokeDasharray = isShadow ? undefined : (
                    m.strokeDasharray === 'dashed' ? '12, 12'
                        : m.strokeDasharray === 'dotted' ? '2, 8'
                            : (m.strokeDasharray === 'none' ? undefined : m.strokeDasharray)
                );

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
                const strokeColor = isShadow ? "#cbd5e1" : (m.stroke || "#333");

                return (
                    <>
                        {/* Manual Arrow Head */}
                        <polygon
                            points="0,0 -8,-3 -8,3"
                            transform={arrowTransform}
                            fill={strokeColor}
                            fillOpacity={strokeOpacity}
                        />
                        <polyline
                            points={points}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={rawSw}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={strokeDasharray}
                            strokeOpacity={strokeOpacity}
                        />
                        {/* Hit Target for Arrow Tip Marker */}
                        {!isShadow && (
                            <circle
                                cx={end.x}
                                cy={end.y}
                                r={7.7 / Math.max(1e-6, viewScale)}
                                fill="transparent"
                                stroke="none"
                                data-meas-id={m.id}
                                style={{ pointerEvents: 'all', cursor: 'move' }}
                            />
                        )}
                    </>
                );
            }
            return null;
        };

        const fontSize = m.fontSize || 14;
        const textColor = isShadow ? "#94a3b8" : (m.textColor || "black");
        const borderColor = isShadow ? "#cbd5e1" : (m.stroke || "#333");
        const bgColor = isShadow ? "none" : (m.fill || (m.type === "text" ? "transparent" : "#fff"));
        const strokeDasharray = isShadow ? undefined : (
            m.strokeDasharray === 'dashed' ? '12, 12' :
                m.strokeDasharray === 'dotted' ? '2, 8' :
                    (m.strokeDasharray === 'none' ? undefined : m.strokeDasharray)
        );

        return (
            <g key={m.id + (isShadow ? "-shadow" : "")} {...measCommon}>
                {/* Content Group with Opacity */}
                <g style={{ opacity: isShadow ? 0.7 : 1 }}>
                    {renderConnector()}
                    <g transform={m.rotation ? `rotate(${m.rotation}, ${m.box.x + m.box.w / 2}, ${m.box.y + m.box.h / 2})` : undefined}>
                        {/* Background Rect for Styling */}
                        <rect
                            x={m.box.x}
                            y={m.box.y}
                            width={m.box.w}
                            height={m.box.h}
                            fill={bgColor}
                            fillOpacity={isShadow ? 0.7 : (m.opacity ?? 1)}
                            stroke={borderColor}
                            strokeWidth={m.strokeWidth || 1}
                            strokeDasharray={strokeDasharray}
                            strokeOpacity={strokeOpacity}
                            strokeLinecap="round"
                            rx={0} ry={0}
                        />

                        {!isShadow && (
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
                                        onFocus={(e) => {
                                            const len = e.target.value.length;
                                            e.target.setSelectionRange(len, len);
                                        }}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            resize: "none",
                                            border: "none",
                                            padding: "4px",
                                            margin: 0,
                                            fontSize: `${fontSize}px`,
                                            fontWeight: m.bold ? 'bold' : 'normal',
                                            fontStyle: m.italic ? 'italic' : 'normal',
                                            textDecoration: [
                                                m.underline ? 'underline' : '',
                                                m.crossout ? 'line-through' : ''
                                            ].filter(Boolean).join(' ') || 'none',
                                            background: "transparent",
                                            color: textColor,
                                            opacity: textOpacity,
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
                                            opacity: textOpacity,
                                            padding: "4px",
                                            margin: 0,
                                            fontSize: `${fontSize}px`,
                                            fontWeight: m.bold ? 'bold' : 'normal',
                                            fontStyle: m.italic ? 'italic' : 'normal',
                                            textDecoration: [
                                                m.underline ? 'underline' : '',
                                                m.crossout ? 'line-through' : ''
                                            ].filter(Boolean).join(' ') || 'none',
                                            fontFamily: 'sans-serif',
                                            overflow: "hidden",
                                            wordBreak: "break-word",
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
                        )}
                    </g>
                </g>
            </g>
        );
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
        <div style={{ position: "absolute", top: 0, left: 0, width, height }}>
            {/* 1) Canvas Layer should not intercept input */}
            <div style={{ pointerEvents: "none" }}>
                <OverlayCanvasLayer
                    width={width}
                    height={height}
                    viewScale={viewScale}
                    renderScale={renderScale}
                    shapes={[]}  // Shapes always render on SVG (like callout), never on canvas
                    measurements={[]}  // Measurements always render on SVG (like callout), never on canvas
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
                onPointerLeave={() => setSnapIndicator(null)}
                onDoubleClick={() => finishDrawing(true)}
                onContextMenu={handleContextMenu}
            >
                {/* 0️⃣ SHADOW SHAPES / MEASUREMENTS (Left behind during editing) */}
                {(() => {
                    const shadows = [];
                    if (resizingState && resizingState.startShape) {
                        const start = resizingState.startShape;
                        if (start.type !== "highlight") {
                            if (resizingState.isMeasurement) {
                                shadows.push({ item: start, type: 'measurement' });
                            } else {
                                shadows.push({ item: start, type: 'shape' });
                            }
                        }
                    } else if (isDraggingItems && dragStartItems && (dragDelta.x !== 0 || dragDelta.y !== 0)) {
                        Object.entries(dragStartItems).forEach(([id, startItem]) => {
                            if (startItem.type !== "highlight") {
                                const isMeas = pageMeasurements.some(m => m.id === id);
                                shadows.push({ item: startItem, type: isMeas ? 'measurement' : 'shape' });
                            }
                        });
                    }
                    return shadows.map(({ item, type }) => {
                        if (type === 'shape') {
                            return renderShape(item, true);
                        } else {
                            return renderMeasurement(item, true);
                        }
                    });
                })()}

                {/* 1️⃣ INVISIBLE SHAPE HIT TARGETS */}
                {activeTool === "select" && pageShapes.map(renderShapeHitTarget)}

                {/* All Shapes — always on SVG (like callout), no canvas/SVG switch */}
                {pageShapes
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
                                } else if (s.type === "polyline" || s.type === "polygon") {
                                    shapeToRender = {
                                        ...s,
                                        points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
                                    };
                                } else {
                                    shapeToRender = { ...s, x: s.x + dx, y: s.y + dy };
                                }
                            }
                        }

                        return renderShape(shapeToRender);
                    })
                }

                {/* All Measurements — always on SVG (like callout), no canvas/SVG switch */}
                {pageMeasurements
                    .map(m => {
                        let measToRender = m;

                        if (dragDelta.x !== 0 || dragDelta.y !== 0) {
                            if (selectedIds.includes(m.id)) {
                                const dx = dragDelta.x, dy = dragDelta.y;

                                if (isDraggingTextRef.current && ['length', 'angle', 'area', 'perimeter', 'polylength'].includes(m.type)) {
                                    const currentOffset = m.textOffset || { x: 0, y: 0 };
                                    measToRender = {
                                        ...m,
                                        textOffset: { x: currentOffset.x + dx, y: currentOffset.y + dy }
                                    };
                                } else if (m.type === "callout") {
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

                        if (activeTool === "text") {
                            const x = Math.min(shapeStart.x, cursor.x);
                            const y = Math.min(shapeStart.y, cursor.y);
                            const w = Math.abs(cursor.x - shapeStart.x);
                            const h = Math.abs(cursor.y - shapeStart.y);

                            const box = { x, y, w, h };

                            const m = {
                                id: tempId,
                                type: "text",
                                box,
                                text: "Text",
                                ...defaultShapeStyle,
                                stroke: defaultShapeStyle.stroke || '#333333',
                                strokeWidth: defaultShapeStyle.strokeWidth || 1,
                                fill: defaultShapeStyle.fill || 'transparent'
                            };
                            return renderMeasurement(m);
                        }

                        if (activeTool === "callout") {
                            // Don't show callout preview for the first 0.1s (100ms)
                            if (Date.now() - drawStartTimeRef.current < 100) {
                                return null;
                            }
                            // Preview Callout
                            const w = 125;
                            const h = 25;
                            const dx = cursor.x - shapeStart.x;
                            const dy = cursor.y - shapeStart.y;

                            // Box Position: Cursor is Connection Point.
                            // Knee Stub: Fixed 20px from connection point.
                            const stub = 20;
                            let bx, kneeX, by, kneeY;

                            if (Math.abs(dy) > Math.abs(dx) * 1.5) {
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
                        if (activeTool === "highlight") {
                            s.fill = "#ffeb3b";
                            s.stroke = "transparent";
                            s.opacity = 0.4;
                        }

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
                        {["area", "perimeter", "polyline", "polygon", "polylength"].includes(activeTool) ? (
                            <>
                                <polyline
                                    points={[...drawingPoints, cursor].map(p => p ? `${p.x},${p.y}` : "").join(" ")}
                                    fill={activeTool === "area" ? "rgba(108,176,86,0.25)" : "none"}
                                    stroke="var(--primary-color)"
                                    strokeWidth={2 / Math.max(1e-6, viewScale)}
                                />
                                {/* Close-path preview line for polygon */}
                                {activeTool === "polygon" && drawingPoints.length >= 2 && cursor && (
                                    <line
                                        x1={cursor.x}
                                        y1={cursor.y}
                                        x2={drawingPoints[0].x}
                                        y2={drawingPoints[0].y}
                                        stroke="var(--primary-color)"
                                        strokeWidth={2 / Math.max(1e-6, viewScale)}
                                        strokeDasharray={`${6 / Math.max(1e-6, viewScale)},${4 / Math.max(1e-6, viewScale)}`}
                                        opacity={0.5}
                                    />
                                )}
                                {drawingPoints.map((p, i) => (
                                    <circle
                                        key={i}
                                        cx={p.x}
                                        cy={p.y}
                                        r={handleSize / 2}
                                        fill="#b4e6a0"
                                        stroke="#3a6b24"
                                        strokeWidth={1 / Math.max(1e-6, viewScale)}
                                        vectorEffect="non-scaling-stroke"
                                    />
                                ))}
                            </>
                        ) : null}
                        {/* Render line for length or calibrate */}
                        {["length", "calibrate"].includes(activeTool) && cursor ? (
                            <line x1={drawingPoints[0].x} y1={drawingPoints[0].y} x2={cursor.x} y2={cursor.y} stroke="var(--primary-color)" strokeWidth={2 / Math.max(1e-6, viewScale)} />
                        ) : null}

                        {/* Render preview for angle tool */}
                        {activeTool === "angle" && cursor && (
                            <>
                                {drawingPoints.length === 1 && (
                                    <line
                                        x1={drawingPoints[0].x}
                                        y1={drawingPoints[0].y}
                                        x2={cursor.x}
                                        y2={cursor.y}
                                        stroke="var(--primary-color)"
                                        strokeWidth={2 / Math.max(1e-6, viewScale)}
                                    />
                                )}
                                {drawingPoints.length === 2 && (() => {
                                    const p0 = drawingPoints[0];
                                    const p1 = drawingPoints[1];
                                    const p2 = cursor;
                                    const v1 = { x: p0.x - p1.x, y: p0.y - p1.y };
                                    const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
                                    const d1 = Math.hypot(v1.x, v1.y);
                                    const d2 = Math.hypot(v2.x, v2.y);
                                    let angleText = "";
                                    if (d1 > 1e-3 && d2 > 1e-3) {
                                        const dot = v1.x * v2.x + v1.y * v2.y;
                                        const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (d1 * d2))));
                                        angleText = `${(angleRad * 180 / Math.PI).toFixed(1)}°`;
                                    }
                                    return (
                                        <>
                                            <polyline
                                                points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                                                fill="none"
                                                stroke="var(--primary-color)"
                                                strokeWidth={2 / Math.max(1e-6, viewScale)}
                                                strokeLinecap="butt"
                                                strokeLinejoin="miter"
                                            />
                                            {angleText && (
                                                <text
                                                    x={p1.x}
                                                    y={p1.y - 12 / Math.max(1e-6, viewScale)}
                                                    fill="var(--primary-color)"
                                                    fontSize={14 / Math.max(1e-6, viewScale)}
                                                    fontWeight="bold"
                                                    textAnchor="middle"
                                                >
                                                    {angleText}
                                                </text>
                                            )}
                                        </>
                                    );
                                })()}
                            </>
                        )}

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

                {/* 3️⃣ Selection Handles (Always at the very front of the SVG) */}
                {selectedIds.map(id => {
                    const s = pageShapes.find(x => x.id === id);
                    if (s) {
                        let shapeToRender = s;
                        if (dragDelta.x !== 0 || dragDelta.y !== 0) {
                            const dx = dragDelta.x, dy = dragDelta.y;
                            if (s.type === "line" || s.type === "arrow") {
                                shapeToRender = {
                                    ...s,
                                    start: { x: s.start.x + dx, y: s.start.y + dy },
                                    end: { x: s.end.x + dx, y: s.end.y + dy },
                                };
                            } else if (s.type === "polyline" || s.type === "polygon") {
                                shapeToRender = {
                                    ...s,
                                    points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
                                };
                            } else {
                                shapeToRender = { ...s, x: s.x + dx, y: s.y + dy };
                            }
                        }
                        if ((s.type === "polyline" || s.type === "polygon") && shapeToRender.points?.length >= 2) {
                            return (
                                <g key={`handles-${s.id}`}>
                                    {shapeToRender.points.map((p, idx) => (
                                        <circle
                                            key={`vertex-${idx}-${p.x}-${p.y}`}
                                            cx={p.x}
                                            cy={p.y}
                                            r={handleSize / 2}
                                            fill="#b4e6a0"
                                            stroke="#3a6b24"
                                            strokeWidth={1 / Math.max(1e-6, viewScale)}
                                            vectorEffect="non-scaling-stroke"
                                            cursor={isShiftPressed ? (isDraggingItems || resizingState ? "default" : deleteVertexCursor) : "default"}
                                            data-resize-id={s.id}
                                            data-resize-handle={`vertex-${idx}`}
                                        />
                                    ))}
                                </g>
                            );
                        }
                        return (
                            <g key={`handles-${s.id}`}>
                                {renderSelectionFrame(shapeToRender)}
                            </g>
                        );
                    }
                    const m = pageMeasurements.find(x => x.id === id);
                    if (m) {
                        let measToRender = m;
                        if (dragDelta.x !== 0 || dragDelta.y !== 0) {
                            const dx = dragDelta.x, dy = dragDelta.y;
                            if (isDraggingTextRef.current && ['length', 'angle', 'area', 'perimeter'].includes(m.type)) {
                                const currentOffset = m.textOffset || { x: 0, y: 0 };
                                measToRender = {
                                    ...m,
                                    textOffset: { x: currentOffset.x + dx, y: currentOffset.y + dy }
                                };
                            } else if (m.type === "callout") {
                                const newBox = { ...m.box, x: m.box.x + dx, y: m.box.y + dy };
                                const changes = { box: newBox };
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
                            } else if (m.point) {
                                measToRender = {
                                    ...m,
                                    point: { x: m.point.x + dx, y: m.point.y + dy }
                                };
                            }
                        }

                        if (measToRender.type === "count") {
                            const pts = measToRender.points || (measToRender.point ? [measToRender.point] : []);
                            return (
                                <g key={`handles-${m.id}`}>
                                    {pts.map((p, idx) => (
                                        <circle
                                            key={`count-handle-${idx}-${p.x}-${p.y}`}
                                            cx={p.x}
                                            cy={p.y}
                                            r={handleSize / 2}
                                            fill="#b4e6a0"
                                            stroke="#3a6b24"
                                            strokeWidth={1 / Math.max(1e-6, viewScale)}
                                            vectorEffect="non-scaling-stroke"
                                            cursor={isShiftPressed ? (isDraggingItems || resizingState ? "default" : deleteVertexCursor) : "default"}
                                            data-resize-id={m.id}
                                            data-resize-handle={`vertex-${idx}`}
                                            data-meas-id={m.id}
                                        />
                                    ))}
                                </g>
                            );
                        }

                        if (["area", "perimeter", "angle", "length", "calibrate", "polylength"].includes(measToRender.type) && measToRender.points?.length >= 2) {
                            return (
                                <g key={`handles-${m.id}`}>
                                    {measToRender.points.map((p, idx) => (
                                        <circle
                                            key={`vertex-${idx}-${p.x}-${p.y}`}
                                            cx={p.x}
                                            cy={p.y}
                                            r={handleSize / 2}
                                            fill="#b4e6a0"
                                            stroke="#3a6b24"
                                            strokeWidth={1 / Math.max(1e-6, viewScale)}
                                            vectorEffect="non-scaling-stroke"
                                            cursor={isShiftPressed ? (isDraggingItems || resizingState ? "default" : deleteVertexCursor) : "default"}
                                            data-resize-id={m.id}
                                            data-resize-handle={`vertex-${idx}`}
                                        />
                                    ))}
                                </g>
                            );
                        }
                        if (measToRender.box) {
                            return (
                                <g key={`handles-${m.id}`}>
                                    {renderSelectionFrame({
                                        id: m.id,
                                        x: measToRender.box.x,
                                        y: measToRender.box.y,
                                        width: measToRender.box.w,
                                        height: measToRender.box.h,
                                        rotation: measToRender.rotation || 0,
                                        type: "rectangle",
                                        isCallout: measToRender.type === 'callout'
                                    })}
                                    {measToRender.type === 'callout' && (
                                        <>
                                            {measToRender.tip && (
                                                <circle
                                                    cx={measToRender.tip.x}
                                                    cy={measToRender.tip.y}
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
                                                const k = getCalloutKnee(measToRender.box, measToRender.tip, measToRender.knee);
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
                                    )}
                                </g>
                            );
                        }
                    }
                    return null;
                })}

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

                {/* Snapping Indicator */}
                {snappingEnabled && snapIndicator && (
                    <g pointerEvents="none">
                        <circle
                            cx={snapIndicator.x}
                            cy={snapIndicator.y}
                            r={7 / Math.max(1e-6, viewScale)}
                            fill="none"
                            stroke="var(--primary-color)"
                            strokeWidth={1.5 / Math.max(1e-6, viewScale)}
                            opacity="0.6"
                            className="animate-pulse"
                        />
                        <circle
                            cx={snapIndicator.x}
                            cy={snapIndicator.y}
                            r={4 / Math.max(1e-6, viewScale)}
                            fill="var(--bg-secondary)"
                            stroke="var(--primary-color)"
                            strokeWidth={2 / Math.max(1e-6, viewScale)}
                        />
                    </g>
                )}

            </svg>

            {canvasContextMenu && createPortal(
                <div
                    style={{
                        position: 'fixed',
                        top: canvasContextMenu.y,
                        left: canvasContextMenu.x,
                        zIndex: 999999,
                    }}
                    className="context-menu-container bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-xl py-1 min-w-[160px] text-sm animate-in fade-in zoom-in-95 duration-100"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                >
                    {canvasContextMenu.type === 'object' ? (
                        <>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleCut}
                            >
                                <span className="flex items-center gap-2">
                                    <Scissors size={14} className="text-[var(--text-secondary)]" />
                                    <span>Cut</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Ctrl+X</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleCopy}
                            >
                                <span className="flex items-center gap-2">
                                    <Copy size={14} className="text-[var(--text-secondary)]" />
                                    <span>Copy</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Ctrl+C</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleDuplicate}
                            >
                                <span className="flex items-center gap-2">
                                    <Layers size={14} className="text-[var(--text-secondary)]" />
                                    <span>Duplicate</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Ctrl+D</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleSetAsDefault}
                            >
                                <span className="flex items-center gap-2">
                                    <Star size={14} className="text-[var(--text-secondary)]" />
                                    <span>Set as Default</span>
                                </span>
                            </button>
                            {(() => {
                                const targetId = canvasContextMenu.targetId;
                                const item = pageMeasurements.find(m => m.id === targetId);
                                if (item && item.type === "count") {
                                    return (
                                        <button
                                            className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)]"
                                            onClick={() => {
                                                activeCountGroupIdRef.current = item.id;
                                                setActiveTool("count");
                                                setCanvasContextMenu(null);
                                            }}
                                        >
                                            <span className="flex items-center gap-2">
                                                <Play size={14} className="text-[var(--text-secondary)]" />
                                                <span>Resume Count</span>
                                            </span>
                                        </button>
                                    );
                                }
                                return null;
                            })()}
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleDelete}
                            >
                                <span className="flex items-center gap-2">
                                    <Trash2 size={14} className="text-[var(--text-secondary)]" />
                                    <span>Delete</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Del</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => {
                                    setLeftPanelActiveTab('properties');
                                    setCanvasContextMenu(null);
                                }}
                            >
                                <span className="flex items-center gap-2">
                                    <Sliders size={14} className="text-[var(--text-secondary)]" />
                                    <span>Properties</span>
                                </span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => {
                                    const source = pageShapes.find(s => selectedIds.includes(s.id)) || pageMeasurements.find(m => selectedIds.includes(m.id));
                                    if (source) {
                                        setFormatPaintStyle({
                                            stroke: source.stroke,
                                            strokeWidth: source.strokeWidth,
                                            strokeDasharray: source.strokeDasharray,
                                            fill: source.fill,
                                            opacity: source.opacity,
                                            strokeOpacity: source.strokeOpacity,
                                            textOpacity: source.textOpacity,
                                            fontSize: source.fontSize,
                                            bold: source.bold,
                                            italic: source.italic,
                                            underline: source.underline,
                                            crossout: source.crossout,
                                            textColor: source.textColor,
                                        });
                                        setActiveTool("format-painter");
                                    }
                                    setCanvasContextMenu(null);
                                }}
                            >
                                <span className="flex items-center gap-2">
                                    <Paintbrush size={14} className="text-[var(--text-secondary)]" />
                                    <span>Format Painter</span>
                                </span>
                            </button>
                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleDeselectAll}
                            >
                                <span className="flex items-center gap-2">
                                    <XCircle size={14} className="text-[var(--text-secondary)]" />
                                    <span>Deselect</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Esc</span>
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handlePaste}
                                disabled={!clipboard || clipboard.length === 0}
                            >
                                <span className="flex items-center gap-2">
                                    <Clipboard size={14} className="text-[var(--text-secondary)]" />
                                    <span>Paste</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Ctrl+V</span>
                            </button>
                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleSelectAll}
                            >
                                <span className="flex items-center gap-2">
                                    <CheckSquare size={14} className="text-[var(--text-secondary)]" />
                                    <span>Select All</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Ctrl+A</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-3 py-1.5 text-left cursor-pointer text-[13px] flex items-center justify-between w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default"
                                onClick={handleDeselectAll}
                                disabled={selectedIds.length === 0}
                            >
                                <span className="flex items-center gap-2">
                                    <XCircle size={14} className="text-[var(--text-secondary)]" />
                                    <span>Deselect All</span>
                                </span>
                                <span className="text-[11px] text-[var(--text-secondary)] font-mono ml-4">Esc</span>
                            </button>
                        </>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

export default OverlayLayer;
