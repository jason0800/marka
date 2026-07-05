/**
 * Converts screen coordinates (clientX, clientY) to PDF Page coordinates (points)
 * relative to the SVG overlay element.
 */
export const getPagePoint = (e, svgElement) => {
    const rect = svgElement.getBoundingClientRect();
    // svgElement.width.baseVal.value gives the SVG coordinate width
    const svgWidth = svgElement.width.baseVal.value;
    const svgHeight = svgElement.height.baseVal.value;

    // Calculate scale factor between screen pixels and SVG units
    // rect.width is the rendered size on screen (affected by zoom)
    const scaleX = svgWidth / rect.width;
    const scaleY = svgHeight / rect.height;

    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
};

/**
 * Calculates Euclidean distance between two points.
 * Optionally applies a scale factor (e.g. m per pixel).
 */
export const calculateDistance = (p1, p2) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
};

export const screenDistanceToReal = (pixels, scale) => {
    return pixels * scale;
};

export const calculatePolygonArea = (points) => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
};

export const getCloudPath = (w, h, targetArcSize = 16) => {
    if (w <= 0 || h <= 0) return "M 0 0 Z";

    let path = "M 0 0";

    const addSegment = (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return;
        const numArcs = Math.max(1, Math.round(dist / targetArcSize));

        let xLast = x1;
        let yLast = y1;
        for (let i = 1; i <= numArcs; i++) {
            const tx = x1 + (dx * i) / numArcs;
            const ty = y1 + (dy * i) / numArcs;

            const dx_seg = tx - xLast;
            const dy_seg = ty - yLast;
            const mx = (xLast + tx) / 2;
            const my = (yLast + ty) / 2;

            // Outwards normal control point
            const cpx = mx + dy_seg * 0.45;
            const cpy = my - dx_seg * 0.45;

            path += ` Q ${cpx.toFixed(2)} ${cpy.toFixed(2)}, ${tx.toFixed(2)} ${ty.toFixed(2)}`;
            xLast = tx;
            yLast = ty;
        }
    };

    addSegment(0, 0, w, 0);
    addSegment(w, 0, w, h);
    addSegment(w, h, 0, h);
    addSegment(0, h, 0, 0);

    path += " Z";
    return path;
};

export const drawCloudPath = (ctx, w, h, targetArcSize = 16) => {
    if (w <= 0 || h <= 0) return;

    ctx.moveTo(0, 0);

    const addSegment = (x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return;
        const numArcs = Math.max(1, Math.round(dist / targetArcSize));

        let xLast = x1;
        let yLast = y1;
        for (let i = 1; i <= numArcs; i++) {
            const tx = x1 + (dx * i) / numArcs;
            const ty = y1 + (dy * i) / numArcs;

            const dx_seg = tx - xLast;
            const dy_seg = ty - yLast;
            const mx = (xLast + tx) / 2;
            const my = (yLast + ty) / 2;

            const cpx = mx + dy_seg * 0.45;
            const cpy = my - dx_seg * 0.45;

            ctx.quadraticCurveTo(cpx, cpy, tx, ty);
            xLast = tx;
            yLast = ty;
        }
    };

    addSegment(0, 0, w, 0);
    addSegment(w, 0, w, h);
    addSegment(w, h, 0, h);
    addSegment(0, h, 0, 0);
};

