/**
 * PDF Export Service using pdf-lib to achieve 100% lossless vector PDF generation.
 * This service loads the original PDF bytes, copies pages vectorially,
 * and draws annotations (shapes, measurements, text) directly as vector elements.
 */
import { getCloudPath } from '../geometry/transforms';

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

            if (s.type === "rectangle" || s.type === "highlight") {
                page.drawRectangle({
                    x: s.x,
                    y: height - s.y - s.height,
                    width: s.width,
                    height: s.height,
                    borderColor: s.type === "highlight" ? undefined : border,
                    borderWidth: s.type === "highlight" ? 0 : thickness,
                    color: fill || undefined,
                    opacity: s.opacity ?? 1,
                    borderColorOpacity: s.type === "highlight" ? 0 : (s.opacity ?? 1),
                    ...dashStyle
                });
            } else if (s.type === "cloud") {
                const pathStr = getCloudPath(s.width, s.height);
                page.drawSvgPath(pathStr, {
                    x: s.x,
                    y: height - s.y - s.height,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: s.opacity ?? 1,
                    borderOpacity: s.opacity ?? 1,
                });
            } else if (s.type === "circle") {
                const cx = s.x + s.width / 2;
                const cy = s.y + s.height / 2;
                const rx = s.width / 2;
                const ry = s.height / 2;
                page.drawEllipse({
                    x: cx,
                    y: height - cy,
                    xScale: rx,
                    yScale: ry,
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

                if (s.type === "arrow") {
                    const dx = s.end.x - s.start.x;
                    const dy = s.end.y - s.start.y;
                    const dist = Math.hypot(dx, dy);
                    const sw = thickness;

                    if (dist > 1e-6) {
                        const ux = dx / dist;
                        const uy = dy / dist;
                        const px = -uy;
                        const py = ux;

                        const arrowTip = s.end;
                        const arrowC1 = {
                            x: s.end.x - 6 * sw * ux + 2 * sw * px,
                            y: s.end.y - 6 * sw * uy + 2 * sw * py
                        };
                        const arrowC2 = {
                            x: s.end.x - 6 * sw * ux - 2 * sw * px,
                            y: s.end.y - 6 * sw * uy - 2 * sw * py
                        };

                        // Shorten the line so it ends inside the arrowhead in PDF space
                        const pdfDx = endPt.x - startPt.x;
                        const pdfDy = endPt.y - startPt.y;
                        const pdfDist = Math.hypot(pdfDx, pdfDy);
                        const pdfUx = pdfDx / pdfDist;
                        const pdfUy = pdfDy / pdfDist;

                        const lineEndPt = {
                            x: endPt.x - 4 * sw * pdfUx,
                            y: endPt.y - 4 * sw * pdfUy
                        };

                        page.drawLine({
                            start: startPt,
                            end: lineEndPt,
                            color: border,
                            thickness: thickness,
                            opacity: s.opacity ?? 1,
                            ...dashStyle
                        });

                        const pathStr = `M ${arrowTip.x} ${arrowTip.y} L ${arrowC1.x} ${arrowC1.y} L ${arrowC2.x} ${arrowC2.y} Z`;
                        page.drawSvgPath(pathStr, {
                            x: 0,
                            y: height,
                            color: border,
                            opacity: s.opacity ?? 1,
                        });
                    } else {
                        page.drawLine({
                            start: startPt,
                            end: endPt,
                            color: border,
                            thickness: thickness,
                            opacity: s.opacity ?? 1,
                            ...dashStyle
                        });
                    }
                } else {
                    page.drawLine({
                        start: startPt,
                        end: endPt,
                        color: border,
                        thickness: thickness,
                        opacity: s.opacity ?? 1,
                        ...dashStyle
                    });
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
                const pathStr = `M ${s.points[0].x} ${s.points[0].y} ` +
                    s.points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') +
                    ' Z';
                page.drawSvgPath(pathStr, {
                    x: 0,
                    y: height,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: s.opacity ?? 1,
                    borderOpacity: s.opacity ?? 1,
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
                            m.type === "polylength" ? "#16a085" :
                                m.type === "count" ? "white" : "#333"
            );
            const fillColor = m.fill || (
                m.type === "area" ? "rgba(108, 176, 86, 0.25)" :
                    m.type === "count" ? "#e67e22" : "transparent"
            );

            const border = hexToRgb(strokeColor);
            const textCol = hexToRgb(m.textColor || strokeColor);
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
                    color: textCol,
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
                    color: textCol,
                });
            } else if (m.type === "polylength" && m.points?.length >= 2) {
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
                    color: textCol,
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

                const pathStr = `M ${m.points[0].x} ${m.points[0].y} ` +
                    m.points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') +
                    ' Z';
                page.drawSvgPath(pathStr, {
                    x: 0,
                    y: height,
                    borderColor: border,
                    borderWidth: thickness,
                    color: fill || undefined,
                    opacity: m.opacity ?? 0.8,
                    borderOpacity: m.opacity ?? 1,
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
            } else if (m.type === "count") {
                const pts = m.points || (m.point ? [m.point] : []);
                const scale = m.scale !== undefined ? m.scale : 1.0;
                const r = 8 * scale;
                const shapeType = m.shape || "circle";
                const fillColor = fill || hexToRgb("#e67e22");

                pts.forEach((p, idx) => {
                    const pdfY = height - p.y;
                    if (shapeType === "square") {
                        page.drawRectangle({
                            x: p.x - r,
                            y: pdfY - r,
                            width: r * 2,
                            height: r * 2,
                            color: fillColor,
                            borderColor: border,
                            borderWidth: thickness,
                        });
                    } else if (shapeType === "triangle") {
                        const pathStr = `M ${p.x} ${p.y - r * 1.1} L ${p.x - r} ${p.y + r * 0.9} L ${p.x + r} ${p.y + r * 0.9} Z`;
                        page.drawSvgPath(pathStr, {
                            x: 0,
                            y: height,
                            color: fillColor,
                            borderColor: border,
                            borderWidth: thickness,
                        });
                    } else if (shapeType === "diamond") {
                        const pathStr = `M ${p.x} ${p.y - r * 1.1} L ${p.x + r * 1.1} ${p.y} L ${p.x} ${p.y + r * 1.1} L ${p.x - r * 1.1} ${p.y} Z`;
                        page.drawSvgPath(pathStr, {
                            x: 0,
                            y: height,
                            color: fillColor,
                            borderColor: border,
                            borderWidth: thickness,
                        });
                    } else {
                        page.drawCircle({
                            x: p.x,
                            y: pdfY,
                            radius: r,
                            color: fillColor,
                            borderColor: border,
                            borderWidth: thickness,
                        });
                    }
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
                    const lines = m.text.split('\n');
                    const textAlignment = m.textAlign || 'left';
                    const textCol = hexToRgb(m.textColor || "#000000");

                    lines.forEach((lineText, lineIdx) => {
                        const textWidth = font.widthOfTextAtSize(lineText, fontSize);
                        let lineX = m.box.x + 6;
                        if (textAlignment === 'center') {
                            lineX = m.box.x + m.box.w / 2 - textWidth / 2;
                        } else if (textAlignment === 'right') {
                            lineX = m.box.x + m.box.w - 6 - textWidth;
                        }

                        const lineY = height - m.box.y - 4 - fontSize - (lineIdx * fontSize * 1.2);
                        // Ensure we don't draw outside the bottom of the box
                        if (lineY >= height - m.box.y - m.box.h) {
                            page.drawText(lineText, {
                                x: lineX,
                                y: lineY,
                                size: fontSize,
                                font: font,
                                color: textCol,
                            });
                        }
                    });
                }
            } else if (m.type === "callout" && m.box && m.tip) {
                const cx = m.box.x + m.box.w / 2;
                const cy = m.box.y + m.box.h / 2;
                let kx = m.knee ? m.knee.x : (cx + m.tip.x) / 2;
                let ky = m.knee ? m.knee.y : (cy + m.tip.y) / 2;

                const tipPt = toPdfPoint(m.tip);
                const kneePt = toPdfPoint({ x: kx, y: ky });

                const tipDx = tipPt.x - kneePt.x;
                const tipDy = tipPt.y - kneePt.y;
                const len = Math.hypot(tipDx, tipDy);
                const sw = thickness;
                const offset = 4 * sw;

                let lineEndPt = tipPt;
                if (len > offset) {
                    const t = (len - offset) / len;
                    lineEndPt = {
                        x: kneePt.x + tipDx * t,
                        y: kneePt.y + tipDy * t
                    };
                } else {
                    lineEndPt = kneePt;
                }

                // Draw Leader Lines
                page.drawLine({
                    start: kneePt,
                    end: lineEndPt,
                    color: border,
                    thickness: thickness,
                    ...dashStyle
                });
                page.drawLine({
                    start: kneePt,
                    end: toPdfPoint({ x: cx, y: cy }),
                    color: border,
                    thickness: thickness,
                    ...dashStyle
                });

                // Leader arrowhead
                const calloutTipDx = m.tip.x - kx;
                const calloutTipDy = m.tip.y - ky;
                const calloutLen = Math.hypot(calloutTipDx, calloutTipDy);
                if (calloutLen > 1e-6) {
                    const ux = calloutTipDx / calloutLen;
                    const uy = calloutTipDy / calloutLen;
                    const px = -uy;
                    const py = ux;

                    const arrowTip = m.tip;
                    const arrowC1 = {
                        x: m.tip.x - 8 * sw * ux + 3 * sw * px,
                        y: m.tip.y - 8 * sw * uy + 3 * sw * py
                    };
                    const arrowC2 = {
                        x: m.tip.x - 8 * sw * ux - 3 * sw * px,
                        y: m.tip.y - 8 * sw * uy - 3 * sw * py
                    };

                    const pathStr = `M ${arrowTip.x} ${arrowTip.y} L ${arrowC1.x} ${arrowC1.y} L ${arrowC2.x} ${arrowC2.y} Z`;
                    page.drawSvgPath(pathStr, {
                        x: 0,
                        y: height,
                        color: border,
                        opacity: m.opacity ?? 1,
                    });
                }

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
                    const lines = m.text.split('\n');
                    const textAlignment = m.textAlign || 'left';

                    lines.forEach((lineText, lineIdx) => {
                        const textWidth = font.widthOfTextAtSize(lineText, fontSize);
                        let lineX = m.box.x + 6;
                        if (textAlignment === 'center') {
                            lineX = m.box.x + m.box.w / 2 - textWidth / 2;
                        } else if (textAlignment === 'right') {
                            lineX = m.box.x + m.box.w - 6 - textWidth;
                        }

                        const lineY = height - m.box.y - 4 - fontSize - (lineIdx * fontSize * 1.2);
                        // Ensure we don't draw outside the bottom of the box
                        if (lineY >= height - m.box.y - m.box.h) {
                            page.drawText(lineText, {
                                x: lineX,
                                y: lineY,
                                size: fontSize,
                                font: font,
                                color: textCol,
                            });
                        }
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
