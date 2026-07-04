import React, { useState, useRef, useEffect } from 'react';
import { X, FileText, ChevronDown, Check } from 'lucide-react';

const TEMPLATES = [
    { name: 'Letter', width: 215.9, height: 279.4, unit: 'mm' },
    { name: 'Legal', width: 215.9, height: 355.6, unit: 'mm' },
    { name: 'A0', width: 841, height: 1189, unit: 'mm' },
    { name: 'A1', width: 594, height: 841, unit: 'mm' },
    { name: 'A2', width: 420, height: 594, unit: 'mm' },
    { name: 'A3', width: 297, height: 420, unit: 'mm' },
    { name: 'A4', width: 210, height: 297, unit: 'mm' },
    { name: 'A5', width: 148, height: 210, unit: 'mm' },
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
                    className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-xl z-50 max-h-[180px] overflow-y-auto"
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

const InsertSheetDialog = ({ onClose, onConfirm }) => {
    const [template, setTemplate] = useState('A4');
    const [width, setWidth] = useState(210);
    const [height, setHeight] = useState(297);
    const [unit, setUnit] = useState('mm');
    const [orientation, setOrientation] = useState('portrait');

    const handleTemplateChange = (tName) => {
        setTemplate(tName);
        if (tName !== 'Custom') {
            const t = TEMPLATES.find(x => x.name === tName);
            if (t) {
                const scale = UNIT_TO_MM['mm'] / UNIT_TO_MM[unit];
                const toCurrent = (mmVal) => parseFloat((mmVal * scale).toFixed(3));

                setUnit(t.unit);
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

    const handleConfirm = () => {
        if (width <= 0 || height <= 0) {
            alert("Invalid dimensions.");
            return;
        }

        // Convert width & height to PDF points (1 pt = 1/72 inch)
        // 1 unit in UNIT_TO_MM is 'unit' in mm
        // 1 inch = 25.4 mm = 72 pt
        const widthMm = width * UNIT_TO_MM[unit];
        const heightMm = height * UNIT_TO_MM[unit];

        const widthPt = widthMm * (72 / 25.4);
        const heightPt = heightMm * (72 / 25.4);

        onConfirm({ width: widthPt, height: heightPt });
        onClose();
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-transparent" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-6 w-[400px] flex flex-col gap-6" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-[var(--border-color)] pb-4">
                    <div className="p-2 bg-[var(--primary-color)] rounded-lg text-white">
                        <FileText size={20} />
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">Insert Sheet</h2>
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

                    <div className="flex flex-col gap-1.5 z-20">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">Unit</label>
                        <CustomSelect
                            options={unitOptions}
                            value={unit}
                            onChange={handleUnitChange}
                        />
                    </div>

                    {/* Orientation */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">Orientation</label>
                        <div className="flex bg-[var(--bg-primary)] rounded-md border border-[var(--border-color)] p-1">
                            <button
                                onClick={() => handleOrientationChange('portrait')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${orientation === 'portrait' ? 'bg-[var(--primary-color)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
                            >
                                Portrait
                            </button>
                            <button
                                onClick={() => handleOrientationChange('landscape')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${orientation === 'landscape' ? 'bg-[var(--primary-color)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
                            >
                                Landscape
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 justify-end border-t border-[var(--border-color)] pt-4">
                    <button
                        onClick={onClose}
                        className="px-4 h-9 rounded-md text-sm border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-4 h-9 rounded-md text-sm bg-[var(--primary-color)] text-white font-medium hover:bg-[var(--primary-color)]/90 transition-colors"
                    >
                        Insert
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InsertSheetDialog;
