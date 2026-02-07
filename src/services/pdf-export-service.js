import { jsPDF } from "jspdf";
import { renderPageToCanvas } from "./pdf-service";

/**
 * Export the current PDF document with all annotations flattened into the images.
 * @param {Object} pdfDocument - The PDFJS document proxy
 * @param {Array} shapes - List of all shape objects
 * @param {Array} measurements - List of all measurement objects
 * @param {Object} calibrationScales - Map of pageIndex -> scale
 * @param {string} fileName - Original filename
 * @param {Function} onProgress - Callback (percent) => void
 */
export const exportFlattenedPDF = async (
    pdfDocument,
    shapes,
    measurements,
    calibrationScales,
    fileName,
    onProgress
) => {
    if (!pdfDocument) throw new Error("No PDF loaded");

    const numPages = pdfDocument.numPages;
    const pdf = new jsPDF({
        orientation: "p",
        unit: "px",
        hotfixes: ["px_scaling"], // crucial for 1:1 pixel mapping
    });

    // Remove the default first page added by new jsPDF()
    pdf.deletePage(1);

    for (let i = 1; i <= numPages; i++) {
        if (onProgress) onProgress(Math.round(((i - 1) / numPages) * 100));

        const page = await pdfDocument.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // Render at 2x for quality

        // Create off-screen canvas
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Render PDF content
        await renderPageToCanvas(page, canvas, 2.0);

        const ctx = canvas.getContext("2d");

        // Scale context to match the 2x render
        ctx.save();
        ctx.scale(2.0, 2.0);

        // Filter items for this page
        // Note: shapes/measurements store 1-based pageIndex usually?
        // Let's verify store usage. PDFViewer uses 1-based. Store uses 1-based (currentPage).
        // Let's assume store items use 1-based 'pageIndex'.
        const pageShapes = shapes.filter((s) => s.pageIndex === i);
        const pageMeasurements = measurements.filter((m) => m.pageIndex === i);

        // Helpers for units
        const calibrationScale = calibrationScales[i] || 1.0;
        const toUnits = (pdfPoints) => pdfPoints / Math.max(1e-9, calibrationScale);
        const toUnits2 = (pdfPoints2) => pdfPoints2 / Math.max(1e-9, calibrationScale * calibrationScale);
        const unitLabel = "units";

        // Draw Shapes
        pageShapes.forEach((shape) => drawShape(ctx, shape));

        // Draw Measurements
        pageMeasurements.forEach((m) => drawMeasurement(ctx, m, toUnits, toUnits2, unitLabel));

        ctx.restore();

        // Add to PDF
        // jsPDF adds page with dimensions. 
        // We want the PDF page size to match the original PDF page size (at scale 1).
        const originalVp = page.getViewport({ scale: 1.0 });
        pdf.addPage(
            [originalVp.width, originalVp.height],
            originalVp.width > originalVp.height ? "l" : "p"
        );

        const imgData = canvas.toDataURL("image/jpeg", 0.8); // JPEG is faster/smaller for photos/scans
        pdf.addImage(imgData, "JPEG", 0, 0, originalVp.width, originalVp.height);

        // Cleanup to save memory
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
    }

    if (onProgress) onProgress(100);

    const outName = fileName.replace(/\.pdf$/i, "") + "_flattened.pdf";
    pdf.save(outName);
};

// --- Drawing Helpers (Ported/Adapted from OverlayCanvasLayer) ---

const applyStyle = (ctx, style) => {
    ctx.strokeStyle = style.stroke || "#000000";
    ctx.lineWidth = style.strokeWidth || 2;
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (style.strokeDasharray === "dashed") {
        ctx.setLineDash([10, 5]);
    } else if (style.strokeDasharray === "dotted") {
        ctx.setLineDash([2, 5]);
    } else {
        ctx.setLineDash([]);
    }

    // Fill? Most "shapes" here are outlines, but if we had fill:
    if (style.fill && style.fill !== "none") {
        ctx.fillStyle = style.fill;
    }
};

const drawShape = (ctx, shape) => {
    ctx.save();
    applyStyle(ctx, shape);

    // Arrow specific lineCap
    if (shape.type === 'arrow') ctx.lineCap = 'butt';

    const hasFill = shape.fill && shape.fill !== "none" && shape.fill !== "transparent";

    ctx.beginPath();

    if (shape.type === "rectangle") {
        if (shape.rotation) {
            // Rotated rect
            const cx = shape.x + shape.width / 2;
            const cy = shape.y + shape.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate((shape.rotation * Math.PI) / 180);
            ctx.translate(-cx, -cy);
            ctx.rect(shape.x, shape.y, shape.width, shape.height);
        } else {
            ctx.rect(shape.x, shape.y, shape.width, shape.height);
        }

        if (hasFill) ctx.fill();
        ctx.stroke();

    } else if (shape.type === "circle") {
        if (shape.rotation) {
            const cx = shape.x + shape.width / 2;
            const cy = shape.y + shape.height / 2;
            const rx = shape.width / 2;
            const ry = shape.height / 2;
            const rot = (shape.rotation * Math.PI) / 180;
            ctx.ellipse(cx, cy, rx, ry, rot, 0, 2 * Math.PI);
        } else {
            const cx = shape.x + shape.width / 2;
            const cy = shape.y + shape.height / 2;
            const rx = shape.width / 2;
            const ry = shape.height / 2;
            ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        }

        if (hasFill) ctx.fill();
        ctx.stroke();

    } else if (shape.type === "line") {
        ctx.moveTo(shape.start.x, shape.start.y);
        ctx.lineTo(shape.end.x, shape.end.y);
        ctx.stroke();

    } else if (shape.type === "arrow") {
        // Draw line with shortening
        const dx = shape.end.x - shape.start.x;
        const dy = shape.end.y - shape.start.y;
        const len = Math.hypot(dx, dy);
        const sw = ctx.lineWidth;
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
        ctx.stroke();

        // Draw Arrowhead
        drawArrowHead(ctx, shape, ctx.strokeStyle);
    }
    ctx.restore();
};

const drawArrowHead = (ctx, shape, color) => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const sw = ctx.lineWidth;
    const dx = shape.end.x - shape.start.x;
    const dy = shape.end.y - shape.start.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const tipOffset = 0;
    const baseOffset = -6 * sw;
    const halfWidth = 2 * sw;

    const tX = shape.end.x + tipOffset * cos;
    const tY = shape.end.y + tipOffset * sin;

    const bX = shape.end.x + baseOffset * cos;
    const bY = shape.end.y + baseOffset * sin;

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
};


const drawMeasurement = (ctx, m, toUnits, toUnits2, unitLabel) => {
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

    const strokeWidth = m.strokeWidth || 2;

    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Text settings
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 14px sans-serif";

    if (m.type === "length" && m.points?.length === 2) {
        const [a, b] = m.points;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        ctx.fillStyle = strokeColor;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;

        ctx.textBaseline = "bottom";
        const textOffset = 8;
        const label = m.text ? m.text : `${toUnits(dist).toFixed(2)} ${unitLabel}`;
        ctx.fillText(label, midX, midY - textOffset);

    } else if (m.type === "area" && m.points?.length >= 3) {
        let area = 0;
        const calculatePolygonArea = (points) => {
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                let j = (i + 1) % points.length;
                area += points[i].x * points[j].y;
                area -= points[j].x * points[i].y;
            }
            return Math.abs(area / 2);
        };
        area = calculatePolygonArea(m.points);

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
        ctx.textBaseline = "bottom";
        const textOffset = 8;
        const label = m.text ? m.text : `${toUnits2(area).toFixed(2)} ${unitLabel}²`;
        ctx.fillText(label, m.points[0].x, m.points[0].y - textOffset);

    } else if (m.type === "perimeter" && m.points?.length >= 2) {
        let len = 0;
        ctx.beginPath();
        m.points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else {
                ctx.lineTo(p.x, p.y);
                len += Math.hypot(p.x - m.points[i - 1].x, p.y - m.points[i - 1].y);
            }
        });
        ctx.stroke();

        ctx.fillStyle = strokeColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        const textOffset = 8;
        const label = m.text ? m.text : `${toUnits(len).toFixed(2)} ${unitLabel}`;
        ctx.fillText(label, m.points[0].x, m.points[0].y - textOffset);

    } else if (m.type === "count" && m.point) {
        const r = 8;
        ctx.beginPath();
        ctx.arc(m.point.x, m.point.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

    } else if (m.type === "text" && m.box) {
        ctx.save();
        ctx.fillStyle = "white";
        ctx.strokeStyle = m.stroke || "black";
        ctx.lineWidth = 1;

        ctx.fillRect(m.box.x, m.box.y, m.box.w, m.box.h);
        ctx.strokeRect(m.box.x, m.box.y, m.box.w, m.box.h);

        ctx.fillStyle = "black";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const pad = 4;
        if (m.text) {
            wrapText(ctx, m.text, m.box.x + pad, m.box.y + pad, m.box.w - pad * 2, 18);
        }
        ctx.restore();

    } else if (m.type === "callout" && m.box && m.tip) {
        let kx, ky;
        if (m.knee) {
            kx = m.knee.x;
            ky = m.knee.y;
        } else {
            kx = (m.box.x + m.box.w / 2 + m.tip.x) / 2;
            ky = (m.box.y + m.box.h / 2 + m.tip.y) / 2;
        }

        const cx = m.box.x + m.box.w / 2;
        const cy = m.box.y + m.box.h / 2;

        ctx.beginPath();
        ctx.moveTo(m.tip.x, m.tip.y);
        ctx.lineTo(kx, ky);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(m.tip.x, m.tip.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();

        ctx.save();
        ctx.fillStyle = "white";
        ctx.strokeStyle = strokeColor; // Use measurement color for border?
        ctx.lineWidth = 1;
        ctx.fillRect(m.box.x, m.box.y, m.box.w, m.box.h);
        ctx.strokeRect(m.box.x, m.box.y, m.box.w, m.box.h);

        ctx.fillStyle = "black";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = "14px sans-serif";
        if (m.text) {
            wrapText(ctx, m.text, m.box.x + 4, m.box.y + 4, m.box.w - 8, 18);
        }
        ctx.restore();
    }

    ctx.restore();
};

const wrapText = (ctx, text, x, y, maxWidth, lineHeight) => {
    const words = text.split(' ');
    let line = '';
    let startY = y;

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, x, y);
};
