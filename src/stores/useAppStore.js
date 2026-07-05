import { create } from "zustand";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const initialViewport = { scale: 1, x: 0, y: 0 };

const defaultShortcuts = {
    select: 'v',
    pan: 'h',
    calibrate: 's',
    length: 'l',
    area: 'g',
    angle: 'd',
    count: 'n',
    callout: 'q',
    text: 't',
    rectangle: 'r',
    circle: 'e',
    polyline: 'p',
    polygon: 'o',
    line: 'i',
    arrow: 'a',
};

const getStoredShortcuts = () => {
    try {
        const stored = localStorage.getItem('marka_shortcuts');
        if (stored) {
            return { ...defaultShortcuts, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.error(e);
    }
    return defaultShortcuts;
};

const useAppStore = create((set, get) => ({
    // --- Viewport (keep zoom+pan together) ---
    viewport: initialViewport,
    zoom: 1,
    minScale: 0.1,
    maxScale: 10,

    setViewport: (next) =>
        set((state) => {
            const nextViewport = typeof next === "function" ? next(state.viewport) : next;
            return {
                viewport: nextViewport,
                zoom: nextViewport.scale,
            };
        }),

    resetViewport: () => set({ viewport: initialViewport, zoom: 1 }),

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
                zoom: targetScale,
            };
        }),

    setZoom: (newScale) =>
        set((state) => {
            const oldScale = state.viewport.scale;
            const targetScale = clamp(newScale, state.minScale, state.maxScale);
            if (targetScale === oldScale) return {};

            // Zoom centered on the screen/viewport
            const clientX = window.innerWidth / 2;
            const clientY = window.innerHeight / 2;

            const wx = (clientX - state.viewport.x) / oldScale;
            const wy = (clientY - state.viewport.y) / oldScale;

            const nx = clientX - wx * targetScale;
            const ny = clientY - wy * targetScale;

            return {
                zoom: targetScale,
                viewport: { scale: targetScale, x: nx, y: ny }
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
    setSelectedIds: (ids) => set((state) => ({
        selectedIds: typeof ids === "function" ? ids(state.selectedIds) : ids
    })),

    // --- Shortcuts ---
    shortcuts: getStoredShortcuts(),
    updateShortcut: (toolId, key) => set((state) => {
        const newShortcuts = { ...state.shortcuts, [toolId]: key.toLowerCase() };
        try {
            localStorage.setItem('marka_shortcuts', JSON.stringify(newShortcuts));
        } catch (e) {
            console.error(e);
        }
        return { shortcuts: newShortcuts };
    }),
    resetShortcuts: () => set(() => {
        try {
            localStorage.setItem('marka_shortcuts', JSON.stringify(defaultShortcuts));
        } catch (e) {
            console.error(e);
        }
        return { shortcuts: defaultShortcuts };
    }),

    defaultShapeStyle: {
        stroke: "#000000",
        strokeWidth: 2,
        strokeDasharray: "none",
        fill: "#ffffff",
        opacity: 1,
        strokeOpacity: 1,
        textOpacity: 1,
    },
    setDefaultShapeStyle: (style) =>
        set((state) => ({
            defaultShapeStyle: { ...state.defaultShapeStyle, ...style },
        })),

    // --- Theme ---
    theme: "light",
    setTheme: (theme) => set({ theme }),

    // --- Snapping ---
    snappingEnabled: true,
    setSnappingEnabled: (enabled) => set({ snappingEnabled: enabled }),

    // --- Page Navigation & View Mode ---
    currentPage: 1,
    viewMode: 'continuous', // 'single' | 'continuous'
    jumpToPage: null, // trigger for imperative navigation
    setCurrentPage: (page) => set({ currentPage: page }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setJumpToPage: (page) => set({ jumpToPage: page }),

    // --- History (NOTE: snapshots must be copies, not references) ---
    history: [{ sheets: [], shapes: [], measurements: [], calibrationScales: {}, pageUnits: {}, pageRotations: {}, calibrationDetails: {} }], // Start with empty state
    historyIndex: 0,

    pushHistory: () =>
        set((state) => {
            const snapshot = {
                sheets: state.sheets.map((s) => ({ ...s })),
                shapes: state.shapes.map((s) => ({ ...s })),
                measurements: state.measurements.map((m) => ({ ...m })),
                calibrationScales: { ...state.calibrationScales },
                pageUnits: { ...state.pageUnits },
                calibrationDetails: { ...state.calibrationDetails },
                pageRotations: { ...state.pageRotations },
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
                sheets: snap.sheets ? snap.sheets.map((s) => ({ ...s })) : state.sheets,
                shapes: snap.shapes.map((s) => ({ ...s })),
                measurements: snap.measurements.map((m) => ({ ...m })),
                calibrationScales: snap.calibrationScales || state.calibrationScales,
                pageUnits: snap.pageUnits || state.pageUnits,
                calibrationDetails: snap.calibrationDetails || state.calibrationDetails,
                pageRotations: snap.pageRotations || state.pageRotations,
                historyIndex: newIndex,
            };
        }),

    redo: () =>
        set((state) => {
            if (state.historyIndex >= state.history.length - 1) return {};
            const newIndex = state.historyIndex + 1;
            const snap = state.history[newIndex];
            return {
                sheets: snap.sheets ? snap.sheets.map((s) => ({ ...s })) : state.sheets,
                shapes: snap.shapes.map((s) => ({ ...s })),
                measurements: snap.measurements.map((m) => ({ ...m })),
                calibrationScales: snap.calibrationScales || state.calibrationScales,
                pageUnits: snap.pageUnits || state.pageUnits,
                calibrationDetails: snap.calibrationDetails || state.calibrationDetails,
                pageRotations: snap.pageRotations || state.pageRotations,
                historyIndex: newIndex,
            };
        }),

    calibrationDetails: {}, // pageIndex -> { mode, presetIndex, paperVal, paperUnit, realVal, realUnit }

    setPageScale: (pageIndex, scale, unit = "units", details = null) =>
        set((state) => ({
            calibrationScales: { ...state.calibrationScales, [pageIndex]: scale },
            pageUnits: { ...state.pageUnits, [pageIndex]: unit },
            calibrationDetails: details ? { ...state.calibrationDetails, [pageIndex]: details } : state.calibrationDetails
        })),

    isPremium: false, // Start as free user
    setPremiumStatus: (status) => set({ isPremium: status }),

    leftPanelActiveTab: 'thumbnails',
    setLeftPanelActiveTab: (tab) => set({ leftPanelActiveTab: tab }),

    formatPaintStyle: null,
    setFormatPaintStyle: (style) => set({ formatPaintStyle: style }),

    setProjectData: (data) =>
        set((state) => {
            let sheets = data.sheets || [];
            if (sheets.length === 0 && state.pdfDocument) {
                const n = state.pdfDocument.numPages || 0;
                for (let i = 1; i <= n; i++) {
                    sheets.push({
                        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'pdf',
                        pdfPageNumber: i,
                        width: 800,
                        height: 1100,
                    });
                }
            }
            return {
                measurements: data.measurements || [],
                shapes: data.shapes || [], // Also restore shapes
                calibrationScales: data.calibrationScales || {},
                pageUnits: data.pageUnits || {},
                pageRotations: data.pageRotations || {}, // Restore rotations
                sheets,
                numPages: sheets.length || state.numPages,
                viewport: initialViewport,
                zoom: 1,
            };
        }),

    // Helper to get project data for saving (not a state setter, so just a getter is fine, 
    // but usually we do this in the component via useAppStore.getState(). 
    // We can add a convenience method here if we want, but getState() is cleaner for "read-only" export.)

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

                const isShape = ['rectangle', 'circle', 'line', 'arrow', 'polyline', 'polygon', 'image'].includes(item.type);
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
                    } else if (newItem.points) {
                        newItem.points = newItem.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
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
                    if (newItem.knee) {
                        newItem.knee = { x: newItem.knee.x + offset, y: newItem.knee.y + offset };
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
    tabs: [], // { id, title, pdfDocument, pdfBytes, state: { ...snapshot } }
    activeTabId: null,
    pdfDocument: null, // Current active PDF proxy
    pdfBytes: null,    // Original PDF ArrayBuffer bytes

    setPdfDocument: (doc, fileName, fileSize, pdfBytes) => set({
        pdfDocument: doc,
        pdfBytes: pdfBytes || null
    }),

    addTab: (pdfDoc, fileName, fileSize, pdfBytes) => set((state) => {
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

        const sheets = [];
        if (pdfDoc) {
            for (let i = 1; i <= pdfDoc.numPages; i++) {
                sheets.push({
                    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: 'pdf',
                    pdfPageNumber: i,
                    width: 800,
                    height: 1100,
                });
            }
        }

        // Create new tab entry
        const newTab = {
            id: newTabId,
            title: fileName || "Untitled",
            pdfDocument: pdfDoc,
            pdfBytes: pdfBytes || null,
            state: {
                ...initialStateSnapshot,
                sheets,
                fileName: fileName || "Untitled.pdf",
                fileSize: fileSize || 0,
            }
        };

        return {
            tabs: [...newTabs, newTab],
            activeTabId: newTabId,
            pdfDocument: pdfDoc,
            pdfBytes: pdfBytes || null,
            // Reset workspace to clean state
            ...initialStateSnapshot,
            sheets,
            numPages: sheets.length,
            fileName: fileName || "Untitled.pdf",
            fileSize: fileSize || 0,
            history: [{ sheets: sheets.map(s => ({ ...s })), shapes: [], measurements: [], calibrationScales: {}, pageUnits: {}, pageRotations: {}, calibrationDetails: {} }], // Explicitly reset history structure
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
            pdfBytes: targetTab.pdfBytes || null,
            ...targetTab.state
        };
    }),

    closeTab: (tabId) => set((state) => {
        // Find the tab and destroy its resources
        const tabToClose = state.tabs.find(t => t.id === tabId);
        if (tabToClose && tabToClose.pdfDocument) {
            try {
                tabToClose.pdfDocument.destroy();
            } catch (e) {
                console.warn("Failed to destroy PDF document", e);
            }
        }

        const newTabs = state.tabs.filter(t => t.id !== tabId);

        // If closing active tab, switch to another
        if (state.activeTabId === tabId) {
            if (newTabs.length > 0) {
                const nextTab = newTabs[newTabs.length - 1]; // Switch to last
                return {
                    tabs: newTabs,
                    activeTabId: nextTab.id,
                    pdfDocument: nextTab.pdfDocument,
                    pdfBytes: nextTab.pdfBytes || null,
                    ...nextTab.state
                };
            } else {
                // No tabs left
                return {
                    tabs: [],
                    activeTabId: null,
                    pdfDocument: null,
                    pdfBytes: null,
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

    // --- Sheets state ---
    sheets: [],
    addSheet: (insertAtIndex, width = 800, height = 1100) =>
        set((state) => {
            const newSheet = {
                id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'blank',
                width,
                height,
            };
            const newSheets = [...state.sheets];
            const index = insertAtIndex === undefined ? newSheets.length : insertAtIndex;
            newSheets.splice(index, 0, newSheet);

            const targetPageIndex = index + 1; // 1-based index where sheet is inserted
            const newMeasurements = state.measurements.map(m => {
                if (m.pageIndex >= targetPageIndex) {
                    return { ...m, pageIndex: m.pageIndex + 1 };
                }
                return m;
            });
            const newShapes = state.shapes.map(s => {
                if (s.pageIndex >= targetPageIndex) {
                    return { ...s, pageIndex: s.pageIndex + 1 };
                }
                return s;
            });

            // Shift calibration properties: calibrationScales, pageUnits, calibrationDetails, pageRotations
            const shiftKeys = (obj) => {
                const newObj = {};
                Object.keys(obj).forEach(key => {
                    const k = parseInt(key);
                    if (k >= index) {
                        newObj[k + 1] = obj[key];
                    } else {
                        newObj[k] = obj[key];
                    }
                });
                return newObj;
            };

            return {
                sheets: newSheets,
                numPages: newSheets.length,
                measurements: newMeasurements,
                shapes: newShapes,
                calibrationScales: shiftKeys(state.calibrationScales),
                pageUnits: shiftKeys(state.pageUnits),
                calibrationDetails: shiftKeys(state.calibrationDetails),
                pageRotations: shiftKeys(state.pageRotations),
                currentPage: targetPageIndex,
                jumpToPage: targetPageIndex
            };
        }),

    deleteSheet: (index) =>
        set((state) => {
            if (state.sheets.length <= 1) {
                return {};
            }
            const newSheets = state.sheets.filter((_, idx) => idx !== index);
            const targetPageIndex = index + 1;

            const newMeasurements = state.measurements
                .filter(m => m.pageIndex !== targetPageIndex)
                .map(m => {
                    if (m.pageIndex > targetPageIndex) {
                        return { ...m, pageIndex: m.pageIndex - 1 };
                    }
                    return m;
                });
            const newShapes = state.shapes
                .filter(s => s.pageIndex !== targetPageIndex)
                .map(s => {
                    if (s.pageIndex > targetPageIndex) {
                        return { ...s, pageIndex: s.pageIndex - 1 };
                    }
                    return s;
                });

            // Shift calibration down
            const shiftKeysDown = (obj) => {
                const newObj = {};
                Object.keys(obj).forEach(key => {
                    const k = parseInt(key);
                    if (k > index) {
                        newObj[k - 1] = obj[key];
                    } else if (k < index) {
                        newObj[k] = obj[key];
                    }
                });
                return newObj;
            };

            let newCurrentPage = state.currentPage;
            if (state.currentPage === targetPageIndex) {
                newCurrentPage = Math.max(1, targetPageIndex - 1);
            } else if (state.currentPage > targetPageIndex) {
                newCurrentPage = state.currentPage - 1;
            }

            return {
                sheets: newSheets,
                numPages: newSheets.length,
                measurements: newMeasurements,
                shapes: newShapes,
                calibrationScales: shiftKeysDown(state.calibrationScales),
                pageUnits: shiftKeysDown(state.pageUnits),
                calibrationDetails: shiftKeysDown(state.calibrationDetails),
                pageRotations: shiftKeysDown(state.pageRotations),
                currentPage: newCurrentPage,
                jumpToPage: newCurrentPage
            };
        }),

    moveSheet: (fromIndex, toIndex) =>
        set((state) => {
            if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.sheets.length || toIndex >= state.sheets.length) return {};
            const newSheets = [...state.sheets];
            const [movedSheet] = newSheets.splice(fromIndex, 1);
            newSheets.splice(toIndex, 0, movedSheet);

            const fromPageIndex = fromIndex + 1;
            const toPageIndex = toIndex + 1;

            const getNewPageIndex = (oldIndex) => {
                if (oldIndex === fromPageIndex) return toPageIndex;
                if (fromIndex < toIndex) {
                    if (oldIndex > fromPageIndex && oldIndex <= toPageIndex) {
                        return oldIndex - 1;
                    }
                } else {
                    if (oldIndex >= toPageIndex && oldIndex < fromPageIndex) {
                        return oldIndex + 1;
                    }
                }
                return oldIndex;
            };

            const newMeasurements = state.measurements.map(m => ({
                ...m,
                pageIndex: getNewPageIndex(m.pageIndex)
            }));

            const newShapes = state.shapes.map(s => ({
                ...s,
                pageIndex: getNewPageIndex(s.pageIndex)
            }));

            const moveKeys = (obj) => {
                const newObj = {};
                Object.keys(obj).forEach(key => {
                    const k = parseInt(key);
                    const oldPageIndex = k + 1;
                    const newPageIndex = getNewPageIndex(oldPageIndex);
                    newObj[newPageIndex - 1] = obj[key];
                });
                return newObj;
            };

            const oldCurrentPage = state.currentPage;
            const newCurrentPage = getNewPageIndex(oldCurrentPage);

            return {
                sheets: newSheets,
                measurements: newMeasurements,
                shapes: newShapes,
                calibrationScales: moveKeys(state.calibrationScales),
                pageUnits: moveKeys(state.pageUnits),
                calibrationDetails: moveKeys(state.calibrationDetails),
                pageRotations: moveKeys(state.pageRotations),
                currentPage: newCurrentPage,
                jumpToPage: newCurrentPage
            };
        }),
}));

// Helper to capture workspace state
const getSnapshot = (state) => ({
    viewport: state.viewport,
    zoom: state.viewport.scale,
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
    sheets: state.sheets.map(s => ({ ...s })),
});

const initialStateSnapshot = {
    viewport: initialViewport,
    zoom: 1,
    measurements: [],
    shapes: [],
    selectedIds: [],
    currentPage: 1,
    viewMode: 'continuous',
    history: [{ sheets: [], shapes: [], measurements: [], calibrationScales: {}, pageUnits: {}, pageRotations: {}, calibrationDetails: {} }],
    historyIndex: 0,
    calibrationScales: {},
    pageUnits: {},
    pageRotations: {},
    sheets: [],
};

export default useAppStore;
