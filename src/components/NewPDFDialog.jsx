import React, { useState, useRef, useEffect } from 'react';
import { X, FileText, ChevronDown, Check } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { loadPDF } from '../services/pdf-service';

const TEMPLATES = [
    // US Common
    { name: 'Letter', width: 215.9, height: 279.4, unit: 'mm' },
    { name: 'Legal', width: 215.9, height: 355.6, unit: 'mm' },

    // ISO A Series
    { name: 'A0', width: 841, height: 1189, unit: 'mm' },
    { name: 'A1', width: 594, height: 841, unit: 'mm' },
    { name: 'A2', width: 420, height: 594, unit: 'mm' },
    { name: 'A3', width: 297, height: 420, unit: 'mm' },
    { name: 'A4', width: 210, height: 297, unit: 'mm' },
    { name: 'A5', width: 148, height: 210, unit: 'mm' },

    // ISO B Series
    { name: 'B0', width: 1000, height: 1414, unit: 'mm' },
    { name: 'B1', width: 707, height: 1000, unit: 'mm' },
    { name: 'B2', width: 500, height: 707, unit: 'mm' },
    { name: 'B3', width: 353, height: 500, unit: 'mm' },
    { name: 'B4', width: 250, height: 353, unit: 'mm' },
    { name: 'B5', width: 176, height: 250, unit: 'mm' },

    // ISO C Series
    { name: 'C0', width: 917, height: 1297, unit: 'mm' },
    { name: 'C1', width: 648, height: 917, unit: 'mm' },
    { name: 'C2', width: 458, height: 648, unit: 'mm' },
    { name: 'C3', width: 324, height: 458, unit: 'mm' },
    { name: 'C4', width: 229, height: 324, unit: 'mm' },
    { name: 'C5', width: 162, height: 229, unit: 'mm' },
];

const UNIT_TO_MM = {
    mm: 1,
    cm: 10,
    in: 25.4,
    pt: 25.4 / 72
};

const CustomSelect = ({ value, onChange, options, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = options.find(o => o.value === value)?.label || value || placeholder;

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md px-3 h-9 text-sm text-[var(--text-primary)] flex items-center justify-between focus:outline-none focus:border-[var(--primary-color)] hover:border-[var(--primary-color)] transition-colors"
            >
                <span className="truncate">{selectedLabel}</span>
                <ChevronDown size={14} className="text-[var(--text-secondary)]" />
            </button>

            {isOpen && (
                <div
                    className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-xl z-50 max-h-[220px] overflow-y-scroll"
                    style={{ scrollbarGutter: 'stable' }}
                >
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                                onChange(option.value);
                                setIsOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center justify-between ${option.value === value ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-primary)]'}`}
                        >
                            {option.label}
                            {option.value === value && <Check size={14} className="text-[var(--primary-color)]" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const NewPDFDialog = ({ onClose, onCreated }) => {
    const [template, setTemplate] = useState('A4');
    const [width, setWidth] = useState(210);
    const [height, setHeight] = useState(297);
    const [unit, setUnit] = useState('mm');
    const [orientation, setOrientation] = useState('portrait');
    const [pageCount, setPageCount] = useState(1);
    const [isCreating, setIsCreating] = useState(false);

    const handleTemplateChange = (tName) => {
        setTemplate(tName);
        if (tName !== 'Custom') {
            const t = TEMPLATES.find(x => x.name === tName);
            if (t) {
                // Determine dimensions based on current unit
                // Convert template dimensions (mm) to current unit
                const scale = UNIT_TO_MM['mm'] / UNIT_TO_MM[unit];

                // Helper to perform conversion
                const toCurrent = (mmVal) => parseFloat((mmVal * scale).toFixed(3));

                // But user wants "values in width and height should change accordingly" when CHANGING UNITS.
                // When picking template, the template has a defined unit.
                // "A4" is 210x297 mm.
                // If I'm in "in", should picking A4 switch me to mm? or show A4 in inches?
                // Logic: Let's follow the standard: Template sets the dimensions AND unit to the template default.
                // It's cleaner.

                setUnit(t.unit);
                // Re-set width/height in template unit
                if (orientation === 'landscape') {
                    setWidth(t.height);
                    setHeight(t.width);
                } else {
                    setWidth(t.width);
                    setHeight(t.height);
                }
            }
        }
    };

    const handleUnitChange = (newUnit) => {
        // Convert width and height from old unit to new unit
        const factor = UNIT_TO_MM[unit] / UNIT_TO_MM[newUnit];
        setWidth(parseFloat((width * factor).toFixed(2)));
        setHeight(parseFloat((height * factor).toFixed(2)));
        setUnit(newUnit);
    };

    const handleOrientationChange = (newOri) => {
        if (newOri !== orientation) {
            const w = width;
            setWidth(height);
            setHeight(w);
            setOrientation(newOri);
        }
    };

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            if (width <= 0 || height <= 0 || pageCount <= 0) {
                alert("Invalid dimensions or page count.");
                setIsCreating(false);
                return;
            }

            // Convert to points for jsPDF if needed, or pass unit
            // jsPDF supports mm, cm, in, pt.

            const doc = new jsPDF({
                orientation: width > height ? 'l' : 'p',
                unit: unit,
                format: [width, height]
            });

            for (let i = 1; i < pageCount; i++) {
                doc.addPage([width, height], width > height ? 'l' : 'p');
            }

            const blob = doc.output('blob');
            const file = new File([blob], "new_document.pdf", { type: "application/pdf" });

            const pdfDoc = await loadPDF(file);
            onCreated(pdfDoc);
            onClose();

        } catch (e) {
            console.error("Failed to create PDF", e);
            alert("Error creating PDF: " + e.message);
        } finally {
            setIsCreating(false);
        }
    };

    const templateOptions = [
        { value: 'Custom', label: 'Custom' },
        ...TEMPLATES.map(t => ({ value: t.name, label: t.name }))
    ];

    const unitOptions = [
        { value: 'mm', label: 'Millimeters (mm)' },
        { value: 'cm', label: 'Centimeters (cm)' },
        { value: 'in', label: 'Inches (in)' },
        { value: 'pt', label: 'Points (pt)' },
    ];

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-6 w-[400px] flex flex-col gap-6" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center gap-3 border-b border-[var(--border-color)] pb-4">
                    <div className="p-2 bg-[var(--primary-color)] rounded-lg text-white">
                        <FileText size={20} />
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">New PDF</h2>
                    <button onClick={onClose} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <div className="flex flex-col gap-4">

                    {/* Template */}
                    <div className="flex flex-col gap-1.5 z-30">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">Template</label>
                        <CustomSelect
                            options={templateOptions}
                            value={template}
                            onChange={handleTemplateChange}
                        />
                    </div>

                    {/* Dimensions & Unit */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-[var(--text-secondary)]">Width</label>
                            <input
                                type="number"
                                value={width}
                                onChange={e => { setWidth(Number(e.target.value)); setTemplate('Custom'); }}
                                className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary-color)] h-9 transition-colors"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-[var(--text-secondary)]">Height</label>
                            <input
                                type="number"
                                value={height}
                                onChange={e => { setHeight(Number(e.target.value)); setTemplate('Custom'); }}
                                className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary-color)] h-9 transition-colors"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 z-20">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-[var(--text-secondary)]">Unit</label>
                            <CustomSelect
                                options={unitOptions}
                                value={unit}
                                onChange={handleUnitChange}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-[var(--text-secondary)]">Pages</label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={pageCount}
                                onChange={e => setPageCount(Math.max(1, parseInt(e.target.value) || 1))}
                                className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary-color)] h-9 transition-colors"
                            />
                        </div>
                    </div>

                    {/* Orientation */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">Orientation</label>
                        <div className="flex bg-[var(--bg-primary)] rounded-md border border-[var(--border-color)] p-1">
                            <button
                                onClick={() => handleOrientationChange('portrait')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${orientation === 'portrait' ? 'bg-[var(--primary-color)] text-[var(--text-active)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:shadow-sm'}`}
                            >
                                Portrait
                            </button>
                            <button
                                onClick={() => handleOrientationChange('landscape')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${orientation === 'landscape' ? 'bg-[var(--primary-color)] text-[var(--text-active)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:shadow-sm'}`}
                            >
                                Landscape
                            </button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 mt-2 border-t border-[var(--border-color)] pt-4 z-10">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-primary)] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] rounded-md transition-colors h-10 shadow-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={isCreating}
                        className="px-6 py-2 text-sm font-semibold bg-[var(--primary-color)] text-[var(--text-active)] hover:opacity-90 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 h-10"
                    >
                        {isCreating ? 'Creating...' : 'Create PDF'}
                    </button>
                </div>

            </div>
        </div>
    );
};

export default NewPDFDialog;
