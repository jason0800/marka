import React, { useRef, useEffect, memo } from "react";
import { calculateDistance, calculatePolygonArea } from "../geometry/transforms";

const MAX_CANVAS_PIXELS = 5_000_000; // ~5MP Cap (Aggressive Memory Optimization)
const MAX_SIDE = 8192;               // GPU Texture Limit

const OverlayCanvasLayer = ({
    width,
    height,
    viewScale = 1.0,
    renderScale = 1.0,
    shapes = [],
    measurements = [],
    selectedIds = [],
    pageUnits = {},
    pageIndex,
    calibrationScales = {},
}) => {
    const canvasRef = useRef(null);

    // Helpers for units
    const calibrationScale = calibrationScales[pageIndex] || 1.0;
    const unit = pageUnits[pageIndex] || "px";

    const toUnits = (pdfPoints) => pdfPoints / Math.max(1e-9, calibrationScale);
    const toUnits2 = (pdfPoints2) => pdfPoints2 / Math.max(1e-9, calibrationScale * calibrationScale);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Handle High DPI + Render Scale (Crispness)
        const dpr = window.devicePixelRatio || 1;
        const effectiveDpr = dpr * renderScale;

        // Resize canvas if needed
        let targetW = Math.floor(width * effectiveDpr);
        let targetH = Math.floor(height * effectiveDpr);

        // Safety Cap: Downscale if exceeding limits
        let reductionScale = 1.0;
        const totalPixels = targetW * targetH;

        if (totalPixels > MAX_CANVAS_PIXELS) {
            reductionScale = Math.sqrt(MAX_CANVAS_PIXELS / totalPixels);
        } else if (targetW > MAX_SIDE || targetH > MAX_SIDE) {
            reductionScale = Math.min(MAX_SIDE / targetW, MAX_SIDE / targetH);
        }

        if (reductionScale < 1.0) {
            targetW = Math.floor(targetW * reductionScale);
            targetH = Math.floor(targetH * reductionScale);
        }

        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        const ctx = canvas.getContext("2d", { alpha: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset

        // effectiveDpr * reductionScale gives the correct scale factor
        const finalScale = effectiveDpr * reductionScale;
        ctx.scale(finalScale, finalScale);

        ctx.clearRect(0, 0, width, height);

        // Global Scaling: Map PDF coordinates to Screen pixels
        ctx.save();
        ctx.scale(viewScale, viewScale);

        // Pre-calculate constants for "non-scaling" look
        // viewScale is applied to context. So to get 1px visual width, we need 1/viewScale.
        // effectiveDpr is handled by canvas transform.
        // But we actually want "2px" or "1.5px" essentially.
        // The safe buffer 1e-6 prevents divide by zero.
        const safeScale = Math.max(1e-6, viewScale);

        // We want the stroke to effectively be ~2px on screen regardless of zoom?
        // Or do we want it to scale? 
        // User wants "non-scaling-stroke".
        // If we zoom in (viewScale=2), 1 unit = 2px. 1/2 unit = 1px.
        // So 2px visual = 2/viewScale.
        // BUT we also have renderScale which affects resolution but NOT coordinate space (handled by initial scale).
        // Wait, initial scale is `effectiveDpr`.
        // Then `ctx.scale(viewScale, ...)`
        // So 1 unit = `viewScale * effectiveDpr` physical pixels.
        // We want constant visual thickness.
        // Thickness in units = DesiredPixels / (viewScale * effectiveDpr) ? 
        // No, the initial scale handles Dpr. `ctx.lineWidth` 1 means 1 * viewScale * effectiveDpr pixels?
        // No. If I set ctx.scale(2,2), drawing rect(0,0,10,10) draws 20x20 pixels.
        // ctx.lineWidth=1 draws 2px line.
        // So to get 2px line, we need lineWidth = 2 / viewScale.
        // We do NOT divide by renderScale because renderScale should increase resolution (more pixels).
        // Actually, if renderScale=2, effectiveDpr=2.
        // If viewScale=1.
        // ctx.scale(2,2).
        // lineWidth=2 line becomes 4px physical.
        // But on high DPI screen, 4px physical looks like 2px CSS. So that's correct?
        // Yes. We just divide by viewScale.

        const nonScalingLineWidth = 2 / safeScale;
        const textFontSize = 14 / safeScale;
        const textOffset = 8 / safeScale;
        const selectedSet = new Set(selectedIds);

        const isOutOfBounds = (item) => {
            if (item.type === "line" || item.type === "arrow" || (item.type === "length" && item.points)) {
                const pts = item.points || [item.start, item.end];
                if (!pts) return false;
                const minX = Math.min(...pts.map(p => p.x));
                const maxX = Math.max(...pts.map(p => p.x));
                const minY = Math.min(...pts.map(p => p.y));
                const maxY = Math.max(...pts.map(p => p.y));
                return minX < 0 || minY < 0 || maxX > width || maxY > height;
            }
            if ((item.type === "area" || item.type === "perimeter") && item.points) {
                const minX = Math.min(...item.points.map(p => p.x));
                const maxX = Math.max(...item.points.map(p => p.x));
                const minY = Math.min(...item.points.map(p => p.y));
                const maxY = Math.max(...item.points.map(p => p.y));
                return minX < 0 || minY < 0 || maxX > width || maxY > height;
            }
            if (item.type === "count" && item.point) {
                const { x, y } = item.point;
                const r = 8;
                return x - r < 0 || y - r < 0 || x + r > width || y + r > height;
            }

            // Box based
            const x = item.x ?? item.box?.x ?? 0;
            const y = item.y ?? item.box?.y ?? 0;
            const w = item.width ?? item.box?.w ?? 0;
            const h = item.height ?? item.box?.h ?? 0;
            return x < 0 || y < 0 || x + w > width || y + h > height;
        };

        // --- SHAPE LOOP ---
        for (let i = 0; i < shapes.length; i++) {
            const shape = shapes[i];
            if (selectedSet.has(shape.id) || isOutOfBounds(shape)) continue;

            const hasFill = shape.fill && shape.fill !== "none" && shape.fill !== "transparent";
            const opacity = shape.opacity ?? 1;

            // Note: shape.strokeWidth might be stored (e.g. 2).
            // If we want it "vector" (scaling), we leave it.
            // If we want "non-scaling", we divide by viewScale.
            // Typically user shapes usually scale? The user said "non-scaling-stroke" in the SVG code.
            // SVG code: `strokeWidth={1 / viewScale}`.
            // So default shapes ARE non-scaling.

            const rawStrokeWidth = shape.strokeWidth || 2;
            const strokeWidth = rawStrokeWidth / safeScale;

            const stroke = shape.stroke || "#000";
            const dash = shape.strokeDasharray || "none";

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.lineCap = shape.type === "arrow" ? "butt" : "round";
            ctx.lineJoin = "round";

            if (dash && dash !== "none") {
                ctx.setLineDash(dash.split(",").map(Number));
            } else {
                ctx.setLineDash([]);
            }

            // Geometry
            ctx.beginPath();
            if (shape.type === "rectangle") {
                if (hasFill && shape.rotation) drawRotatedRect(ctx, shape, true); // Path only
                else if (shape.rotation) drawRotatedRectPath(ctx, shape);
                else ctx.rect(shape.x, shape.y, shape.width, shape.height);
            } else if (shape.type === "circle") {
                if (shape.rotation) drawRotatedEllipsePath(ctx, shape);
                else {
                    const cx = shape.x + shape.width / 2;
                    const cy = shape.y + shape.height / 2;
                    const rx = shape.width / 2;
                    const ry = shape.height / 2;
                    ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                }
            } else if (shape.type === "line") {
                ctx.moveTo(shape.start.x, shape.start.y);
                ctx.lineTo(shape.end.x, shape.end.y);
            } else if (shape.type === "arrow") {
                // Shorten line to stop inside arrow head (Tip - 4units)
                // Tip is shape.end
                const dx = shape.end.x - shape.start.x;
                const dy = shape.end.y - shape.start.y;
                const len = Math.hypot(dx, dy);
                const sw = ctx.lineWidth;
                // SVG logic: refX=2, Tip=6. Diff=4.
                const offset = 4 * sw;

                let ex = shape.end.x;
                let ey = shape.end.y;

                if (len > offset) {
                    const t = (len - offset) / len;
                    ex = shape.start.x + dx * t;
                    ey = shape.start.y + dy * t;
                } else {
                    ex = shape.start.x;
                    ey = shape.start.y;
                }

                ctx.moveTo(shape.start.x, shape.start.y);
                ctx.lineTo(ex, ey);
            }

            if (hasFill) {
                ctx.fillStyle = shape.fill;
                ctx.fill();
            }

            if (stroke !== "none") {
                ctx.stroke();
            }

            // Arrow head
            if (shape.type === "arrow") {
                drawArrowHead(ctx, shape, stroke);
            }

            ctx.restore();
        }

        // --- MEASUREMENTS LOOP ---
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = `${textFontSize}px sans-serif`;

        measurements.forEach(m => {
            if (selectedSet.has(m.id)) return;

            ctx.save();

            const opacity = m.opacity ?? 1;
            ctx.globalAlpha = opacity;

            const strokeColor = m.stroke || (
                m.type === "length" ? "#e74c3c" :
                    m.type === "area" ? "#2ecc71" :
                        m.type === "perimeter" ? "#9b59b6" :
                            m.type === "count" ? "white" : "#333"
            );

            const fillColor = m.fill || (
                m.type === "area" ? "rgba(108, 176, 86, 0.25)" :
                    m.type === "count" ? "#e67e22" :
                        "none"
            );

            const rawStrokeWidth = m.strokeWidth ? m.strokeWidth : 2;
            // Measurements are usually non-scaling 2px
            const strokeWidth = rawStrokeWidth / safeScale;

            ctx.lineWidth = strokeWidth;
            ctx.strokeStyle = strokeColor;
            ctx.fillStyle = fillColor;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            if (m.type === "length" && m.points?.length === 2) {
                const [a, b] = m.points;
                const dist = calculateDistance(a, b);

                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();

                ctx.fillStyle = strokeColor;
                const midX = (a.x + b.x) / 2;
                const midY = (a.y + b.y) / 2;
                ctx.fillText(`${toUnits(dist).toFixed(2)} ${unit}`, midX, midY - textOffset);

            } else if (m.type === "area" && m.points?.length >= 3) {
                const area = calculatePolygonArea(m.points);

                ctx.beginPath();
                m.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = strokeColor;
                ctx.textAlign = "left";
                ctx.fillText(`${toUnits2(area).toFixed(2)} ${unit}²`, m.points[0].x, m.points[0].y - textOffset);

            } else if (m.type === "perimeter" && m.points?.length >= 2) {
                let len = 0;
                ctx.beginPath();
                m.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else {
                        ctx.lineTo(p.x, p.y);
                        len += calculateDistance(m.points[i - 1], p);
                    }
                });
                ctx.stroke();

                ctx.fillStyle = strokeColor;
                ctx.textAlign = "left";
                ctx.fillText(`${toUnits(len).toFixed(2)} ${unit}`, m.points[0].x, m.points[0].y - textOffset);

            } else if (m.type === "count" && m.point) {
                const r = 8 / safeScale;

                ctx.beginPath();
                ctx.arc(m.point.x, m.point.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else if (m.type === "comment" && m.tip && m.box) {
                const midX = m.box.x + m.box.w / 2;
                const midY = m.box.y + m.box.h / 2;

                ctx.beginPath();
                ctx.moveTo(m.tip.x, m.tip.y);
                ctx.lineTo(midX, midY);
                ctx.stroke();

                ctx.fillStyle = strokeColor;
                ctx.beginPath();
                ctx.arc(m.tip.x, m.tip.y, 3 / safeScale, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        });

        ctx.restore(); // End global scale
    }, [width, height, viewScale, renderScale, shapes, measurements, selectedIds, pageIndex, calibrationScales, pageUnits]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: width,
                height: height,
                pointerEvents: "none",
                zIndex: 0,
            }}
        />
    );
};

// --- Helper Functions ---

function drawRotatedRectPath(ctx, shape) {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const w = shape.width;
    const h = shape.height;

    ctx.translate(cx, cy);
    ctx.rotate((shape.rotation || 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);

    ctx.rect(shape.x, shape.y, w, h);
}

// For fills where we might want path only or rect
function drawRotatedRect(ctx, shape, pathOnly = false) {
    // simplified for canvas transform
    // Actually simpler to just use transform on context:
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;

    ctx.translate(cx, cy);
    ctx.rotate((shape.rotation || 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);

    ctx.rect(shape.x, shape.y, shape.width, shape.height);
}

function drawRotatedEllipsePath(ctx, shape) {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    const rot = (shape.rotation || 0) * Math.PI / 180;

    ctx.ellipse(cx, cy, rx, ry, rot, 0, 2 * Math.PI);
}

function drawArrowHead(ctx, shape, color) {
    ctx.save();
    // No linecap on arrow head usually, or round
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const sw = ctx.lineWidth; // Match SVG markerUnits="strokeWidth"

    const dx = shape.end.x - shape.start.x;
    const dy = shape.end.y - shape.start.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // SVG Marker Geometry (0,0, 6,2, 0,4)
    // Tip at (6,2)
    // Base at (0x)
    // Total Length = 6 units

    // We want Tip to be at shape.end
    // So TipOffset = 0
    // BaseOffset = -6 * sw

    const tipOffset = 0;
    const baseOffset = -6 * sw;
    const halfWidth = 2 * sw; // Width 4 total

    // Tip Point
    const tX = shape.end.x + tipOffset * cos;
    const tY = shape.end.y + tipOffset * sin;

    // Base Center
    const bX = shape.end.x + baseOffset * cos;
    const bY = shape.end.y + baseOffset * sin;

    // Base Corners (perpendicular)
    // Normal is (-sin, cos)
    const c1X = bX - halfWidth * sin;
    const c1Y = bY + halfWidth * cos;

    const c2X = bX + halfWidth * sin;
    const c2Y = bY - halfWidth * cos;

    ctx.beginPath();
    ctx.moveTo(tX, tY); // Tip
    ctx.lineTo(c1X, c1Y); // Top Corner
    ctx.lineTo(c2X, c2Y); // Bottom Corner
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

export default memo(OverlayCanvasLayer);
