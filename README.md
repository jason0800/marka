# Marka

Marka is a browser-based PDF measurement + markup tool. It runs fully client-side with no backend dependencies.

## Features

### 📄 Document Management
- **PDF Viewer**: Smooth zoom/pan, multi-page rendering.
- **New PDF Creation**: Create blank documents with presets:
  - **ISO Series**: A0-A5, B0-B5, C0-C5
  - **US Sizes**: Letter, Legal
  - **Custom**: Define width/height in mm, cm, in, or pt.

### 📐 Measurement & Calibration
- **Tools**: Length, Area, Perimeter, Count (Tally).
- **Calibration**: Set scale from known dimensions.
- **Precision**: Real-time unit conversion.

### 🖌️ Drawing & Markup
- **Vector Shapes**: Rectangle, Circle, Line, Arrow.
- **Annotations**: Leadered comment callouts.
- **Styling**:
  - **Fill/Stroke**: Custom colors, hex input.
  - **Line Styles**: Continuous, Dashed, Dotted.
  - **Opacity**: 0-100% transparency control.
  - **Rotation**: Precise angle adjustment (hidden for non-rotatable shapes like lines).

### ⚙️ Core Application
- **Zero Backend**: All processing happens in the browser.
- **Offline Support**: PWA capable.
- **Export**: PNG screenshots and CSV data export.

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
- **Framework**: React + Vite
- **Engine**: PDF.js (v5.x), jsPDF
- **State**: Zustand
- **Persistence**: IDB (IndexedDB)
- **UI**: Tailwind CSS, Lucide React

## Coordinate System
- Measurements are stored in **PDF Page Space** (points).
- Calibration converts pixels (points) to real-world units.
- Transforms handle alignment during zoom/pan.

## Disclaimer
Measurements depend on correct calibration. Always verify critical dimensions.
