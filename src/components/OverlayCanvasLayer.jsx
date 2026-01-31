import { useRef, useEffect } from "react";
import { calculateDistance, calculatePolygonArea } from "../geometry/transforms";

const OverlayCanvasLayer = ({
    width,
    height,
    viewScale = 1.0,
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

        // Handle High DPI
        const dpr = window.devicePixelRatio || 1;

        // Resize canvas if needed
        const targetW = Math.floor(width * dpr);
        const targetH = Math.floor(height * dpr);

        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        const ctx = canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // --- Render Helpers ---

        // Scale stroke width inversely to viewScale to keep it visually constant (non-scaling-stroke approximation)
        // In Canvas, we just set lineWidth. 
        // If viewScale is 2, and we want 1px visual, we need 0.5px in PDF space? 
        // No, the canvas is covering the PDF coordinate space (width/height are PDF points).
        // Wait, 'width' and 'height' passed from PDFPage are CSS pixels which match PDF points at scale=1.
        // Actually PDFPage passes: width={width} height={height} where these are viewport sized (scaled by `scale`).
        // AND it passes viewScale which is `scale * renderScale`.

        // Let's recheck PDFPage:
        // width = cssViewport.width (which is page.viewPort({scale}).width).
        // So width/height ARE ALREADY SCALED by `scale`.

        // BUT OverlayLayer typically assumes coordinates are in UN-SCALED PDF Points?
        // Let's check OverlayLayer.jsx again.
        // const unscaledViewport = page.getViewport({ scale: 1.0 });
        // const viewBox = `0 0 ...`
        // It renders shapes at `s.x`, `s.y` (PDF coordinates).
        // AND it sets SVG viewBox to match PDF coordinates.
        // BUT the <svg> element size is `width` x `height` (screen pixels).
        // So SVG automatically scales everything.

        // FOR CANVAS:
        // We have a canvas of size `width` x `height` (Screen Pixels).
        // We need to transform our context so that drawing at (PDF X, PDF Y) results in correct Screen X, Screen Y.
        // The scale factor is `width / unscaledPDFWidth`.
        // Or simply `viewScale` passed in? 
        // PDFPage passes `viewScale = scale * renderScale`.
        // Let's just trust `width` / `page.getViewport({scale:1}).width`.

        // HOWEVER, `OverlayLayer` logic:
        // nonScalingStroke = 2 / viewScale.
        // renderShape -> transform `translate(s.x, s.y) ...`

        // So YES, the shapes are stored in PDF coordinates.
        // We need to scale the context to map PDF coords -> Screen coords.

        const scaleX = width / (canvas.width / dpr); // This is 1 if we sized correctly?
        // No, we need the scale factor relative to the shape coordinates.

        // We need to know the UN SCALED size to derive the scale factor.
        // But we don't have the unscaled viewport here easily unless we pass it or calc it.
        // BUT we have `viewScale` prop passed from PDFPage.
        // PDFPage: viewScale={scale * renderScale}
        // This `viewScale` is roughly the zoom level.

        // Let's try using `viewScale` to scale the context.
        // ctx.scale(viewScale, viewScale);

        ctx.save();
        ctx.scale(viewScale, viewScale);

        const nonScalingLineWidth = 2 / Math.max(1e-6, viewScale);
        const textFontSize = 14 / Math.max(1e-6, viewScale);
        const textOffset = 8 / Math.max(1e-6, viewScale);

        // --- Shapes ---
        shapes.forEach(shape => {
            if (selectedIds.includes(shape.id)) return; // Don't render selected (SVG handles that)

            ctx.save();

            // Common styles
            ctx.strokeStyle = shape.stroke || "#000";
            ctx.lineWidth = (shape.strokeWidth || 2) / viewScale; // Scale width? 
            // In SVG: strokeWidth={s.strokeWidth} but vectorEffect="non-scaling-stroke" ? No, some don't have it.
            // Check OverlayLayer:
            // renderShape -> strokeWidth: s.strokeWidth. 
            // It does NOT use non-scaling-stroke for shapes usually, only for handles/selection.
            // Wait, standard user shapes usually scale with zoom? 
            // Text/Annotations often don't.
            // Let's check `OverlayLayer` lines 580: `strokeWidth: s.strokeWidth`. NO vector-effect.
            // So for shapes, width SCALES with vector. 
            // IE: A 2px line at 10x zoom looks like 20px on screen.
            // SO we do NOT divide by viewScale for `shape.strokeWidth`.
            ctx.lineWidth = shape.strokeWidth || 2;

            ctx.fillStyle = shape.fill === "none" ? "transparent" : shape.fill;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.globalAlpha = shape.opacity ?? 1;

            if (shape.strokeDasharray && shape.strokeDasharray !== "none") {
                const dashes = shape.strokeDasharray.split(",").map(Number);
                ctx.setLineDash(dashes);
            }

            if (shape.type === "line" || shape.type === "arrow") {
                ctx.beginPath();
                ctx.moveTo(shape.start.x, shape.start.y);
                ctx.lineTo(shape.end.x, shape.end.y);
                ctx.stroke();

                if (shape.type === "arrow") {
                    // Draw Arrowhead manually
                    // Calculate angle
                    const dx = shape.end.x - shape.start.x;
                    const dy = shape.end.y - shape.start.y;
                    const angle = Math.atan2(dy, dx);

                    const headLen = 10; // length of head in PDF points
                    ctx.beginPath();
                    ctx.moveTo(shape.end.x, shape.end.y);
                    ctx.lineTo(
                        shape.end.x - headLen * Math.cos(angle - Math.PI / 6),
                        shape.end.y - headLen * Math.sin(angle - Math.PI / 6)
                    );
                    ctx.lineTo(
                        shape.end.x - headLen * Math.cos(angle + Math.PI / 6),
                        shape.end.y - headLen * Math.sin(angle + Math.PI / 6)
                    );
                    ctx.closePath();
                    ctx.fillStyle = shape.stroke;
                    ctx.fill();
                }
            } else if (shape.type === "rectangle") {
                if (shape.rotation) {
                    // Translate to center, rotate, translate back
                    const cx = shape.x + shape.width / 2;
                    const cy = shape.y + shape.height / 2;
                    ctx.translate(cx, cy);
                    ctx.rotate((shape.rotation * Math.PI) / 180);
                    ctx.translate(-cx, -cy);
                }

                if (shape.fill !== "none") {
                    ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                }
                ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
            } else if (shape.type === "circle") {
                // Ellipse
                if (shape.rotation) {
                    const cx = shape.x + shape.width / 2;
                    const cy = shape.y + shape.height / 2;
                    ctx.translate(cx, cy);
                    ctx.rotate((shape.rotation * Math.PI) / 180);
                    ctx.translate(-cx, -cy);
                }
                ctx.beginPath();
                // rx, ry, rotation, startAngle, endAngle
                ctx.ellipse(
                    shape.x + shape.width / 2,
                    shape.y + shape.height / 2,
                    shape.width / 2,
                    shape.height / 2,
                    0, 0, 2 * Math.PI
                );
                if (shape.fill !== "none") ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
        });

        // --- Measurements ---
        measurements.forEach(m => {
            if (selectedIds.includes(m.id)) return;

            ctx.save();
            // Measurements DO use non-scaling strokes often (fixed pixel size on screen)
            // Checked OverlayLayer: strokeWidth={nonScalingStroke} (which is 2 / viewScale)
            // So for measurements, we DO divide by viewScale.

            ctx.font = `${textFontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";

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

                // Draw text
                ctx.fillText(`${toUnits(dist).toFixed(2)} ${unit}`, midX, midY - textOffset);

            } else if (m.type === "area" && m.points?.length >= 3) {
                const area = calculatePolygonArea(m.points);

                ctx.fillStyle = "rgba(108, 176, 86, 0.25)";
                ctx.strokeStyle = "var(--primary-color)"; // Need computed color? fallback to green
                // Canvas can't use var(). Use explicit color or resolve it.
                // Assuming primary color is roughly #4a90e2 or similar. Let's use a standard green for area match.
                // Or just hardcode based on app theme.
                ctx.strokeStyle = "#2ecc71"; // consistent green
                ctx.lineWidth = nonScalingLineWidth;

                ctx.beginPath();
                m.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Text at p[0]
                ctx.fillStyle = "#2ecc71";
                ctx.textAlign = "left"; // OverlayLayer uses default? No, x=p[0].x. 
                // Let's stick to left align effectively at point 0.
                ctx.fillText(`${toUnits2(area).toFixed(2)} ${unit}²`, m.points[0].x, m.points[0].y - textOffset);

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
            } else if (m.type === "count" && m.point) {
                ctx.fillStyle = "#e67e22"; // orange
                ctx.strokeStyle = "white";
                ctx.lineWidth = nonScalingLineWidth;

                const r = 8 / viewScale; // Fixed size radius

                ctx.beginPath();
                ctx.arc(m.point.x, m.point.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else if (m.type === "comment" && m.tip && m.box) {
                // Should render line + dot + box background?
                // OverlayLayer renders foreignObject for textarea.
                // Since this is "read only" / unselected, we should render the static text logic.
                // But OverlayLayer uses textarea inside foreignObject always? 
                // "isEditing" controls if it is focused.
                // If it is NOT selected, we should render the text on canvas?
                // Canvas text wrapping is hard.
                // Strategy: Keep Comments in SVG for now? They correspond to text.
                // Or render line+dot on Canvas, text box in SVG?
                // Let's keep comments fully in SVG for now to avoid complex text rendering on canvas.
                // Check OverlayLayer logic: it always renders.
                // We'll skip rendering comments here in canvas? Or render line+dot at least.

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

                // For the box content: If we want to optimize, we should render text here.
                // BUT simple approach: Skip text rendering in canvas, let OverlayLayer render it? 
                // If OverlayLayer renders it, we duplicate lines.
                // Better: Render static "Preview" text if posssible.
                // For now: Let's assume Comments are few compared to Lines. 
                // We will NOT render the box content here, but maybe we should filter it out in OverlayLayer?
                // Actually, if we want strict layer separation:
                // Canvas = Static graphics.
                // SVG = Interactive + Complex (Text).
                // So let's leave Comments handled by SVG entirely for now to prevent text issues.
            }

            ctx.restore();
        });

        ctx.restore();

    }, [width, height, viewScale, shapes, measurements, selectedIds, pageIndex, calibrationScales, pageUnits]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: width,
                height: height,
                pointerEvents: "none", // Let clicks pass through to SVG (for manual hit test) or container
                zIndex: 0,
            }}
        />
    );
};

export default OverlayCanvasLayer;
