import { useState } from 'react';
import { loadPDF } from './services/pdf-service';
import PDFViewer from './components/PDFViewer/PDFViewer';
import Toolbar from './components/Toolbar/Toolbar';
import RightPanel from './components/Panels/RightPanel';
import PersistenceManager from './components/Persistence/PersistenceManager';
import html2canvas from 'html2canvas';
import useAppStore from './stores/useAppStore';
import TopMenu from './components/TopMenu/TopMenu';
import './App.css';

function App() {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { theme } = useAppStore();

  // Apply theme globally to body
  useState(() => {
    // Initial set
    document.documentElement.setAttribute('data-theme', useAppStore.getState().theme);
  }, []);

  // Update when theme changes
  const currentTheme = useAppStore(s => s.theme);
  if (document.documentElement.getAttribute('data-theme') !== currentTheme) {
    document.documentElement.setAttribute('data-theme', currentTheme);
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setIsLoading(true);
      try {
        const doc = await loadPDF(file);
        setPdfDocument(doc);
      } catch (err) {
        console.error("Failed to load PDF", err);
        alert("Failed to load PDF");
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleExportPNG = async () => {
    const element = document.querySelector('.main-content');
    if (element) {
      try {
        const canvas = await html2canvas(element, {
          useCORS: true,
          allowTaint: true,
          ignoreElements: (el) => el.classList.contains('do-not-export')
        });
        const link = document.createElement('a');
        link.download = 'scalario-export.png';
        link.href = canvas.toDataURL();
        link.click();
      } catch (e) {
        console.error("Export failed", e);
        alert("Export failed");
      }
    }
  };

  const handleExportCSV = () => {
    const { measurements, calibrationScales, pageUnits } = useAppStore.getState();
    let csv = "ID,Type,Page,Value,Unit,RawPixels,Points\n";
    measurements.forEach(m => {
      const scale = calibrationScales[m.pageIndex] || 1.0;
      const unit = pageUnits[m.pageIndex] || 'px';

      let val = 0;
      if (m.type === 'length') {
        val = Math.sqrt(Math.pow(m.points[1].x - m.points[0].x, 2) + Math.pow(m.points[1].y - m.points[0].y, 2)) / scale;
      } else if (m.type === 'area') {
        // Approximate area logic
        // ... (omitted for brevity, ideally share logic)
      }

      const pointsStr = m.points ? m.points.map(p => `(${p.x.toFixed(1)};${p.y.toFixed(1)})`).join('|') : (m.point ? `(${m.point.x};${m.point.y})` : "");

      csv += `${m.id},${m.type},${m.pageIndex},${val.toFixed(2)},${unit},?,${pointsStr}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'scalario-measurements.csv';
    link.click();
  };

  return (
    <div className="app-container" data-theme={useAppStore(s => s.theme)}>
      <PersistenceManager projectId="default" />
      <TopMenu setPdfDocument={setPdfDocument} setIsLoading={setIsLoading} />
      <div className="workspace-container">
        <Toolbar />
        <main className="main-content">
          {isLoading && <div className="pdf-viewer-placeholder">Loading...</div>}
          {!isLoading && !pdfDocument && (
            <div className="pdf-viewer-placeholder">
              Open a PDF to begin
            </div>
          )}
          {pdfDocument && <PDFViewer document={pdfDocument} />}
        </main>
        <RightPanel />
      </div>
    </div>
  );
}

export default App;
