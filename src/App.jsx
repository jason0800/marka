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
import StartupPage from './components/StartupPage';
import NewPDFDialog from './components/NewPDFDialog';
import './App.css';

function App() {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { theme } = useAppStore();
  const [showNewPDFDialog, setShowNewPDFDialog] = useState(false);

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

  const isDocumentLoaded = !!pdfDocument;

  return (
    <div className="app-container" data-theme={useAppStore(s => s.theme)}>
      <PersistenceManager projectId="default" />
      <TopMenu
        setPdfDocument={setPdfDocument}
        setIsLoading={setIsLoading}
        isDocumentLoaded={isDocumentLoaded}
        onNewPDF={() => setShowNewPDFDialog(true)}
      />

      {!isDocumentLoaded && !isLoading ? (
        <StartupPage
          setPdfDocument={setPdfDocument}
          setIsLoading={setIsLoading}
          onNewPDF={() => setShowNewPDFDialog(true)}
        />
      ) : (
        <div className="workspace-container">
          <LeftPanel pdfDocument={pdfDocument} />
          <main className="main-content">
            {isLoading && <div className="pdf-viewer-placeholder">Loading...</div>}
            {pdfDocument && <PDFViewer document={pdfDocument} />}
          </main>
          <Toolbar />
        </div>
      )}

      {isDocumentLoaded && (
        <BottomBar totalPages={pdfDocument ? pdfDocument.numPages : 0} />
      )}

      {showNewPDFDialog && (
        <NewPDFDialog
          onClose={() => setShowNewPDFDialog(false)}
          onCreated={(doc) => {
            setPdfDocument(doc);
            setShowNewPDFDialog(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
