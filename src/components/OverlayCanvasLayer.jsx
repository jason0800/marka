import React, { useRef, useEffect, memo } from "react";
import { calculateDistance, calculatePolygonArea } from "../geometry/transforms";

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
        const targetW = Math.floor(width * effectiveDpr);
        const targetH = Math.floor(height * effectiveDpr);

        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        const ctx = canvas.getContext("2d", { alpha: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
        ctx.scale(effectiveDpr, effectiveDpr);
        ctx.clearRect(0, 0, width, height);

        // Global Scaling
        ctx.save();
        ctx.scale(viewScale, viewScale);

        // Pre-calculate constants
        const nonScalingLineWidth = 2 / Math.max(1e-6, viewScale);
        const textFontSize = 14 / Math.max(1e-6, viewScale);
        const textOffset = 8 / Math.max(1e-6, viewScale);
        const selectedSet = new Set(selectedIds);

        // --- BATCH RENDERING STATE ---
        let currentStroke = null;
        let currentStrokeWidth = -1;
        let currentOpacity = -1;
        let currentDash = ""; // "none" or "5,5"
        let isBatching = false;

        // Helper to flush current batch
        const flushBatch = () => {
            if (!isBatching) return;
            // Stroke first
            if (currentStroke && currentStroke !== "none") {
                ctx.strokeStyle = currentStroke;
                ctx.lineWidth = currentStrokeWidth;
                ctx.stroke();
            }
            ctx.beginPath(); // Clear path
            isBatching = false;
        };

        const beginBatch = (stroke, strokeWidth, opacity, dash) => {
            // Check if matches current
            if (
                isBatching &&
                currentStroke === stroke &&
                Math.abs(currentStrokeWidth - strokeWidth) < 0.001 &&
                Math.abs(currentOpacity - opacity) < 0.001 &&
                currentDash === dash
            ) {
                return; // Continue batch
            }

            // Mismatch, flush and start new
            flushBatch();

            currentStroke = stroke;
            currentStrokeWidth = strokeWidth;
            currentOpacity = opacity;
            currentDash = dash;

            ctx.globalAlpha = opacity;

            if (dash && dash !== "none") {
                const dashes = dash.split(",").map(Number);
                ctx.setLineDash(dashes);
            } else {
                ctx.setLineDash([]);
            }

            ctx.beginPath();
            isBatching = true;
        };

        // --- SHAPE LOOP ---
        for (let i = 0; i < shapes.length; i++) {
            const shape = shapes[i];
            if (selectedSet.has(shape.id)) continue;

            const hasFill = shape.fill && shape.fill !== "none" && shape.fill !== "transparent";
            const opacity = shape.opacity ?? 1;

            // Note: shape.strokeWidth scales with viewScale (it is "vector" width)
            const strokeWidth = shape.strokeWidth || 2;
            const stroke = shape.stroke || "#000";
            const dash = shape.strokeDasharray || "none";

            if (hasFill) {
                // Determine if we can batch fills? 
                // Hard to batch fills correctly if they overlap. 
                // Let's flush, draw individually, continue.
                flushBatch();

                ctx.save();
                ctx.globalAlpha = opacity;
                ctx.strokeStyle = stroke;
                ctx.lineWidth = strokeWidth;
                ctx.fillStyle = shape.fill;

                if (dash !== "none") {
                    ctx.setLineDash(dash.split(",").map(Number));
                }

                // Draw geometry
                ctx.beginPath();
                if (shape.type === "rectangle") {
                    drawRotatedRect(ctx, shape);
                } else if (shape.type === "circle") {
                    drawRotatedEllipse(ctx, shape);
                } else if (shape.type === "line" || shape.type === "arrow") {
                    ctx.moveTo(shape.start.x, shape.start.y);
                    ctx.lineTo(shape.end.x, shape.end.y);
                }

                ctx.fill();
                ctx.stroke();

                // Arrow head handling
                if (shape.type === "arrow") drawArrowHead(ctx, shape, stroke);

                ctx.restore();
                continue;
            }

            // NO FILL -> Batch candidate
            beginBatch(stroke, strokeWidth, opacity, dash);

            if (shape.type === "line" || shape.type === "arrow") {
                ctx.moveTo(shape.start.x, shape.start.y);
                ctx.lineTo(shape.end.x, shape.end.y);
            }
            else if (shape.type === "rectangle") {
                drawRotatedRectPath(ctx, shape);
            }
            else if (shape.type === "circle") {
                drawRotatedEllipsePath(ctx, shape);
            }

            // If arrow, we need to draw the head. 
            if (shape.type === "arrow") {
                flushBatch(); // Draw current lines to ensure head is on top/correct
                drawArrowHead(ctx, shape, stroke); // Draw head independent
            }
        }
        flushBatch(); // Finish shapes


        // --- MEASUREMENTS LOOP ---
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const fontStr = `${textFontSize}px sans-serif`;
        ctx.font = fontStr;

        measurements.forEach(m => {
            if (selectedSet.has(m.id)) return;

            ctx.save();

            if (m.type === "length" && m.points?.length === 2) {
                const [a, b] = m.points;
                const dist = calculateDistance(a, b);

                ctx.strokeStyle = "#e74c3c";
                ctx.fillStyle = "#e74c3c";
                ctx.lineWidth = nonScalingLineWidth;

                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();

                const midX = (a.x + b.x) / 2;
                const midY = (a.y + b.y) / 2;
                ctx.fillText(`${toUnits(dist).toFixed(2)} ${unit}`, midX, midY - textOffset);

            } else if (m.type === "area" && m.points?.length >= 3) {
                const area = calculatePolygonArea(m.points);

                ctx.fillStyle = "rgba(108, 176, 86, 0.25)";
                ctx.strokeStyle = "#2ecc71";
                ctx.lineWidth = nonScalingLineWidth;

                ctx.beginPath();
                m.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#2ecc71";
                ctx.textAlign = "left";
                ctx.fillText(`${toUnits2(area).toFixed(2)} ${unit}²`, m.points[0].x, m.points[0].y - textOffset);
                ctx.textAlign = "center"; // reset

            } else if (m.type === "perimeter" && m.points?.length >= 2) {
                let len = 0;
                ctx.strokeStyle = "#9b59b6";
                ctx.fillStyle = "#9b59b6";
                ctx.lineWidth = nonScalingLineWidth;

                ctx.beginPath();
                m.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else {
                        ctx.lineTo(p.x, p.y);
                        len += calculateDistance(m.points[i - 1], p);
                    }
                });
                ctx.stroke();

                ctx.textAlign = "left";
                ctx.fillText(`${toUnits(len).toFixed(2)} ${unit}`, m.points[0].x, m.points[0].y - textOffset);
                ctx.textAlign = "center"; // reset
            } else if (m.type === "count" && m.point) {
                ctx.fillStyle = "#e67e22";
                ctx.strokeStyle = "white";
                ctx.lineWidth = nonScalingLineWidth;
                const r = 8 / viewScale;

                ctx.beginPath();
                ctx.arc(m.point.x, m.point.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else if (m.type === "comment" && m.tip && m.box) {
                ctx.strokeStyle = "#333";
                ctx.lineWidth = 1 / viewScale;
                const midX = m.box.x + m.box.w / 2;
                const midY = m.box.y + m.box.h / 2;

                ctx.beginPath();
                ctx.moveTo(m.tip.x, m.tip.y);
                ctx.lineTo(midX, midY);
                ctx.stroke();

                ctx.fillStyle = "#333";
                ctx.beginPath();
                ctx.arc(m.tip.x, m.tip.y, 3 / viewScale, 0, Math.PI * 2);
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

// --- Shape drawing helpers ---

function drawRotatedRectPath(ctx, shape) {
    const { x, y, width, height, rotation } = shape;
    if (!rotation) {
        ctx.rect(x, y, width, height);
        return;
    }
    // Calculate corners
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rad = (rotation * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);

    const hw = width / 2;
    const hh = height / 2;

    // Rotate and translate
    // We already moved to origin (subtracted cx, cy) then added back
    const corners = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
    ].map(p => ({
        x: cx + (p.x * c - p.y * s),
        y: cy + (p.x * s + p.y * c)
    }));

    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
}

function drawRotatedRect(ctx, shape) {
    if (!shape.rotation) {
        ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
        ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
        return;
    }
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
}

function drawRotatedEllipsePath(ctx, shape) {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const rx = shape.width / 2;
    const ry = shape.height / 2;

    if (shape.rotation) {
        ctx.moveTo(cx + rx, cy); // Correct start point might be needed or let ellipse handle
        ctx.ellipse(cx, cy, rx, ry, (shape.rotation * Math.PI) / 180, 0, 2 * Math.PI);
    } else {
        ctx.moveTo(cx + rx, cy);
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
    }
}

function drawRotatedEllipse(ctx, shape) {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    const rot = (shape.rotation || 0) * Math.PI / 180;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
}

function drawArrowHead(ctx, shape, color) {
    ctx.save();
    const dx = shape.end.x - shape.start.x;
    const dy = shape.end.y - shape.start.y;
    const angle = Math.atan2(dy, dx);
    const headLen = 10;
    const headAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(shape.end.x, shape.end.y);
    ctx.lineTo(
        shape.end.x - headLen * Math.cos(angle - headAngle),
        shape.end.y - headLen * Math.sin(angle - headAngle)
    );
    ctx.lineTo(
        shape.end.x - headLen * Math.cos(angle + headAngle),
        shape.end.y - headLen * Math.sin(angle + headAngle)
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

export default memo(OverlayCanvasLayer);
