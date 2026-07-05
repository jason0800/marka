import { calculateDistance } from "./transforms";

/**
 * Calculates the distance from point P to line segment AB.
 */
export const distanceToSegment = (p, a, b) => {
    const l2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    if (l2 === 0) return calculateDistance(p, a);

    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));

    const proj = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
    };
    return calculateDistance(p, proj);
};

/**
 * Rotates a point around a center by an angle (degrees).
 */
export const rotatePoint = (point, center, angleDeg) => {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = point.x - center.x;
    const dy = point.y - center.y;

    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
    };
};

/**
 * Checks if a point hits a shape with a given tolerance.
 */
export const isPointInShape = (point, shape, tolerance = 5) => {
    if (!shape) return false;

    // 1. Line / Arrow
    if (shape.type === "line" || shape.type === "arrow") {
        const dist = distanceToSegment(point, shape.start, shape.end);
        // "Fat" hit area logic for easier selection
        return dist <= Math.max(tolerance, (shape.strokeWidth || 2) / 2 + 5);
    }

    // Polyline
    if (shape.type === "polyline" && shape.points?.length >= 2) {
        for (let i = 0; i < shape.points.length - 1; i++) {
            const dist = distanceToSegment(point, shape.points[i], shape.points[i + 1]);
            if (dist <= Math.max(tolerance, (shape.strokeWidth || 2) / 2 + 5)) return true;
        }
        return false;
    }

    // Polygon (closed path — hit segments + optional fill interior)
    if (shape.type === "polygon" && shape.points?.length >= 3) {
        const pts = shape.points;
        const hasFill = shape.fill && shape.fill !== "none" && shape.fill !== "transparent";
        // Segment hit
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const dist = distanceToSegment(point, a, b);
            if (dist <= Math.max(tolerance, (shape.strokeWidth || 2) / 2 + 5)) return true;
        }
        // Interior hit (ray-casting)
        if (hasFill) {
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const xi = pts[i].x, yi = pts[i].y;
                const xj = pts[j].x, yj = pts[j].y;
                const intersect = ((yi > point.y) !== (yj > point.y)) &&
                    (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }
        return false;
    }

    // 2. Rectangle / Circle (assume usage of x, y, width, height)
    const { x, y, width, height, rotation = 0 } = shape;

    // Normalize point to the shape's unrotated local space
    const center = { x: x + width / 2, y: y + height / 2 };
    // Rotate point OPPOSITE to shape rotation to check AABB
    const localP = rotation !== 0 ? rotatePoint(point, center, -rotation) : point;

    // Check bounds in local unrotated space
    // Using a slightly loose hit test (stroke width included?) - keep it simple for now
    const halfStroke = (shape.strokeWidth || 0) / 2;
    const t = tolerance + halfStroke;
    const hasFill = shape.fill && shape.fill !== "none" && shape.fill !== "transparent";

    if (shape.type === "rectangle" || shape.type === "highlight" || shape.type === "cloud") {
        if (hasFill) {
            return (
                localP.x >= x - t &&
                localP.x <= x + width + t &&
                localP.y >= y - t &&
                localP.y <= y + height + t
            );
        } else {
            // Outlined shape: check distance to 4 segments (top, bottom, left, right)
            const nearLeft = Math.abs(localP.x - x) <= t && localP.y >= y - t && localP.y <= y + height + t;
            const nearRight = Math.abs(localP.x - (x + width)) <= t && localP.y >= y - t && localP.y <= y + height + t;
            const nearTop = Math.abs(localP.y - y) <= t && localP.x >= x - t && localP.x <= x + width + t;
            const nearBottom = Math.abs(localP.y - (y + height)) <= t && localP.x >= x - t && localP.x <= x + width + t;
            return nearLeft || nearRight || nearTop || nearBottom;
        }
    }

    if (shape.type === "circle") {
        const dx = localP.x - center.x;
        const dy = localP.y - center.y;
        const rx = width / 2;
        const ry = height / 2;

        if (hasFill) {
            const rxO = rx + t;
            const ryO = ry + t;
            return (dx * dx) / (rxO * rxO) + (dy * dy) / (ryO * ryO) <= 1;
        } else {
            // Ellipse border check: inside outer bounds but outside inner bounds
            const rxO = rx + t;
            const ryO = ry + t;
            const rxI = Math.max(0.1, rx - t);
            const ryI = Math.max(0.1, ry - t);

            const isInsideOuter = (dx * dx) / (rxO * rxO) + (dy * dy) / (ryO * ryO) <= 1;
            const isOutsideInner = rx - t <= 0.1 || ry - t <= 0.1 || (dx * dx) / (rxI * rxI) + (dy * dy) / (ryI * ryI) > 1;
            return isInsideOuter && isOutsideInner;
        }
    }

    return false;
};

/**
 * Checks if a point hits a measurement.
 */
export const isPointInMeasurement = (point, m, tolerance = 5) => {
    if (!m) return false;

    // Length (Line)
    if (m.type === "length" && m.points?.length === 2) {
        const dist = distanceToSegment(point, m.points[0], m.points[1]);
        return dist <= Math.max(tolerance, (m.strokeWidth || 2) / 2 + 5);
    }

    // Perimeter & Polylength (Polyline)
    if ((m.type === "perimeter" || m.type === "polylength") && m.points?.length >= 2) {
        for (let i = 0; i < m.points.length - 1; i++) {
            const dist = distanceToSegment(point, m.points[i], m.points[i + 1]);
            if (dist <= Math.max(tolerance, (m.strokeWidth || 2) / 2 + 5)) return true;
        }
        return false;
    }

    // Area (Polygon)
    if (m.type === "area" && m.points?.length >= 3) {
        // Check edges first (like perimeter) for easy selection of edge
        for (let i = 0; i < m.points.length; i++) {
            const p1 = m.points[i];
            const p2 = m.points[(i + 1) % m.points.length];
            const dist = distanceToSegment(point, p1, p2);
            if (dist <= Math.max(tolerance, (m.strokeWidth || 2) / 2 + 5)) return true;
        }

        // Ray casting for "inside" check
        let inside = false;
        const x = point.x, y = point.y;
        for (let i = 0, j = m.points.length - 1; i < m.points.length; j = i++) {
            const xi = m.points[i].x, yi = m.points[i].y;
            const xj = m.points[j].x, yj = m.points[j].y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // Count (Grouped)
    if (m.type === "count") {
        const r = 10 + tolerance;
        if (m.points) {
            return m.points.some(p => calculateDistance(point, p) <= r);
        }
        if (m.point) {
            return calculateDistance(point, m.point) <= r;
        }
    }

    // Comment
    if (m.type === "comment" && m.tip && m.box) {
        // Check tip circle
        if (calculateDistance(point, m.tip) <= 10) return true;
        // Check box
        return (
            point.x >= m.box.x && point.x <= m.box.x + m.box.w &&
            point.y >= m.box.y && point.y <= m.box.y + m.box.h
        );
    }

    return false;
};

/**
 * Finds the topmost item at a given point.
 * Prioritizes shapes over measurements if z-index isn't explicit, 
 * but generally reverse order of render.
 */
export const findItemAtPoint = (point, shapes = [], measurements = [], tolerance = 5) => {
    // Check shapes first (on top?)
    // Actually, usually we want reverse render order. 
    // If shapes are on top of measurements, check shapes first.

    // Check shapes
    for (let i = shapes.length - 1; i >= 0; i--) {
        if (isPointInShape(point, shapes[i], tolerance)) {
            return { type: 'shape', item: shapes[i] };
        }
    }

    // Check measurements
    for (let i = measurements.length - 1; i >= 0; i--) {
        if (isPointInMeasurement(point, measurements[i], tolerance)) {
            return { type: 'measurement', item: measurements[i] };
        }
    }

    return null;
};

// Keep legacy export for safety if other files use it
export const findShapeAtPoint = (point, shapes, tolerance) => {
    const res = findItemAtPoint(point, shapes, [], tolerance);
    return res ? res.item : null;
};
