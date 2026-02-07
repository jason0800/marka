import { useState, useEffect } from 'react';
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
import TabBar from './components/TabBar';
import './App.css';

function App() {
  const { theme, pdfDocument, tabs, addTab } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPDFDialog, setShowNewPDFDialog] = useState(false);

  // Apply theme globally to body
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const isDocumentLoaded = tabs.length > 0;

  // Wrapper to adapt legacy components calling setPdfDocument
  const handleSetPdfDocument = (doc, name = "Untitled.pdf", size = 0) => {
    addTab(doc, name, size);
    setIsLoading(false);
  };

  return (
    <div className="app-container" data-theme={theme}>
      <PersistenceManager projectId="default" />
      <TopMenu
        setPdfDocument={handleSetPdfDocument}
        setIsLoading={setIsLoading}
        isDocumentLoaded={isDocumentLoaded}
        onNewPDF={() => setShowNewPDFDialog(true)}
        pdfDocument={pdfDocument}
      />

      {!isDocumentLoaded ? (
        <StartupPage
          setPdfDocument={handleSetPdfDocument}
          setIsLoading={setIsLoading}
          onNewPDF={() => setShowNewPDFDialog(true)}
        />
      ) : (
        <div className="workspace-container">
          <LeftPanel pdfDocument={pdfDocument} />
          <div className="flex flex-col flex-1 h-full min-w-0">
            <TabBar />
            <div className="flex flex-1 min-h-0 relative">
              <main className="main-content relative flex-1 flex flex-col min-h-0">
                {isLoading && <div className="pdf-viewer-placeholder">Loading...</div>}
                {pdfDocument && <PDFViewer document={pdfDocument} />}
              </main>
            </div>
          </div>
          <Toolbar />
        </div>
      )}

      {isDocumentLoaded && (
        <BottomBar totalPages={pdfDocument ? pdfDocument.numPages : 0} />
      )}

      {showNewPDFDialog && (
        <NewPDFDialog
          onClose={() => setShowNewPDFDialog(false)}
          onCreated={(doc, name) => {
            // NewPDFDialog updated to return doc
            if (doc) {
              addTab(doc, name || "New PDF", 0);
            }
            setShowNewPDFDialog(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
