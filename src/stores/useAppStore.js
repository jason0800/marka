import { create } from 'zustand';

const useAppStore = create((set) => ({
    // Visual Zoom/Pan
    zoom: 1.0,
    pan: { x: 0, y: 0 },
    setZoom: (zoom) => set({ zoom }),
    setPan: (pan) => set({ pan }),

    // Interaction
    activeTool: 'select', // select, pan, calibrate, length, area, perimeter, count, comment
    setActiveTool: (tool) => set({ activeTool: tool }),

    // Data
    calibrationScales: {}, // pageIndex -> scale (pixels per unit)
    pageUnits: {}, // pageIndex -> string (e.g. 'm', 'ft')
    measurements: [], // Array of { id, type, pageIndex, points, ... }

    setPageScale: (pageIndex, scale, unit = 'units') => set((state) => ({
        calibrationScales: { ...state.calibrationScales, [pageIndex]: scale },
        pageUnits: { ...state.pageUnits, [pageIndex]: unit }
    })),

    setProjectData: (data) => set({
        measurements: data.measurements || [],
        calibrationScales: data.calibrationScales || {},
        pageUnits: data.pageUnits || {}
    }),

    addMeasurement: (measurement) => set((state) => ({
        measurements: [...state.measurements, measurement]
    })),

    updateMeasurement: (id, data) => set((state) => ({
        measurements: state.measurements.map(m => m.id === id ? { ...m, ...data } : m)
    })),

    deleteMeasurement: (id) => set((state) => ({
        measurements: state.measurements.filter(m => m.id !== id)
    })),

}));

export default useAppStore;
