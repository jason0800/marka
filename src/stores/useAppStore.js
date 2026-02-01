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

    // --- Default Shape Properties (Sticky) ---
    defaultShapeStyle: {
        stroke: "#000000",
        strokeWidth: 2,
        strokeDasharray: "none",
        fill: "none",
        opacity: 1,
    },
    setDefaultShapeStyle: (style) =>
        set((state) => ({
            defaultShapeStyle: { ...state.defaultShapeStyle, ...style },
        })),

    // --- Theme ---
    theme: "light",
    setTheme: (theme) => set({ theme }),

    // --- Page Navigation & View Mode ---
    currentPage: 1,
    viewMode: 'continuous', // 'single' | 'continuous'
    jumpToPage: null, // trigger for imperative navigation
    setCurrentPage: (page) => set({ currentPage: page }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setJumpToPage: (page) => set({ jumpToPage: page }),

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

    // --- File Info ---
    fileName: "Untitled.pdf",
    fileSize: 0,
    setFileInfo: (name, size) => set((state) => {
        const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, title: name } : t
        );
        return {
            fileName: name,
            fileSize: size,
            tabs: newTabs
        };
    }),

    addMeasurement: (measurement) =>
        set((state) => ({
            measurements: [...state.measurements, {
                ...state.defaultShapeStyle, // Apply defaults
                ...measurement
            }]
        })),

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
    // --- Clipboard ---
    clipboard: [],
    copy: () =>
        set((state) => {
            const selectedShapes = state.shapes.filter((s) => state.selectedIds.includes(s.id));
            const selectedMeasurements = state.measurements.filter((m) =>
                state.selectedIds.includes(m.id)
            );
            return {
                clipboard: [...selectedShapes, ...selectedMeasurements],
            };
        }),

    paste: () =>
        set((state) => {
            if (state.clipboard.length === 0) return {};

            const newShapes = [];
            const newMeasurements = [];
            const newSelectedIds = [];
            const offset = 20;

            state.clipboard.forEach((item) => {
                const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `pasted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                newSelectedIds.push(newId);

                // Check if it's a shape or measurement based on properties (shapes have 'type' and usually 'x'/'y' or 'start'/'end')
                // Actually both have 'type'. We can check if it exists in original shapes or measurements
                // But clipboard is mixed. Let's assume common structure or distinguishing prop.
                // Measurements usually have 'points' or 'point'. Shapes have 'x','y','width','height' OR 'start','end'.

                // Better approach: verify against known types or structure.
                // Shape types: rectangle, circle, line, arrow
                // Measurement types: length, area, perimeter, count, comment

                const isShape = ['rectangle', 'circle', 'line', 'arrow'].includes(item.type);
                console.log("Paste Item Processing:", item.type, "isShape:", isShape);

                if (isShape) {
                    const newItem = {
                        ...item,
                        id: newId,
                        pageIndex: state.currentPage, // Paste to current page (1-based)
                    };

                    // Offset logic
                    if (newItem.type === 'line' || newItem.type === 'arrow') {
                        newItem.start = { x: newItem.start.x + offset, y: newItem.start.y + offset };
                        newItem.end = { x: newItem.end.x + offset, y: newItem.end.y + offset };
                    } else {
                        newItem.x += offset;
                        newItem.y += offset;
                    }
                    newShapes.push(newItem);
                } else {
                    // Measurement
                    const newItem = {
                        ...item,
                        id: newId,
                        pageIndex: state.currentPage, // Paste to current page (1-based)
                    };

                    if (newItem.points) {
                        newItem.points = newItem.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
                    }
                    if (newItem.point) {
                        newItem.point = { x: newItem.point.x + offset, y: newItem.point.y + offset };
                    }
                    if (newItem.tip) {
                        newItem.tip = { x: newItem.tip.x + offset, y: newItem.tip.y + offset };
                    }
                    if (newItem.box) {
                        newItem.box = { ...newItem.box, x: newItem.box.x + offset, y: newItem.box.y + offset };
                    }

                    newMeasurements.push(newItem);
                }
            });

            // Push history first? No, we need to update state, THEN push history.
            // But `set` merges state. History needs previous state? 
            // `pushHistory` takes CURRENT state and pushes it. So we apply changes, then call pushHistory via logic (or user action).
            // Actually `pushHistory` in store reads current state.
            // So if we update here, we should probably call pushHistory manually?
            // Usually Undo/Redo/Push flow: user does action -> update state -> pushHistory.

            // To be safe, we'll return new state, and the component calling paste should trigger pushHistory?
            // OR we do side-effect here? Zustand set is synchronous.

            return {
                shapes: [...state.shapes, ...newShapes],
                measurements: [...state.measurements, ...newMeasurements],
                selectedIds: newSelectedIds,
            };
        }),

    cut: () =>
        set((state) => {
            const selectedShapes = state.shapes.filter((s) => state.selectedIds.includes(s.id));
            const selectedMeasurements = state.measurements.filter((m) =>
                state.selectedIds.includes(m.id)
            );

            if (selectedShapes.length === 0 && selectedMeasurements.length === 0) return {};

            const clipboard = [...selectedShapes, ...selectedMeasurements];

            const remainingShapes = state.shapes.filter(s => !state.selectedIds.includes(s.id));
            const remainingMeasurements = state.measurements.filter(m => !state.selectedIds.includes(m.id));

            return {
                clipboard,
                shapes: remainingShapes,
                measurements: remainingMeasurements,
                selectedIds: [],
            };
        }),

    // --- Page Features ---
    numPages: 0,
    setNumPages: (n) => set({ numPages: n }),
    pageRotations: {}, // pageIndex -> degrees (0, 90, 180, 270)

    rotatePage: (pageIndex, angle) =>
        set((state) => {
            const currentRot = state.pageRotations[pageIndex] || 0;
            const newRot = (currentRot + angle) % 360;
            return {
                pageRotations: {
                    ...state.pageRotations,
                    [pageIndex]: (newRot < 0 ? newRot + 360 : newRot),
                },
            };
        }),

    rotateAllPages: (angle) =>
        set((state) => {
            const newRotations = { ...state.pageRotations };
            for (let i = 0; i < state.numPages; i++) {
                // Check if pageIndex is 0-based or 1-based?
                // PDFViewer uses 1-based for display data-page-number, but array index 0-based.
                // rotatePage usage in TopMenu is `currentPage - 1`. So 0-based index.
                const currentRot = newRotations[i] || 0;
                let newRot = (currentRot + angle) % 360;
                newRot = (newRot < 0 ? newRot + 360 : newRot);
                newRotations[i] = newRot;
            }
            return { pageRotations: newRotations };
        }),

    // --- Tabs & Multi-Document Support ---
    tabs: [], // { id, title, pdfDocument, state: { ...snapshot } }
    activeTabId: null,
    pdfDocument: null, // Current active PDF proxy

    setPdfDocument: (doc) => set({ pdfDocument: doc }),

    addTab: (pdfDoc, fileName, fileSize) => set((state) => {
        const newTabId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `tab-${Date.now()}`;

        // Snapshot current tab if exists
        let newTabs = [...state.tabs];
        if (state.activeTabId) {
            newTabs = newTabs.map(t =>
                t.id === state.activeTabId
                    ? { ...t, state: getSnapshot(state) }
                    : t
            );
        }

        // Create new tab entry
        const newTab = {
            id: newTabId,
            title: fileName || "Untitled",
            pdfDocument: pdfDoc,
            state: {
                ...initialStateSnapshot,
                fileName: fileName || "Untitled.pdf",
                fileSize: fileSize || 0,
            }
        };

        return {
            tabs: [...newTabs, newTab],
            activeTabId: newTabId,
            pdfDocument: pdfDoc,
            // Reset workspace to clean state
            ...initialStateSnapshot,
            fileName: fileName || "Untitled.pdf",
            fileSize: fileSize || 0,
            history: [{ shapes: [], measurements: [] }], // Explicitly reset history structure
            historyIndex: 0
        };
    }),

    switchTab: (tabId) => set((state) => {
        if (state.activeTabId === tabId) return {};

        // Snapshot current
        const tabsWithSnapshot = state.tabs.map(t =>
            t.id === state.activeTabId
                ? { ...t, state: getSnapshot(state) }
                : t
        );

        const targetTab = tabsWithSnapshot.find(t => t.id === tabId);
        if (!targetTab) return {};

        return {
            tabs: tabsWithSnapshot,
            activeTabId: tabId,
            pdfDocument: targetTab.pdfDocument,
            ...targetTab.state
        };
    }),

    closeTab: (tabId) => set((state) => {
        const newTabs = state.tabs.filter(t => t.id !== tabId);

        // If closing active tab, switch to another
        if (state.activeTabId === tabId) {
            if (newTabs.length > 0) {
                const nextTab = newTabs[newTabs.length - 1]; // Switch to last
                return {
                    tabs: newTabs,
                    activeTabId: nextTab.id,
                    pdfDocument: nextTab.pdfDocument,
                    ...nextTab.state
                };
            } else {
                // No tabs left
                return {
                    tabs: [],
                    activeTabId: null,
                    pdfDocument: null,
                    ...initialStateSnapshot,
                    fileName: "Untitled.pdf",
                    fileSize: 0,
                    history: [{ shapes: [], measurements: [] }],
                    historyIndex: 0
                };
            }
        }

        return { tabs: newTabs };
    }),

    updateTabTitle: (tabId, newTitle) => set((state) => ({
        tabs: state.tabs.map(t => t.id === tabId ? { ...t, title: newTitle } : t)
    })),

}));

// Helper to capture workspace state
const getSnapshot = (state) => ({
    viewport: state.viewport,
    measurements: state.measurements,
    shapes: state.shapes,
    selectedIds: state.selectedIds,
    theme: state.theme,
    currentPage: state.currentPage,
    viewMode: state.viewMode,
    history: state.history,
    historyIndex: state.historyIndex,
    calibrationScales: state.calibrationScales,
    pageUnits: state.pageUnits,
    fileName: state.fileName,
    fileSize: state.fileSize,
    pageRotations: state.pageRotations,
});

const initialStateSnapshot = {
    viewport: initialViewport,
    measurements: [],
    shapes: [],
    selectedIds: [],
    currentPage: 1,
    viewMode: 'continuous',
    history: [{ shapes: [], measurements: [] }],
    historyIndex: 0,
    calibrationScales: {},
    pageUnits: {},
    pageRotations: {},
};

export default useAppStore;
