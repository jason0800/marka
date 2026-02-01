import { useRef, useState, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';
import { loadPDF } from '../services/pdf-service';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
    FileText, FolderOpen, Save, Download, Printer,
    Undo, Redo, ZoomIn, ZoomOut, Sun, Moon,
    ChevronDown, CreditCard, RotateCw, RotateCcw, Clipboard, Scissors, Copy
} from 'lucide-react';
import DocumentPropertiesDialog from './DocumentPropertiesDialog';


const TopMenu = ({ setPdfDocument, setIsLoading, isDocumentLoaded, onNewPDF, pdfDocument }) => {
    const {
        theme, setTheme, zoom, setZoom, measurements, calibrationScales, pageUnits, shapes,
        undo, redo, history, historyIndex, selectedIds, setSelectedIds, deleteShape, deleteMeasurement, pushHistory,
        copy, cut, paste, clipboard, rotateAllPages, currentPage,
        fileName, fileSize, setFileInfo
    } = useAppStore();

    const [showDocProps, setShowDocProps] = useState(false);

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
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, selectedIds, shapes, measurements, deleteShape, deleteMeasurement, setSelectedIds, pushHistory, isDocumentLoaded, copy, cut, paste, rotateAllPages]);

    const fileInputRef = useRef(null);
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
                setPdfDocument(doc, file.name, file.size);
                setFileInfo(file.name, file.size);
            } catch (err) {
                console.error("Failed to load PDF", err);
                alert("Failed to load PDF");
            } finally {
                setIsLoading(false);
            }
        }
        setActiveMenu(null);
    };

    const handleSave = async () => {
        if (!isDocumentLoaded) return;
        const element = document.querySelector('.main-content');
        if (element) {
            setIsLoading(true);
            try {
                const canvas = await html2canvas(element, {
                    useCORS: true,
                    allowTaint: true,
                    ignoreElements: (el) => el.classList.contains('do-not-export'),
                    logging: false,
                    scale: 2 // Improved resolution
                });
                const imgData = canvas.toDataURL('image/png');
                const imgWidth = canvas.width;
                const imgHeight = canvas.height;

                const pdf = new jsPDF({
                    orientation: imgWidth > imgHeight ? 'l' : 'p',
                    unit: 'px',
                    format: [imgWidth, imgHeight]
                });

                pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
                pdf.save('marka-document.pdf');
            } catch (e) {
                console.error("Save PDF failed", e);
                alert("Save PDF failed");
            } finally {
                setIsLoading(false);
            }
        }
        setActiveMenu(null);
    };

    const handleExportPNG = async () => {
        if (!isDocumentLoaded) return;
        const element = document.querySelector('.main-content');
        if (element) {
            try {
                const canvas = await html2canvas(element, {
                    useCORS: true,
                    allowTaint: true,
                    ignoreElements: (el) => el.classList.contains('do-not-export')
                });
                const link = document.createElement('a');
                link.download = 'marka-export.png';
                link.href = canvas.toDataURL();
                link.click();
            } catch (e) {
                console.error("Export failed", e);
                alert("Export failed");
            }
        }
        setActiveMenu(null);
    };

    const handleExportCSV = () => {
        if (!isDocumentLoaded) return;
        let csv = "ID,Type,Page,Value,Unit,RawPixels,Points\n";
        measurements.forEach(m => {
            const scale = calibrationScales[m.pageIndex] || 1.0;
            const unit = pageUnits[m.pageIndex] || 'px';

            let val = 0;
            if (m.type === 'length') {
                val = Math.sqrt(Math.pow(m.points[1].x - m.points[0].x, 2) + Math.pow(m.points[1].y - m.points[0].y, 2)) / scale;
            } else if (m.type === 'area') {
                // Basic Polygon Area
                let area = 0;
                const n = m.points.length;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    area += m.points[i].x * m.points[j].y;
                    area -= m.points[j].x * m.points[i].y;
                }
                area = Math.abs(area) / 2;
                val = area / (scale * scale);
            }

            const pointsStr = m.points ? m.points.map(p => `(${p.x.toFixed(1)};${p.y.toFixed(1)})`).join('|') : (m.point ? `(${m.point.x};${m.point.y})` : "");

            csv += `${m.id},${m.type},${m.pageIndex},${val.toFixed(2)},${unit},?,${pointsStr}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'marka-measurements.csv';
        link.click();
        setActiveMenu(null);
    };

    // --- View Actions ---
    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        setActiveMenu(null);
    };

    return (

        <div className="h-10 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4 text-[var(--text-primary)] text-sm select-none relative z-[100]">
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
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={handleSave} disabled={!isDocumentLoaded}><Save size={16} /> Save PDF</button>
                            <div className="h-px bg-[#444] my-1" />
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={handleExportPNG} disabled={!isDocumentLoaded}><Download size={16} /> Export as PNG</button>
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={handleExportCSV} disabled={!isDocumentLoaded}><Download size={16} /> Export CSV</button>
                            {/* Print placeholder */}
                            <button className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default ${!isDocumentLoaded ? 'opacity-50 cursor-default' : ''}`} onClick={() => isDocumentLoaded && window.print()} disabled={!isDocumentLoaded}><Printer size={16} /> Print</button>
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
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[180px] shadow-[0_2px_10px_rgba(0,0,0,0.2)] py-1 z-[101] flex flex-col">
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { undo(); setActiveMenu(null); }}
                                disabled={historyIndex <= 0}
                            >
                                <Undo size={16} /> Undo
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { redo(); setActiveMenu(null); }}
                                disabled={historyIndex >= history.length - 1}
                            >
                                <Redo size={16} /> Redo
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
                                <Copy size={16} /> Copy
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { paste(); pushHistory(); setActiveMenu(null); }}
                                disabled={clipboard.length === 0}
                            >
                                <Clipboard size={16} /> Paste
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
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[210px] shadow-[0_2px_10px_rgba(0,0,0,0.2)] py-1 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(zoom * 1.2)}><ZoomIn size={16} /> Zoom In</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(zoom / 1.2)}><ZoomOut size={16} /> Zoom Out</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(1)}><CreditCard size={16} /> Reset Zoom</button>
                            <div className="h-px bg-[#444] my-1" />
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { rotateAllPages(90); setActiveMenu(null); }}
                            >
                                <RotateCw size={16} /> Rotate Clockwise
                            </button>
                            <button
                                className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default"
                                onClick={() => { rotateAllPages(-90); setActiveMenu(null); }}
                            >
                                <RotateCcw size={16} /> Rotate Anti-Clockwise
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
        </div>
    );
};

export default TopMenu;
