import { useRef, useState, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { loadPDF } from '../services/pdf-service';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    FileText, FolderOpen, Save, Printer, Loader2,
    Undo, Redo, ZoomIn, ZoomOut, Sun, Moon,
    ChevronDown, RotateCw, RotateCcw, Clipboard, Scissors, Copy,
    Magnet, Keyboard, Settings
} from 'lucide-react';
import DocumentPropertiesDialog from './DocumentPropertiesDialog';
import { exportFlattenedPDF } from '../services/pdf-export-service';
import { toast } from 'sonner';
import { confirmToast } from '../utils/confirm-toast';
import { saveProject, loadProject, promptForProjectFiles, promptForPDF } from '../services/project-service';
import ShortcutsDialog from './ShortcutsDialog';
import PreferencesDialog from './PreferencesDialog';

// ... (existing imports)




const TopMenu = ({ setPdfDocument, setIsLoading, isDocumentLoaded, onNewPDF, pdfDocument }) => {
    const {
        theme, setTheme, zoom, setZoom, measurements, calibrationScales, pageUnits, shapes,
        undo, redo, history, historyIndex, selectedIds, setSelectedIds, deleteShape, deleteMeasurement, pushHistory,
        copy, cut, paste, clipboard, rotateAllPages, currentPage,
        fileName, fileSize, setFileInfo,
        setProjectData, snappingEnabled, setSnappingEnabled,
        addShape, addMeasurement
    } = useAppStore();


    const [showDocProps, setShowDocProps] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);
    const [showPreferences, setShowPreferences] = useState(false);

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

            // Cut
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'x' || e.code === 'KeyX')) {
                e.preventDefault();
                console.log("Shortcut: Cut");
                cut();
                pushHistory(); // Push history after cut
                return;
            }

            // Select All
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'a' || e.code === 'KeyA')) {
                e.preventDefault();
                const allPageItemIds = [
                    ...shapes.filter(s => s.pageIndex === currentPage).map(s => s.id),
                    ...measurements.filter(m => m.pageIndex === currentPage).map(m => m.id)
                ];
                setSelectedIds(allPageItemIds);
                return;
            }

            // Duplicate
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'd' || e.code === 'KeyD')) {
                e.preventDefault();
                if (selectedIds.length > 0) {
                    const newIds = [];
                    selectedIds.forEach(id => {
                        const s = shapes.find(x => x.id === id);
                        if (s) {
                            const newId = crypto.randomUUID();
                            newIds.push(newId);
                            addShape({
                                ...s,
                                id: newId,
                                x: s.x !== undefined ? s.x + 20 : undefined,
                                y: s.y !== undefined ? s.y + 20 : undefined,
                                start: s.start ? { x: s.start.x + 20, y: s.start.y + 20 } : undefined,
                                end: s.end ? { x: s.end.x + 20, y: s.end.y + 20 } : undefined,
                                points: s.points ? s.points.map(p => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
                            });
                        } else {
                            const m = measurements.find(x => x.id === id);
                            if (m) {
                                const newId = crypto.randomUUID();
                                newIds.push(newId);
                                addMeasurement({
                                    ...m,
                                    id: newId,
                                    points: m.points ? m.points.map(p => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
                                    point: m.point ? { x: m.point.x + 20, y: m.point.y + 20 } : undefined,
                                    tip: m.tip ? { x: m.tip.x + 20, y: m.tip.y + 20 } : undefined,
                                    knee: m.knee ? { x: m.knee.x + 20, y: m.knee.y + 20 } : undefined,
                                    box: m.box ? { ...m.box, x: m.box.x + 20, y: m.box.y + 20 } : undefined,
                                    textOffset: m.textOffset ? { x: m.textOffset.x, y: m.textOffset.y } : undefined,
                                });
                            }
                        }
                    });
                    setSelectedIds(newIds);
                    pushHistory();
                }
                return;
            }

            // Deselect
            if (e.key === 'Escape') {
                setSelectedIds([]);
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
                const arrayBuffer = await file.arrayBuffer();
                const doc = await loadPDF(file);
                // Reset store for new file if needed, but for now just load doc
                // Ideally we should reset shapes/measurements here too or allow "Close"
                setPdfDocument(doc, file.name, file.size, arrayBuffer);
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
        const state = useAppStore.getState();
        saveProject(state, state.fileName);
        setActiveMenu(null);
    };

    const handleOpenProject = async () => {
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
            const arrayBuffer = await result.pdfFile.arrayBuffer();
            const doc = await loadPDF(result.pdfFile);
            setPdfDocument(doc, result.pdfFile.name, result.pdfFile.size, arrayBuffer);
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
            const arrayBuffer = await pdfFile.arrayBuffer();
            const doc = await loadPDF(pdfFile);
            setPdfDocument(doc, pdfFile.name, pdfFile.size, arrayBuffer);
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

        setIsPrinting(true);
        setLoadingProgress(0);

        try {
            // Get current store state
            const { shapes, measurements, calibrationScales, fileName, sheets } = useAppStore.getState();

            await exportFlattenedPDF(
                pdfDocument,
                shapes,
                measurements,
                calibrationScales,
                fileName,
                (progress) => setLoadingProgress(progress),
                sheets
            );

        } catch (e) {
            console.error("Save PDF failed", e);
            alert("Save PDF failed: " + e.message);
        } finally {
            setIsPrinting(false);
            setLoadingProgress(0);
            setActiveMenu(null);
        }
    };


    // --- View Actions ---
    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        setActiveMenu(null);
    };

    return (

        <div className="h-10 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4 text-[var(--text-primary)] text-sm select-none relative z-[100]">

            <div className="font-semibold mr-6 text-white hidden">Marka</div>

            <div className="flex gap-0.5 z-[100] relative">
                {/* MARKA MENU */}
                <div className="relative">
                    <button
                        className="bg-transparent border-none text-[var(--text-primary)] px-1.5 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)]"
                        onClick={() => setActiveMenu(activeMenu === 'marka' ? null : 'marka')}
                        onMouseEnter={() => {
                            if (activeMenu) setActiveMenu('marka');
                        }}
                    >
                        Marka
                    </button>
                    {activeMenu === 'marka' && (
                        <div className="absolute top-full left-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-none min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-0 z-[101] flex flex-col">
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { setShowShortcutsDialog(true); setActiveMenu(null); }}
                            >
                                <Keyboard size={16} /> Keyboard Shortcuts
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { setShowPreferences(true); setActiveMenu(null); }}
                            >
                                <Settings size={16} /> Preferences
                            </button>
                        </div>
                    )}
                </div>

                {/* FILE MENU */}
                <div className="relative">
                    <button
                        className="bg-transparent border-none text-[var(--text-primary)] px-1.5 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)]"
                        onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
                        onMouseEnter={() => {
                            if (activeMenu) setActiveMenu('file');
                        }}
                    >
                        File
                    </button>
                    {activeMenu === 'file' && (
                        <div className="absolute top-full left-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-none min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-0 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap" onClick={handleNew}><FileText size={16} /> New PDF</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap" onClick={handleOpen}><FolderOpen size={16} /> Open PDF</button>

                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap" onClick={handleOpenProject}><FolderOpen size={16} /> Open Project</button>
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={handleSaveProject} disabled={!isDocumentLoaded}><Save size={16} /> Save Project</button>

                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap ${!isDocumentLoaded || isPrinting ? 'opacity-50 cursor-default' : ''}`} onClick={handleSave} disabled={!isDocumentLoaded || isPrinting}>
                                {isPrinting ? <Loader2 size={16} className="animate-spin text-[var(--primary-color)]" /> : <Printer size={16} />} Print PDF
                            </button>
                        </div>
                    )}
                </div>

                {/* EDIT MENU */}
                <div className="relative">
                    <button
                        className={`bg-transparent border-none text-[var(--text-primary)] px-1.5 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${!isDocumentLoaded ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
                        onClick={() => isDocumentLoaded && setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
                        onMouseEnter={() => {
                            if (activeMenu && isDocumentLoaded) setActiveMenu('edit');
                        }}
                        disabled={!isDocumentLoaded}
                    >
                        Edit
                    </button>
                    {activeMenu === 'edit' && (
                        <div className="absolute top-full left-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-none min-w-[200px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-0 z-[101] flex flex-col">
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { undo(); setActiveMenu(null); }}
                                disabled={historyIndex <= 0}
                            >
                                <Undo size={16} /> Undo <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Z</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { redo(); setActiveMenu(null); }}
                                disabled={historyIndex >= history.length - 1}
                            >
                                <Redo size={16} /> Redo <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Y</span>
                            </button>
                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { cut(); pushHistory(); setActiveMenu(null); }}
                            >
                                <Scissors size={16} /> Cut
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { copy(); setActiveMenu(null); }}
                            >
                                <Copy size={16} /> Copy <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+C</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
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
                        className={`bg-transparent border-none text-[var(--text-primary)] px-1.5 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${!isDocumentLoaded ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
                        onClick={() => isDocumentLoaded && setActiveMenu(activeMenu === 'document' ? null : 'document')}
                        onMouseEnter={() => {
                            if (activeMenu && isDocumentLoaded) setActiveMenu('document');
                        }}
                        disabled={!isDocumentLoaded}
                    >
                        Document
                    </button>
                    {activeMenu === 'document' && (
                        <div className="absolute top-full left-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-none min-w-[190px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-0 z-[101] flex flex-col">
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
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
                        className={`bg-transparent border-none text-[var(--text-primary)] px-1.5 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${!isDocumentLoaded ? 'opacity-50 cursor-default hover:bg-transparent' : ''}`}
                        onClick={() => isDocumentLoaded && setActiveMenu(activeMenu === 'view' ? null : 'view')}
                        onMouseEnter={() => {
                            if (activeMenu && isDocumentLoaded) setActiveMenu('view');
                        }}
                        disabled={!isDocumentLoaded}
                    >
                        View
                    </button>
                    {activeMenu === 'view' && (
                        <div className="absolute top-full left-0 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-none min-w-[290px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-0 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap" onClick={() => setZoom(zoom * 1.2)}><ZoomIn size={16} /> Zoom In <span className="ml-auto text-xs text-[#888] pl-4">Ctrl + +</span></button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap" onClick={() => setZoom(zoom / 1.2)}><ZoomOut size={16} /> Zoom Out <span className="ml-auto text-xs text-[#888] pl-4">Ctrl + -</span></button>
                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { rotateAllPages(90); setActiveMenu(null); }}
                            >
                                <RotateCw size={16} /> Rotate Clockwise <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Shift++</span>
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={() => { rotateAllPages(-90); setActiveMenu(null); }}
                            >
                                <RotateCcw size={16} /> Rotate Anti-Clockwise <span className="ml-auto text-xs text-[#888] pl-4">Ctrl+Shift+-</span>
                            </button>
                            <div className="h-px bg-[var(--border-color)] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[var(--btn-hover)] disabled:opacity-50 disabled:cursor-default whitespace-nowrap"
                                onClick={toggleTheme}
                            >
                                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                                Toggle Theme
                            </button>
                        </div>
                    )}
                </div>
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

            {showShortcutsDialog && (
                <ShortcutsDialog onClose={() => setShowShortcutsDialog(false)} />
            )}

            {showPreferences && (
                <PreferencesDialog onClose={() => setShowPreferences(false)} />
            )}
        </div>
    );
};

export default TopMenu;
