import { useRef, useState, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { loadPDF } from '../services/pdf-service';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    FileText, FolderOpen, Save,
    Undo, Redo, ZoomIn, ZoomOut, Sun, Moon,
    ChevronDown, RotateCw, RotateCcw, Clipboard, Scissors, Copy
} from 'lucide-react';
import UpgradeDialog from './UpgradeDialog';
import DocumentPropertiesDialog from './DocumentPropertiesDialog';
import { exportFlattenedPDF } from '../services/pdf-export-service';
import { toast } from 'sonner';
import { confirmToast } from '../utils/confirm-toast';
import { saveProject, loadProject, promptForProjectFiles, promptForPDF } from '../services/project-service';

// ... (existing imports)




const TopMenu = ({ setPdfDocument, setIsLoading, isDocumentLoaded, onNewPDF, pdfDocument }) => {
    const {
        theme, setTheme, zoom, setZoom, measurements, calibrationScales, pageUnits, shapes,
        undo, redo, history, historyIndex, selectedIds, setSelectedIds, deleteShape, deleteMeasurement, pushHistory,
        copy, cut, paste, clipboard, rotateAllPages, currentPage,
        fileName, fileSize, setFileInfo,
        isPremium, setProjectData
    } = useAppStore();


    const [showDocProps, setShowDocProps] = useState(false);
    const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);

    // Global Key Handlers (Undo/Redo/Delete/Cut/Copy/Paste)
    useEffect(() => {
        if (!isDocumentLoaded) return; // Disable shortcuts if no doc

        const handleKeyDown = (e) => {
            // Ignore inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
                return;
            }

            // Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                redo();
                return;
            }

            // Copy
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')) {
                e.preventDefault();
                console.log("Shortcut: Copy");
                copy();
                return;
            }

            // Paste
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) {
                e.preventDefault();
                console.log("Shortcut: Paste");
                paste();
                pushHistory(); // Push history after paste
                return;
            }

            // Cut
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'x' || e.code === 'KeyX')) {
                e.preventDefault();
                console.log("Shortcut: Cut");
                cut();
                pushHistory(); // Push history after cut
                return;
            }

            // Delete
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedIds.length > 0) {
                    e.preventDefault();

                    selectedIds.forEach(id => {
                        // Check global shapes list
                        if (shapes.find(s => s.id === id)) {
                            deleteShape(id);
                        } else if (measurements.find(m => m.id === id)) {
                            deleteMeasurement(id);
                        }
                    });

                    setSelectedIds([]);
                    pushHistory();
                }
            }

            // Rotate Shortcuts
            // Ctrl + Shift + + (Clockwise)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '+' || e.code === 'Equal')) {
                e.preventDefault();
                rotateAllPages(90);
                return;
            }

            // Ctrl + Shift + - (Anti-Clockwise)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '-' || e.key === '_' || e.code === 'Minus')) {
                e.preventDefault();
                rotateAllPages(-90);
                return;
            }

            // Zoom In (Ctrl + + or Ctrl + =)
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')) {
                e.preventDefault();
                setZoom(zoom * 1.2);
                return;
            }

            // Zoom Out (Ctrl + -)
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
                e.preventDefault();
                setZoom(zoom / 1.2);
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, selectedIds, shapes, measurements, deleteShape, deleteMeasurement, setSelectedIds, pushHistory, isDocumentLoaded, copy, cut, paste, rotateAllPages, zoom, setZoom]);

    const fileInputRef = useRef(null);
    const projectInputRef = useRef(null); // For .marka files
    const [activeMenu, setActiveMenu] = useState(null);

    // --- File Actions ---
    const handleNew = () => {
        if (isDocumentLoaded) {
            if (confirm("Create new PDF? Unsaved changes will be lost.")) {
                onNewPDF();
                setFileInfo("Untitled.pdf", 0);
            }
        } else {
            onNewPDF();
            setFileInfo("Untitled.pdf", 0);
        }
        setActiveMenu(null);
    };

    const handleOpen = () => fileInputRef.current?.click();

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            setIsLoading(true);
            try {
                const doc = await loadPDF(file);
                // Reset store for new file if needed, but for now just load doc
                // Ideally we should reset shapes/measurements here too or allow "Close"
                setPdfDocument(doc, file.name, file.size);
                setFileInfo(file.name, file.size);
            } catch (err) {
                console.error("Failed to load PDF", err);
                toast.error("Failed to load PDF");
            } finally {
                setIsLoading(false);
            }
        }
        setActiveMenu(null);
        // Reset input
        e.target.value = null;
    };

    // --- Project Save/Load (.marka) ---
    const handleSaveProject = () => {
        // PRO mode check temporarily disabled for testing
        // if (!isPremium) {
        //     setShowUpgradeDialog(true);
        //     setActiveMenu(null);
        //     return;
        // }

        const state = useAppStore.getState();
        saveProject(state, state.fileName);
        setActiveMenu(null);
    };

    const handleOpenProject = async () => {
        // PRO mode check temporarily disabled for testing
        // if (!isPremium) {
        //     setShowUpgradeDialog(true);
        //     setActiveMenu(null);
        //     return;
        // }

        setActiveMenu(null);

        try {
            // Prompt user to select both .marka and PDF files at once
            const result = await promptForProjectFiles();

            // Load and parse the .marka file
            const projectData = await loadProject(result.markaFile);

            // Validate PDF filename matches
            if (projectData.pdfFileName && result.pdfFile.name !== projectData.pdfFileName) {
                const mismatchMessage = `Warning: You selected "${result.pdfFile.name}" but this project was created with "${projectData.pdfFileName}".\n\nAnnotations may not align correctly. Continue anyway?`;
                if (!(await confirmToast(mismatchMessage, 'Continue', 'Cancel'))) {
                    return; // User cancelled
                }
            }

            // Load the PDF first
            setIsLoading(true);
            const doc = await loadPDF(result.pdfFile);
            setPdfDocument(doc, result.pdfFile.name, result.pdfFile.size);
            setFileInfo(result.pdfFile.name, result.pdfFile.size);

            // Then apply the project data (annotations, calibrations, etc.)
            setProjectData(projectData);

            setIsLoading(false);
            toast.success('Project loaded successfully');
        } catch (err) {
            if (err.message === 'NEED_PDF') {
                // User only selected .marka file, prompt for PDF separately
                toast.error('Please select the PDF file as well to open the project.');
            } else if (err.message !== 'User cancelled') {
                console.error("Failed to load project", err);
                toast.error("Failed to load project: " + err.message);
            }
            setIsLoading(false);
        }
    };

    const handleProjectFileChange = async (e) => {
        // This is now unused, but keeping for backwards compatibility
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Load and parse the .marka file
            const projectData = await loadProject(file);

            // Prompt user to locate the PDF file
            const pdfFileName = projectData.pdfFileName || 'the PDF';
            const confirmMessage = `This project requires "${pdfFileName}". Please locate the PDF file.`;

            if (!confirm(confirmMessage)) {
                return; // User cancelled
            }

            // Prompt for PDF file
            const pdfFile = await promptForPDF(pdfFileName);

            // Validate PDF filename matches
            if (projectData.pdfFileName && pdfFile.name !== projectData.pdfFileName) {
                const mismatchMessage = `Warning: You selected "${pdfFile.name}" but this project was created with "${projectData.pdfFileName}".\n\nAnnotations may not align correctly. Continue anyway?`;
                if (!confirm(mismatchMessage)) {
                    return; // User cancelled
                }
            }

            // Load the PDF first
            setIsLoading(true);
            const doc = await loadPDF(pdfFile);
            setPdfDocument(doc, pdfFile.name, pdfFile.size);
            setFileInfo(pdfFile.name, pdfFile.size);

            // Then apply the project data (annotations, calibrations, etc.)
            setProjectData(projectData);

            setIsLoading(false);
        } catch (err) {
            console.error("Failed to load project", err);
            alert("Failed to load project: " + err.message);
            setIsLoading(false);
        }

        e.target.value = null;
    };

    const handleSave = async () => {
        if (!isDocumentLoaded) return;

        setIsLoading(true);
        setLoadingProgress(0);

        try {
            // Get current store state
            const { shapes, measurements, calibrationScales, fileName } = useAppStore.getState();

            await exportFlattenedPDF(
                pdfDocument,
                shapes,
                measurements,
                calibrationScales,
                fileName,
                (progress) => setLoadingProgress(progress)
            );

        } catch (e) {
            console.error("Save PDF failed", e);
            alert("Save PDF failed: " + e.message);
        } finally {
            setIsLoading(false);
            setLoadingProgress(0);
        }
        setActiveMenu(null);
    };


    // --- View Actions ---
    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        setActiveMenu(null);
    };

    return (

        <div className="h-10 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4 text-[var(--text-primary)] text-sm select-none relative z-[100]">
            {/* Loading Overlay for Export */}
            {loadingProgress > 0 && (
                <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center flex-col">
                    <div className="text-white text-xl font-bold mb-4">Generating PDF...</div>
                    <div className="w-[300px] h-4 bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[var(--primary-color)] transition-all duration-300 ease-out"
                            style={{ width: `${loadingProgress}%` }}
                        />
                    </div>
                    <div className="text-white mt-2">{loadingProgress}%</div>
                </div>
            )}

            <div className="font-semibold mr-6 text-white hidden">Marka</div>

            <div className="flex gap-1">
                {/* FILE MENU */}
                <div className="relative">
                    <button
                        className="bg-transparent border-none text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)]"
                        onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
                    >
                        File
                    </button>
                    {activeMenu === 'file' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[180px] shadow-[0_2px_10px_rgba(0,0,0,0.2)] py-1 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleNew}><FileText size={16} /> New PDF</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleOpen}><FolderOpen size={16} /> Open PDF</button>

                            <div className="h-px bg-[#444] my-1" />
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleOpenProject}><FolderOpen size={16} /> Open Project <span className="text-[10px] bg-amber-500 text-black px-1 rounded ml-auto">PRO</span></button>
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={handleSaveProject} disabled={!isDocumentLoaded}><Save size={16} /> Save Project <span className="text-[10px] bg-amber-500 text-black px-1 rounded ml-auto">PRO</span></button>

                            <div className="h-px bg-[#444] my-1" />
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={handleSave} disabled={!isDocumentLoaded}><Save size={16} /> Save Flattened PDF</button>
                        </div>
                    )}
                </div>

                {/* EDIT MENU */}
                <div className="relative">
                    <button
                        className={`bg-transparent border-none text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${!isDocumentLoaded ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
                        onClick={() => isDocumentLoaded && setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
                        disabled={!isDocumentLoaded}
                    >
                        Edit
                    </button>
                    {activeMenu === 'edit' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[200px] shadow-[0_2px_10px_rgba(0,0,0,0.2)] py-1 z-[101] flex flex-col">
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { undo(); setActiveMenu(null); }}
                                disabled={historyIndex <= 0}
                            >
                                <Undo size={16} /> Undo <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Z</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { redo(); setActiveMenu(null); }}
                                disabled={historyIndex >= history.length - 1}
                            >
                                <Redo size={16} /> Redo <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Y</span>
                            </button>
                            <div className="h-px bg-[#444] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { cut(); pushHistory(); setActiveMenu(null); }}
                            >
                                <Scissors size={16} /> Cut
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { copy(); setActiveMenu(null); }}
                            >
                                <Copy size={16} /> Copy <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+C</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { paste(); pushHistory(); setActiveMenu(null); }}
                                disabled={clipboard.length === 0}
                            >
                                <Clipboard size={16} /> Paste <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+V</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* DOCUMENT MENU */}
                <div className="relative">
                    <button
                        className={`bg-transparent border-none text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${!isDocumentLoaded ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
                        onClick={() => isDocumentLoaded && setActiveMenu(activeMenu === 'document' ? null : 'document')}
                        disabled={!isDocumentLoaded}
                    >
                        Document
                    </button>
                    {activeMenu === 'document' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[190px] shadow-[0_2px_10px_rgba(0,0,0,0.2)] py-1 z-[101] flex flex-col">
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { setShowDocProps(true); setActiveMenu(null); }}
                            >
                                <FileText size={16} /> Document Properties
                            </button>
                        </div>
                    )}
                </div>

                {/* VIEW MENU */}
                <div className="relative">
                    <button
                        className={`bg-transparent border-none text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${!isDocumentLoaded ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
                        onClick={() => isDocumentLoaded && setActiveMenu(activeMenu === 'view' ? null : 'view')}
                        disabled={!isDocumentLoaded}
                    >
                        View
                    </button>
                    {activeMenu === 'view' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[240px] shadow-[0_2px_10px_rgba(0,0,0,0.2)] py-1 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(zoom * 1.2)}><ZoomIn size={16} /> Zoom In <span className="ml-auto text-xs text-[#888] pl-4">Ctrl + +</span></button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(zoom / 1.2)}><ZoomOut size={16} /> Zoom Out <span className="ml-auto text-xs text-[#888] pl-4">Ctrl + -</span></button>
                            <div className="h-px bg-[#444] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { rotateAllPages(90); setActiveMenu(null); }}
                            >
                                <RotateCw size={16} /> Rotate Clockwise <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Shift++</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { rotateAllPages(-90); setActiveMenu(null); }}
                            >
                                <RotateCcw size={16} /> Rotate Anti-Clockwise <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Shift+-</span>
                            </button>
                            <div className="h-px bg-[#444] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={toggleTheme}
                            >
                                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                                Toggle Theme
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="">
                {/* Preset Scale (Placeholder for now, better in Toolbar or Dialog) */}
            </div>

            {/* Hidden Input */}
            <input
                type="file"
                accept="application/pdf"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
            />
            {/* Project Input */}
            <input
                type="file"
                accept=".marka,.json"
                ref={projectInputRef}
                onChange={handleProjectFileChange}
                style={{ display: 'none' }}
            />

            {/* Click outside closer */}
            {activeMenu && (
                <div className="fixed inset-0 z-[99] bg-transparent" onClick={() => setActiveMenu(null)} />
            )}

            {showDocProps && (
                <DocumentPropertiesDialog
                    document={pdfDocument}
                    fileName={fileName}
                    fileSize={fileSize}
                    onClose={() => setShowDocProps(false)}
                />
            )}

            {showUpgradeDialog && (
                <UpgradeDialog onClose={() => setShowUpgradeDialog(false)} />
            )}
        </div>
    );
};

export default TopMenu;
