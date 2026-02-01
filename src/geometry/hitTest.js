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

    if (shape.type === "rectangle") {
        // Hit test for outlined shape is typically "near the border" or "inside if filled"
        // But for "select", clicking inside usually selects it too.
        // Let's assume hitting anywhere inside the bounding box selects it.
        return (
            localP.x >= x - t &&
            localP.x <= x + width + t &&
            localP.y >= y - t &&
            localP.y <= y + height + t
        );
    }

    if (shape.type === "circle") {
        // Ellipse hit test
        // transform local point to be relative to center
        const dx = localP.x - center.x;
        const dy = localP.y - center.y;

        // (x^2 / rx^2) + (y^2 / ry^2) <= 1
        const rx = width / 2 + t;
        const ry = height / 2 + t;

        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
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

    // Perimeter (Polyline)
    if (m.type === "perimeter" && m.points?.length >= 2) {
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

    // Count (Circle)
    if (m.type === "count" && m.point) {
        const r = (8 / (m.viewScale || 1)) + tolerance; // approx radius check
        const d = calculateDistance(point, m.point);
        return d <= r;
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
