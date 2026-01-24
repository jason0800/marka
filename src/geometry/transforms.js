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

