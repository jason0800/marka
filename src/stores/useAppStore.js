import { create } from "zustand";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const initialViewport = { scale: 1, x: 0, y: 0 };

const useAppStore = create((set, get) => ({
    // --- Viewport (keep zoom+pan together) ---
    viewport: initialViewport,
    minScale: 0.2,
    maxScale: 6,

    setViewport: (next) =>
        set((state) => ({
            viewport: typeof next === "function" ? next(state.viewport) : next,
        })),

    resetViewport: () => set({ viewport: initialViewport }),

    panBy: (dx, dy) =>
        set((state) => ({
            viewport: {
                ...state.viewport,
                x: state.viewport.x + dx,
                y: state.viewport.y + dy,
            },
        })),

    // Zoom around a screen-space anchor point (e.g. mouse position in canvas)
    zoomAt: ({ clientX, clientY, deltaScale }) =>
        set((state) => {
            const { viewport, minScale, maxScale } = state;
            const oldScale = viewport.scale;

            // multiplicative zoom feels better than additive
            const targetScale = clamp(oldScale * deltaScale, minScale, maxScale);
            if (targetScale === oldScale) return {};

            // Keep the point under the cursor stable:
            // world = (screen - pan) / scale
            const wx = (clientX - viewport.x) / oldScale;
            const wy = (clientY - viewport.y) / oldScale;

            // newPan = screen - world * newScale
            const nx = clientX - wx * targetScale;
            const ny = clientY - wy * targetScale;

            return {
                viewport: { scale: targetScale, x: nx, y: ny },
            };
        }),

    // Optional: nice “wheel feel”
    zoomWheel: ({ clientX, clientY, deltaY }) => {
        // deltaY > 0 => zoom out
        // tweak the 0.0015 to taste
        const factor = Math.exp(-deltaY * 0.0015);
        get().zoomAt({ clientX, clientY, deltaScale: factor });
    },

    // --- Interaction ---
    activeTool: "select", // select, pan, calibrate, length, area, perimeter, count, comment
    setActiveTool: (tool) => set({ activeTool: tool }),

    // --- Data ---
    calibrationScales: {}, // pageIndex -> scale (pixels per unit)
    pageUnits: {}, // pageIndex -> string (e.g. 'm', 'ft')
    measurements: [],
    shapes: [],
    selectedIds: [],
    setSelectedIds: (ids) => set({ selectedIds: ids }),

    // --- Theme ---
    theme: "light",
    setTheme: (theme) => set({ theme }),

    // --- Page Navigation & View Mode ---
    currentPage: 1,
    viewMode: 'continuous', // 'single' | 'continuous'
    setCurrentPage: (page) => set({ currentPage: page }),
    setViewMode: (mode) => set({ viewMode: mode }),

    // --- History (NOTE: snapshots must be copies, not references) ---
    history: [{ shapes: [], measurements: [] }], // Start with empty state
    historyIndex: 0,

    pushHistory: () =>
        set((state) => {
            const snapshot = {
                shapes: state.shapes.map((s) => ({ ...s })),
                measurements: state.measurements.map((m) => ({ ...m })),
            };
            const history = state.history.slice(0, state.historyIndex + 1);
            history.push(snapshot);
            return { history, historyIndex: history.length - 1 };
        }),

    undo: () =>
        set((state) => {
            if (state.historyIndex <= 0) return {};
            const newIndex = state.historyIndex - 1;
            const snap = state.history[newIndex];
            return {
                shapes: snap.shapes.map((s) => ({ ...s })),
                measurements: snap.measurements.map((m) => ({ ...m })),
                historyIndex: newIndex,
            };
        }),

    redo: () =>
        set((state) => {
            if (state.historyIndex >= state.history.length - 1) return {};
            const newIndex = state.historyIndex + 1;
            const snap = state.history[newIndex];
            return {
                shapes: snap.shapes.map((s) => ({ ...s })),
                measurements: snap.measurements.map((m) => ({ ...m })),
                historyIndex: newIndex,
            };
        }),

    setPageScale: (pageIndex, scale, unit = "units") =>
        set((state) => ({
            calibrationScales: { ...state.calibrationScales, [pageIndex]: scale },
            pageUnits: { ...state.pageUnits, [pageIndex]: unit },
        })),

    setProjectData: (data) =>
        set({
            measurements: data.measurements || [],
            calibrationScales: data.calibrationScales || {},
            pageUnits: data.pageUnits || {},
        }),

    addMeasurement: (measurement) =>
        set((state) => ({ measurements: [...state.measurements, measurement] })),

    updateMeasurement: (id, data) =>
        set((state) => ({
            measurements: state.measurements.map((m) =>
                m.id === id ? { ...m, ...data } : m
            ),
        })),

    deleteMeasurement: (id) =>
        set((state) => ({
            measurements: state.measurements.filter((m) => m.id !== id),
        })),

    addShape: (shape) =>
        set((state) => ({
            shapes: [...state.shapes, shape],
        })),

    updateShape: (id, data) =>
        set((state) => ({
            shapes: state.shapes.map((s) => (s.id === id ? { ...s, ...data } : s)),
        })),

    deleteShape: (id) =>
        set((state) => ({
            shapes: state.shapes.filter((s) => s.id !== id),
        })),
}));

export default useAppStore;
