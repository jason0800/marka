import React, { useRef, useEffect, memo } from "react";
import { calculateDistance, calculatePolygonArea, drawCloudPath } from "../geometry/transforms";

const MAX_CANVAS_PIXELS = 25_000_000; // ~25MP Cap to match high-resolution rendering
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
    const imageCacheRef = useRef(new Map());

    // Helpers for units
    const calibrationScale = calibrationScales[pageIndex - 1] || 1.0;
    const unit = pageUnits[pageIndex - 1] || "px";

    const toUnits = (pdfPoints) => pdfPoints / Math.max(1e-9, calibrationScale);
    const toUnits2 = (pdfPoints2) => pdfPoints2 / Math.max(1e-9, calibrationScale * calibrationScale);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let active = true;
        const imageCache = imageCacheRef.current;

        const draw = () => {
            if (!active) return;

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

            // Use exact pixel ratio derived from the actual backing store size.
            // This ensures 1 canvas coordinate unit = 1 CSS pixel, matching SVG perfectly.
        // Using effectiveDpr*reductionScale can introduce sub-pixel rounding drift
        // because targetW = Math.floor(width * effectiveDpr * reductionScale).
        const scaleX = targetW / width;
        const scaleY = targetH / height;
        ctx.scale(scaleX, scaleY);

        ctx.clearRect(0, 0, width, height);

        // Shapes and measurements are drawn in page coordinate space (scale=1 PDF units).
        // The entire page container is CSS-scaled by the viewer's zoom, so strokes and
        // text use raw values (no viewScale division) to match the SVG overlay layer.
        const textFontSize = 14;
        const textOffset = 8;
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
            if ((item.type === "area" || item.type === "perimeter" || item.type === "polyline" || item.type === "polygon") && item.points) {
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

            if (shape.type === "image") {
                const img = imageCache.get(shape.src);
                if (img) {
                    if (img.complete && img.naturalWidth !== 0) {
                        ctx.save();
                        ctx.globalAlpha = opacity;
                        const cx = shape.x + shape.width / 2;
                        const cy = shape.y + shape.height / 2;
                        if (shape.rotation) {
                            ctx.translate(cx, cy);
                            ctx.rotate((shape.rotation * Math.PI) / 180);
                            ctx.drawImage(img, -shape.width / 2, -shape.height / 2, shape.width, shape.height);
                            
                            // Draw border
                            if (shape.strokeWidth > 0 && shape.stroke && shape.stroke !== 'none' && shape.stroke !== 'transparent') {
                                ctx.strokeStyle = shape.stroke;
                                ctx.lineWidth = shape.strokeWidth;
                                ctx.globalAlpha = (shape.strokeOpacity ?? 1) * opacity;
                                if (shape.strokeDasharray && shape.strokeDasharray !== "none") {
                                    ctx.setLineDash(shape.strokeDasharray.split(",").map(Number));
                                } else {
                                    ctx.setLineDash([]);
                                }
                                ctx.strokeRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
                            }
                        } else {
                            ctx.drawImage(img, shape.x, shape.y, shape.width, shape.height);
                            
                            // Draw border
                            if (shape.strokeWidth > 0 && shape.stroke && shape.stroke !== 'none' && shape.stroke !== 'transparent') {
                                ctx.strokeStyle = shape.stroke;
                                ctx.lineWidth = shape.strokeWidth;
                                ctx.globalAlpha = (shape.strokeOpacity ?? 1) * opacity;
                                if (shape.strokeDasharray && shape.strokeDasharray !== "none") {
                                    ctx.setLineDash(shape.strokeDasharray.split(",").map(Number));
                                } else {
                                    ctx.setLineDash([]);
                                }
                                ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                            }
                        }
                        ctx.restore();
                    }
                } else {
                    const newImg = new Image();
                    newImg.src = shape.src;
                    newImg.onload = () => {
                        requestAnimationFrame(draw);
                    };
                    imageCache.set(shape.src, newImg);
                }
                continue;
            }

            // Note: shape.strokeWidth might be stored (e.g. 2).
            // If we want it "vector" (scaling), we leave it.
            // If we want "non-scaling", we divide by viewScale.
            // Typically user shapes usually scale? The user said "non-scaling-stroke" in the SVG code.
            // SVG code: `strokeWidth={1 / viewScale}`.
            // So default shapes ARE non-scaling.

            const rawStrokeWidth = shape.strokeWidth || 2;
            const strokeWidth = rawStrokeWidth; // Scales with CSS zoom like SVG selected shapes

            const stroke = shape.stroke || "#000";
            const dash = shape.strokeDasharray || "none";

            ctx.save();
            ctx.globalAlpha = opacity;
            if (shape.type === "highlight") {
                ctx.globalCompositeOperation = "multiply";
            }
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.lineCap = (shape.type === "arrow" || shape.type === "line" || shape.type === "polyline" || shape.type === "polygon") ? "butt" : "round";
            ctx.lineJoin = (shape.type === "rectangle" || shape.type === "polyline" || shape.type === "polygon" || shape.type === "highlight") ? "miter" : "round";

            if (dash && dash !== "none") {
                ctx.setLineDash(dash.split(",").map(Number));
            } else {
                ctx.setLineDash([]);
            }

            // Geometry
            ctx.beginPath();
            if (shape.type === "rectangle" || shape.type === "highlight") {
                if (hasFill && shape.rotation) drawRotatedRect(ctx, shape, true); // Path only
                else if (shape.rotation) drawRotatedRectPath(ctx, shape);
                else ctx.rect(shape.x, shape.y, shape.width, shape.height);
            } else if (shape.type === "cloud") {
                const cx = shape.x + shape.width / 2;
                const cy = shape.y + shape.height / 2;
                if (shape.rotation) {
                    ctx.translate(cx, cy);
                    ctx.rotate((shape.rotation * Math.PI) / 180);
                    ctx.translate(-cx, -cy);
                }
                ctx.translate(shape.x, shape.y);
                drawCloudPath(ctx, shape.width, shape.height);
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
            } else if (shape.type === "polyline" && shape.points?.length >= 2) {
                ctx.moveTo(shape.points[0].x, shape.points[0].y);
                for (let j = 1; j < shape.points.length; j++) {
                    ctx.lineTo(shape.points[j].x, shape.points[j].y);
                }
            } else if (shape.type === "polygon" && shape.points?.length >= 3) {
                ctx.moveTo(shape.points[0].x, shape.points[0].y);
                for (let j = 1; j < shape.points.length; j++) {
                    ctx.lineTo(shape.points[j].x, shape.points[j].y);
                }
                ctx.closePath();
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
            // Scale with CSS zoom to match the SVG layer's rendering
            const strokeWidth = rawStrokeWidth;

            ctx.lineWidth = strokeWidth;
            ctx.strokeStyle = strokeColor;
            ctx.fillStyle = fillColor;
            ctx.lineCap = (m.type === "length" || m.type === "angle") ? "butt" : "round";
            ctx.lineJoin = m.type === "angle" ? "miter" : "round";

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

            } else if (m.type === "angle" && m.points?.length === 3) {
                const p0 = m.points[0];
                const p1 = m.points[1]; // Vertex
                const p2 = m.points[2];

                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();

                const v1 = { x: p0.x - p1.x, y: p0.y - p1.y };
                const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
                const d1 = Math.hypot(v1.x, v1.y);
                const d2 = Math.hypot(v2.x, v2.y);
                let angleDeg = 0;
                if (d1 > 1e-3 && d2 > 1e-3) {
                    const dot = v1.x * v2.x + v1.y * v2.y;
                    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (d1 * d2))));
                    angleDeg = angleRad * 180 / Math.PI;

                    // Draw dashed arc
                    const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x);
                    const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const r = Math.min(24, d1 * 0.6, d2 * 0.6);
                    let diff = a2 - a1;
                    while (diff < -Math.PI) diff += 2 * Math.PI;
                    while (diff > Math.PI) diff -= 2 * Math.PI;

                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(p1.x, p1.y, r, a1, a2, diff < 0);
                    ctx.stroke();
                    ctx.restore();
                }

                ctx.fillStyle = strokeColor;
                ctx.textAlign = "center";
                ctx.fillText(`${angleDeg.toFixed(1)}°`, p1.x, p1.y - 12 - textOffset);

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
        };

        draw();
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
