import { useState } from 'react';
import { loadPDF } from './services/pdf-service';
import PDFViewer from './components/PDFViewer';
import Toolbar from './components/Toolbar';
import LeftPanel from './components/LeftPanel';
import PersistenceManager from './components/PersistenceManager';
import html2canvas from 'html2canvas';
import useAppStore from './stores/useAppStore';
import TopMenu from './components/TopMenu';
import BottomBar from './components/BottomBar';
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



  return (
    <div className="app-container" data-theme={useAppStore(s => s.theme)}>
      <PersistenceManager projectId="default" />
      <TopMenu setPdfDocument={setPdfDocument} setIsLoading={setIsLoading} />
      <div className="workspace-container">
        <LeftPanel pdfDocument={pdfDocument} />
        <main className="main-content">
          {isLoading && <div className="pdf-viewer-placeholder">Loading...</div>}
          {!isLoading && !pdfDocument && (
            <div className="pdf-viewer-placeholder">
              Open a PDF to begin
            </div>
          )}
          {pdfDocument && <PDFViewer document={pdfDocument} />}
        </main>
        <Toolbar />
      </div>
      <BottomBar totalPages={pdfDocument ? pdfDocument.numPages : 0} />
    </div>
  );
}

export default App;
