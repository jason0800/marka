import { useRef, useState } from 'react';
import useAppStore from '../../stores/useAppStore';
import { loadPDF } from '../../services/pdf-service';
import html2canvas from 'html2canvas';
import {
    FileText, FolderOpen, Save, Download, Printer,
    Undo, Redo, ZoomIn, ZoomOut, Sun, Moon,
    ChevronDown, CreditCard
} from 'lucide-react';
import classes from './TopMenu.module.css';

const TopMenu = ({ setPdfDocument, setIsLoading }) => {
    const {
        theme, setTheme, zoom, setZoom, measurements, calibrationScales, pageUnits, shapes
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
        link.download = `scalario-project-${Date.now()}.json`;
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
                link.download = 'scalario-export.png';
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
        link.download = 'scalario-measurements.csv';
        link.click();
        setActiveMenu(null);
    };

    // --- View Actions ---
    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        setActiveMenu(null);
    };

    return (
        <div className={classes.topMenu}>
            <div className={classes.logo}>Scalario</div>

            <div className={classes.menuBar}>
                {/* FILE MENU */}
                <div className={classes.menuItem}>
                    <button onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}>
                        File <ChevronDown size={14} />
                    </button>
                    {activeMenu === 'file' && (
                        <div className={classes.dropdown}>
                            <button onClick={handleNew}><FileText size={16} /> New</button>
                            <button onClick={handleOpen}><FolderOpen size={16} /> Open PDF</button>
                            <button onClick={handleSave}><Save size={16} /> Save Project</button>
                            <div className={classes.divider} />
                            <button onClick={handleExportPNG}><Download size={16} /> Export as PNG</button>
                            <button onClick={handleExportCSV}><Download size={16} /> Export CSV</button>
                            {/* Print placeholder */}
                            <button onClick={() => window.print()}><Printer size={16} /> Print</button>
                        </div>
                    )}
                </div>

                {/* EDIT MENU */}
                <div className={classes.menuItem}>
                    <button onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}>
                        Edit <ChevronDown size={14} />
                    </button>
                    {activeMenu === 'edit' && (
                        <div className={classes.dropdown}>
                            <button disabled><Undo size={16} /> Undo</button>
                            <button disabled><Redo size={16} /> Redo</button>
                        </div>
                    )}
                </div>

                {/* VIEW MENU */}
                <div className={classes.menuItem}>
                    <button onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}>
                        View <ChevronDown size={14} />
                    </button>
                    {activeMenu === 'view' && (
                        <div className={classes.dropdown}>
                            <button onClick={() => setZoom(zoom * 1.2)}><ZoomIn size={16} /> Zoom In</button>
                            <button onClick={() => setZoom(zoom / 1.2)}><ZoomOut size={16} /> Zoom Out</button>
                            <button onClick={() => setZoom(1)}><CreditCard size={16} /> Reset Zoom</button>
                            <div className={classes.divider} />
                            <button onClick={toggleTheme}>
                                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                                Toggle Theme
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className={classes.rightSide}>
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
                <div className={classes.overlay} onClick={() => setActiveMenu(null)} />
            )}
        </div>
    );
};

export default TopMenu;
