import { useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import { loadPDF } from '../services/pdf-service';
import html2canvas from 'html2canvas';
import {
    FileText, FolderOpen, Save, Download, Printer,
    Undo, Redo, ZoomIn, ZoomOut, Sun, Moon,
    ChevronDown, CreditCard
} from 'lucide-react';


const TopMenu = ({ setPdfDocument, setIsLoading }) => {
    const {
        theme, setTheme, zoom, setZoom, measurements, calibrationScales, pageUnits, shapes,
        undo, redo, history, historyIndex
    } = useAppStore();

    const fileInputRef = useRef(null);
    const [activeMenu, setActiveMenu] = useState(null);

    // --- File Actions ---
    const handleNew = () => {
        if (confirm("Are you sure you want to start a new project? Unsaved changes will be lost.")) {
            window.location.reload();
        }
    };

    const handleOpen = () => fileInputRef.current?.click();

    const handleFileChange = async (e) => {
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
        setActiveMenu(null);
    };

    const handleSave = () => {
        const data = {
            measurements,
            calibrationScales,
            pageUnits,
            shapes,
            timestamp: Date.now()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `marka-project-${Date.now()}.json`;
        link.click();
        setActiveMenu(null);
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
                        File <ChevronDown size={14} />
                    </button>
                    {activeMenu === 'file' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.3)] py-1 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleNew}><FileText size={16} /> New</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleOpen}><FolderOpen size={16} /> Open PDF</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleSave}><Save size={16} /> Save Project</button>
                            <div className="h-px bg-[#444] my-1" />
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleExportPNG}><Download size={16} /> Export as PNG</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={handleExportCSV}><Download size={16} /> Export CSV</button>
                            {/* Print placeholder */}
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => window.print()}><Printer size={16} /> Print</button>
                        </div>
                    )}
                </div>

                {/* EDIT MENU */}
                <div className="relative">
                    <button
                        className="bg-transparent border-none text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)]"
                        onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
                    >
                        Edit <ChevronDown size={14} />
                    </button>
                    {activeMenu === 'edit' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.3)] py-1 z-[101] flex flex-col">
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
                        </div>
                    )}
                </div>

                {/* VIEW MENU */}
                <div className="relative">
                    <button
                        className="bg-transparent border-none text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer text-[13px] flex items-center gap-1 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)]"
                        onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
                    >
                        View <ChevronDown size={14} />
                    </button>
                    {activeMenu === 'view' && (
                        <div className="absolute top-full left-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.3)] py-1 z-[101] flex flex-col">
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(zoom * 1.2)}><ZoomIn size={16} /> Zoom In</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(zoom / 1.2)}><ZoomOut size={16} /> Zoom Out</button>
                            <button className="bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full hover:bg-[#b4e6a0] hover:text-[#1a1a1a] disabled:opacity-50 disabled:cursor-default" onClick={() => setZoom(1)}><CreditCard size={16} /> Reset Zoom</button>
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
        </div>
    );
};

export default TopMenu;
