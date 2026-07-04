/**
 * PDF Export Service using pdf-lib to achieve 100% lossless vector PDF generation.
 * This service loads the original PDF bytes, copies pages vectorially,
 * and draws annotations (shapes, measurements, text) directly as vector elements.
 */

export const exportFlattenedPDF = async (
    pdfDocument,
    shapes,
    measurements,
    calibrationScales,
    fileName,
    onProgress,
    sheets
) => {
    // 1. Dynamically import pdf-lib from unpkg CDN
    let PDFLib = window.PDFLib;
    if (!PDFLib) {
        PDFLib = await import("https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.esm.js");
    }
    const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;

    // 2. Fetch the original PDF array buffer from the Zustand store
    const useAppStore = (await import('../stores/useAppStore')).default;
    const { pdfBytes, pageRotations } = useAppStore.getState();

    // 3. Create a new export PDF document
    const exportDoc = await PDFDocument.create();

    // Load source document if original bytes are available
    let srcDoc = null;
    if (pdfBytes) {
        srcDoc = await PDFDocument.load(pdfBytes);
    }

    const numPages = sheets.length;
    const font = await exportDoc.embedFont(StandardFonts.Helvetica);

    // Helpers for hex -> RGB conversion
    const hexToRgb = (hexStr, defaultColor = rgb(0, 0, 0)) => {
        if (!hexStr) return defaultColor;
        const clean = hexStr.replace('#', '');
        if (clean.length === 3) {
            const r = parseInt(clean[0] + clean[0], 16) / 255;
            const g = parseInt(clean[1] + clean[1], 16) / 255;
            const b = parseInt(clean[2] + clean[2], 16) / 255;
            return rgb(r, g, b);
        }
        if (clean.length === 6) {
            const r = parseInt(clean.substring(0, 2), 16) / 255;
            const g = parseInt(clean.substring(2, 4), 16) / 255;
            const b = parseInt(clean.substring(4, 6), 16) / 255;
            return rgb(r, g, b);
        }
        return defaultColor;
    };

    // Helpers for dash styling
    const getDashStyle = (dashType) => {
        if (dashType === "dashed") return { dashArray: [12, 12] };
        if (dashType === "dotted") return { dashArray: [2, 8] };
        return {};
    };

    // 4. Page Reconstruction Loop
    for (let i = 1; i <= numPages; i++) {
        if (onProgress) onProgress(Math.round(((i - 1) / numPages) * 100));

        const sheet = sheets[i - 1];
        let page;
        let width = 800;
        let height = 1100;

        if (sheet.type === 'blank') {
            width = sheet.width || 800;
            height = sheet.height || 1100;
            page = exportDoc.addPage([width, height]);
        } else if (srcDoc) {
            const originalIndex = sheet.pdfPageNumber - 1;
            const [copiedPage] = await exportDoc.copyPages(srcDoc, [originalIndex]);
            page = exportDoc.addPage(copiedPage);
            width = page.getWidth();
            height = page.getHeight();
        } else {
            width = sheet.width || 800;
            height = sheet.height || 1100;
            page = exportDoc.addPage([width, height]);
        }

        // Apply page rotations from app store state
        const rot = pageRotations[sheet.pdfPageNumber || i] || 0;
        if (rot) {
            page.setRotation(degrees(rot));
        }

        // Coordinate converter (top-left SVG coords -> bottom-left PDF coords)
        const toPdfPoint = (p) => ({
            x: p.x,
            y: height - p.y
        });

        // Filter annotations for this page
        const pageShapes = shapes.filter((s) => s.pageIndex === i);
        const pageMeasurements = measurements.filter((m) => m.pageIndex === i);

        // 5. Draw Shapes Vectorially
        pageShapes.forEach((s) => {
            const border = hexToRgb(s.stroke, rgb(0, 0, 0));
            const fill = s.fill && s.fill !== "none" && s.fill !== "transparent" ? hexToRgb(s.fill) : null;
            const thickness = s.strokeWidth || 2;
            const dashStyle = getDashStyle(s.strokeDasharray);

            if (s.type === "rectangle") {
                page.drawRectangle({
                    x: s.x,
                    y: height - s.y - s.height,
                    width: s.width,
                    height: s.height,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: s.opacity ?? 1,
                    borderColorOpacity: s.opacity ?? 1,
                    ...dashStyle
                });
            } else if (s.type === "circle") {
                const cx = s.cx || (s.x + s.width / 2);
                const cy = s.cy || (s.y + s.height / 2);
                const rx = s.rx || (s.width / 2) || 10;
                page.drawEllipse({
                    x: cx,
                    y: height - cy,
                    xRadius: rx,
                    yRadius: rx,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: s.opacity ?? 1,
                    borderColorOpacity: s.opacity ?? 1,
                    ...dashStyle
                });
            } else if (s.type === "line" || s.type === "arrow") {
                const startPt = toPdfPoint(s.start);
                const endPt = toPdfPoint(s.end);
                page.drawLine({
                    start: startPt,
                    end: endPt,
                    color: border,
                    thickness: thickness,
                    opacity: s.opacity ?? 1,
                    ...dashStyle
                });

                if (s.type === "arrow") {
                    const angle = Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x);
                    const headLength = 12;
                    const headAngle = Math.PI / 6;
                    const h1x = endPt.x - headLength * Math.cos(angle - headAngle);
                    const h1y = endPt.y - headLength * Math.sin(angle - headAngle);
                    const h2x = endPt.x - headLength * Math.cos(angle + headAngle);
                    const h2y = endPt.y - headLength * Math.sin(angle + headAngle);

                    // Draw arrowhead paths
                    page.drawLine({ start: endPt, end: { x: h1x, y: h1y }, color: border, thickness: thickness });
                    page.drawLine({ start: endPt, end: { x: h2x, y: h2y }, color: border, thickness: thickness });
                }
            } else if (s.type === "polyline" && s.points?.length >= 2) {
                for (let j = 0; j < s.points.length - 1; j++) {
                    page.drawLine({
                        start: toPdfPoint(s.points[j]),
                        end: toPdfPoint(s.points[j + 1]),
                        color: border,
                        thickness: thickness,
                        opacity: s.opacity ?? 1,
                        ...dashStyle
                    });
                }
            } else if (s.type === "polygon" && s.points?.length >= 3) {
                const pdfPts = s.points.map(p => [p.x, height - p.y]);
                page.drawPolygon({
                    coordinates: pdfPts,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: s.opacity ?? 1,
                    borderColorOpacity: s.opacity ?? 1,
                });
            }
        });

        // 6. Draw Measurements Vectorially
        const calibrationScale = calibrationScales[i - 1] || 1.0;
        const toUnits = (pdfPoints) => pdfPoints / Math.max(1e-9, calibrationScale);
        const toUnits2 = (pdfPoints2) => pdfPoints2 / Math.max(1e-9, calibrationScale * calibrationScale);
        const unitLabel = "units";

        pageMeasurements.forEach((m) => {
            const strokeColor = m.stroke || (
                m.type === "length" ? "#e74c3c" :
                    m.type === "area" ? "#2ecc71" :
                        m.type === "perimeter" ? "#9b59b6" :
                            m.type === "count" ? "white" : "#333"
            );
            const fillColor = m.fill || (
                m.type === "area" ? "rgba(108, 176, 86, 0.25)" :
                    m.type === "count" ? "#e67e22" : "transparent"
            );

            const border = hexToRgb(strokeColor);
            const fill = fillColor !== "transparent" && fillColor !== "none" ? hexToRgb(fillColor) : null;
            const thickness = m.strokeWidth || 2;
            const dashStyle = getDashStyle(m.strokeDasharray);

            // Draw underlying vector geometry
            if (m.type === "length" && m.points?.length === 2) {
                const startPt = toPdfPoint(m.points[0]);
                const endPt = toPdfPoint(m.points[1]);
                page.drawLine({
                    start: startPt,
                    end: endPt,
                    color: border,
                    thickness: thickness,
                    opacity: m.opacity ?? 1,
                    ...dashStyle
                });

                // Calculate distance label text
                const dx = m.points[1].x - m.points[0].x;
                const dy = m.points[1].y - m.points[0].y;
                const dist = Math.hypot(dx, dy);
                const label = m.text ? m.text : `${toUnits(dist).toFixed(2)} ${unitLabel}`;

                // Render label
                const refX = (m.points[0].x + m.points[1].x) / 2;
                const refY = (m.points[0].y + m.points[1].y) / 2 - 6;
                const tOffset = m.textOffset || { x: 0, y: 0 };
                const labelX = refX + tOffset.x;
                const labelY = height - (refY + tOffset.y);

                const fontSize = 11;
                const textWidth = font.widthOfTextAtSize(label, fontSize);
                page.drawText(label, {
                    x: labelX - textWidth / 2,
                    y: labelY,
                    size: fontSize,
                    font: font,
                    color: border,
                });
            } else if (m.type === "perimeter" && m.points?.length >= 2) {
                let len = 0;
                for (let j = 0; j < m.points.length - 1; j++) {
                    const p1 = m.points[j];
                    const p2 = m.points[j + 1];
                    len += Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    page.drawLine({
                        start: toPdfPoint(p1),
                        end: toPdfPoint(p2),
                        color: border,
                        thickness: thickness,
                        opacity: m.opacity ?? 1,
                        ...dashStyle
                    });
                }
                const label = m.text ? m.text : `${toUnits(len).toFixed(2)} ${unitLabel}`;
                const refX = m.points[0].x;
                const refY = m.points[0].y - 8;
                const tOffset = m.textOffset || { x: 0, y: 0 };
                const labelX = refX + tOffset.x;
                const labelY = height - (refY + tOffset.y);

                const fontSize = 11;
                page.drawText(label, {
                    x: labelX,
                    y: labelY,
                    size: fontSize,
                    font: font,
                    color: hexToRgb("#9b59b6"),
                });
            } else if (m.type === "area" && m.points?.length >= 3) {
                let area = 0;
                const ptsCount = m.points.length;
                for (let j = 0; j < ptsCount; j++) {
                    let k = (j + 1) % ptsCount;
                    area += m.points[j].x * m.points[k].y;
                    area -= m.points[k].x * m.points[j].y;
                }
                area = Math.abs(area / 2);

                const pdfPts = m.points.map(p => [p.x, height - p.y]);
                page.drawPolygon({
                    coordinates: pdfPts,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: m.opacity ?? 0.8,
                    borderColorOpacity: m.opacity ?? 1,
                });

                const label = m.text ? m.text : `${toUnits2(area).toFixed(2)} ${unitLabel}²`;
                const refX = m.points[0].x;
                const refY = m.points[0].y - 8;
                const tOffset = m.textOffset || { x: 0, y: 0 };
                const labelX = refX + tOffset.x;
                const labelY = height - (refY + tOffset.y);

                const fontSize = 11;
                page.drawText(label, {
                    x: labelX,
                    y: labelY,
                    size: fontSize,
                    font: font,
                    color: border,
                });
            } else if (m.type === "angle" && m.points?.length === 3) {
                const p0 = m.points[0];
                const p1 = m.points[1]; // Vertex
                const p2 = m.points[2];

                page.drawLine({ start: toPdfPoint(p0), end: toPdfPoint(p1), color: border, thickness: thickness });
                page.drawLine({ start: toPdfPoint(p1), end: toPdfPoint(p2), color: border, thickness: thickness });

                // Calculate angle
                const v1 = { x: p0.x - p1.x, y: p0.y - p1.y };
                const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
                const d1 = Math.hypot(v1.x, v1.y);
                const d2 = Math.hypot(v2.x, v2.y);
                let angleDeg = 0;
                if (d1 > 1e-3 && d2 > 1e-3) {
                    const dot = v1.x * v2.x + v1.y * v2.y;
                    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (d1 * d2))));
                    angleDeg = angleRad * (180 / Math.PI);
                }

                const label = m.text ? m.text : `${angleDeg.toFixed(1)}°`;
                const refX = p1.x;
                const refY = p1.y - 12 - 7;
                const tOffset = m.textOffset || { x: 0, y: 0 };
                const labelX = refX + tOffset.x;
                const labelY = height - (refY + tOffset.y);

                const fontSize = 11;
                const textWidth = font.widthOfTextAtSize(label, fontSize);
                page.drawText(label, {
                    x: labelX - textWidth / 2,
                    y: labelY,
                    size: fontSize,
                    font: font,
                    color: border,
                });
            } else if (m.type === "count" && m.point) {
                const r = 8;
                page.drawCircle({
                    x: m.point.x,
                    y: height - m.point.y,
                    radius: r,
                    color: fill || hexToRgb("#e67e22"),
                    borderColor: border,
                    borderWidth: thickness,
                });
            } else if (m.type === "text" && m.box) {
                // Background filled box
                page.drawRectangle({
                    x: m.box.x,
                    y: height - m.box.y - m.box.h,
                    width: m.box.w,
                    height: m.box.h,
                    color: rgb(1, 1, 1),
                    borderColor: hexToRgb(m.stroke || "#000000"),
                    borderWidth: 1,
                });

                if (m.text) {
                    const fontSize = m.fontSize || 12;
                    page.drawText(m.text, {
                        x: m.box.x + 6,
                        y: height - (m.box.y + m.box.h / 2 + fontSize / 3),
                        size: fontSize,
                        font: font,
                        color: rgb(0, 0, 0),
                    });
                }
            } else if (m.type === "callout" && m.box && m.tip) {
                const cx = m.box.x + m.box.w / 2;
                const cy = m.box.y + m.box.h / 2;
                let kx = m.knee ? m.knee.x : (cx + m.tip.x) / 2;
                let ky = m.knee ? m.knee.y : (cy + m.tip.y) / 2;

                // Draw Leader Lines
                page.drawLine({
                    start: toPdfPoint(m.tip),
                    end: toPdfPoint({ x: kx, y: ky }),
                    color: border,
                    thickness: thickness,
                    ...dashStyle
                });
                page.drawLine({
                    start: toPdfPoint({ x: kx, y: ky }),
                    end: toPdfPoint({ x: cx, y: cy }),
                    color: border,
                    thickness: thickness,
                    ...dashStyle
                });

                // Leader arrowhead
                const angle = Math.atan2(ky - m.tip.y, kx - m.tip.x);
                const headLength = 10;
                const headAngle = Math.PI / 6;
                const h1x = m.tip.x + headLength * Math.cos(angle - headAngle);
                const h1y = m.tip.y + headLength * Math.sin(angle - headAngle);
                const h2x = m.tip.x + headLength * Math.cos(angle + headAngle);
                const h2y = m.tip.y + headLength * Math.sin(angle + headAngle);

                page.drawLine({ start: toPdfPoint(m.tip), end: toPdfPoint({ x: h1x, y: h1y }), color: border, thickness: thickness });
                page.drawLine({ start: toPdfPoint(m.tip), end: toPdfPoint({ x: h2x, y: h2y }), color: border, thickness: thickness });

                // Callout Box
                const boxBg = m.fill && m.fill !== 'none' ? hexToRgb(m.fill) : rgb(1, 1, 1);
                page.drawRectangle({
                    x: m.box.x,
                    y: height - m.box.y - m.box.h,
                    width: m.box.w,
                    height: m.box.h,
                    borderColor: border,
                    borderWidth: thickness,
                    color: boxBg,
                });

                // Callout text
                if (m.text) {
                    const fontSize = m.fontSize || 12;
                    page.drawText(m.text, {
                        x: m.box.x + 6,
                        y: height - (m.box.y + m.box.h / 2 + fontSize / 3),
                        size: fontSize,
                        font: font,
                        color: rgb(0, 0, 0),
                    });
                }
            }
        });
    }

    if (onProgress) onProgress(100);

    // Save and download binary vector PDF
    const pdfBytesOut = await exportDoc.save();
    const blob = new Blob([pdfBytesOut], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName.replace(/\.pdf$/i, "") + "_flattened.pdf";
    link.click();
    URL.revokeObjectURL(link.href);
};
