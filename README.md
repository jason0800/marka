# Scalario

Scalario is a browser-based PDF measurement + markup tool. It runs fully client-side with no backend dependencies.

## Features
- **PDF Viewer**: Smooth zoom/pan, multi-page rendering.
- **Measurement Tools**: Length, Area, Perimeter, Count.
- **Calibration**: Set scale from known dimensions (supports units like m, ft, mm).
- **Annotations**: Leadered comment callouts.
- **Export**: PNG screenshots and CSV data export.
- **Offline Capable**: PWA support.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run development server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

## Tech Stack
- React
- Vite
- PDF.js (v5.x)
- Zustand (State Management)
- IDB (IndexedDB Persistence)
- Lucide React (Icons)

## Coordinate System
- Measurements are stored in **PDF Page Space** (points).
- Calibration converts pixels (points) to real-world units.
- Transforms handle alignment during zoom/pan.

## Disclaimer
Measurements depend on correct calibration. Always verify critical dimensions.
