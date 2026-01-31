# Marka

Marka is a powerful PDF annotation and measurement tool built for professionals. It allows you to view, annotate, measure, and create PDFs directly in your browser with a highly responsive and intuitive interface.

## ✨ Features

### 📄 PDF Management
- **View PDFs**: Fast and accurate PDF rendering using `pdf.js`.
- **Create New PDFs**: Generate blank documents with custom dimensions or standard templates:
  - **ISO Series**: A0-A5, B0-B5, C0-C5.
  - **US Sizes**: Letter, Legal.
  - **Custom**: Define exact width/height in mm, cm, in, or pt.
- **Export**: Save your annotated documents.

### ✏️ Annotation Tools
- **Shapes**: Draw Rectangles, Circles, Lines, and Arrows.
- **Styling**: Customize appearance via the **Properties Panel**:
  - **Stroke & Fill**: Color picker with hex input and presets.
  - **Line Styles**: Continuous, Dashed, or Dotted lines.
  - **Opacity**: Fine-grained transparency control.
  - **Rotation**: Precise angle adjustment (hidden for simple lines/arrows).
- **Comments**: Add text notes to specific areas of the document.

### 📐 Measurement & Quantification
- **Calibration**: Set custom scales to measure accurately on technical drawings.
- **Length**: Measure linear distances.
- **Area**: Calculate polygon areas.
- **Perimeter**: Measure path lengths.
- **Count**: Place markers to tally items quickly.

### 🛠 Tech Stack
- **Framework**: React + Vite
- **Styling**: Tailwind CSS
- **PDF Core**: `react-pdf`, `jspdf`, `pdf-lib`
- **Icons**: `lucide-react`

## 🚀 Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run Development Server**
   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

## 🎨 UI/UX Highlights
- **Dark/Light Mode**: Fully theme-aware interface.
- **Responsive Design**: Polished layout with adjustable panels.
- **Shortcuts**: Keyboard shortcuts for efficient workflows.
