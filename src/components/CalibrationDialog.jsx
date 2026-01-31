import React, { useState, useRef, useEffect } from 'react';
import { X, Scaling, ChevronDown, Check } from 'lucide-react';
import useAppStore from '../stores/useAppStore';

const PRESETS = [
    { label: '1:1', paper: 1, paperUnit: 'mm', real: 1, realUnit: 'mm' },
    { label: '1:10', paper: 1, paperUnit: 'mm', real: 10, realUnit: 'mm' },
    { label: '1:20', paper: 1, paperUnit: 'mm', real: 20, realUnit: 'mm' },
    { label: '1:50', paper: 1, paperUnit: 'mm', real: 50, realUnit: 'mm' },
    { label: '1:100', paper: 1, paperUnit: 'mm', real: 100, realUnit: 'mm' },
    { label: '1:200', paper: 1, paperUnit: 'mm', real: 200, realUnit: 'mm' },
    { label: '1:500', paper: 1, paperUnit: 'mm', real: 500, realUnit: 'mm' },
    { label: '1:1000', paper: 1, paperUnit: 'mm', real: 1, realUnit: 'm' },
];

const UNIT_TO_PTS = {
    mm: 2.83465,
    cm: 28.3465,
    in: 72,
    pt: 1,
    m: 2834.65,
    km: 2834650,
    ft: 864,
    yd: 2592,
    mi: 4561920,
};

const CustomSelect = ({ value, onChange, options, placeholder, className }) => {
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
        <div className={`relative ${className}`} ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md px-3 text-sm text-[var(--text-primary)] flex items-center justify-between focus:outline-none focus:border-[var(--primary-color)] hover:border-[var(--primary-color)] transition-colors"
                style={{ height: '100%' }}
            >
                <span className="truncate">{selectedLabel}</span>
                <ChevronDown size={14} className="text-[var(--text-secondary)]" />
            </button>

            {isOpen && (
                <div
                    className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-xl z-50 max-h-[300px] overflow-y-scroll"
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

const CalibrationDialog = ({ onClose }) => {
    const { currentPage, setPageScale, pdfDocument } = useAppStore();

    // State
    const [mode, setMode] = useState('preset'); // 'preset' | 'custom'
    const [selectedPreset, setSelectedPreset] = useState(0);

    const [paperVal, setPaperVal] = useState(1);
    const [paperUnit, setPaperUnit] = useState('mm');
    const [realVal, setRealVal] = useState(100);
    const [realUnit, setRealUnit] = useState('mm');

    const [scope, setScope] = useState('current'); // 'current', 'all', 'range'
    const [pageRange, setPageRange] = useState('');

    // Update custom inputs when preset changes
    useEffect(() => {
        if (mode === 'preset') {
            const preset = PRESETS[selectedPreset];
            if (preset) {
                setPaperVal(preset.paper);
                setPaperUnit(preset.paperUnit);
                setRealVal(preset.real);
                setRealUnit(preset.realUnit);
            }
        }
    }, [mode, selectedPreset]);

    const handleApply = () => {
        // Calculate Pixels Per Real Unit
        // Scale = (PaperDistance * PtsPerPaperUnit) / RealDistance
        const ptsPerPaper = UNIT_TO_PTS[paperUnit];
        const pixels = paperVal * ptsPerPaper;
        const scale = pixels / realVal; // Pixels per Real Unit

        const totalPages = pdfDocument ? pdfDocument.numPages : 1;
        let pagesToApply = [];

        if (scope === 'current') {
            pagesToApply = [currentPage];
        } else if (scope === 'all') {
            pagesToApply = Array.from({ length: totalPages }, (_, i) => i + 1);
        } else if (scope === 'range') {
            // Parse range "1-5, 8"
            const parts = pageRange.split(',');
            parts.forEach(part => {
                const [start, end] = part.split('-').map(s => parseInt(s.trim()));
                if (!isNaN(start)) {
                    if (!isNaN(end)) {
                        for (let i = start; i <= end; i++) {
                            if (i >= 1 && i <= totalPages) pagesToApply.push(i);
                        }
                    } else {
                        if (start >= 1 && start <= totalPages) pagesToApply.push(start);
                    }
                }
            });
        }

        // Apply
        pagesToApply.forEach(pageIndex => {
            setPageScale(pageIndex, scale, realUnit);
        });

        onClose();
    };

    const presetOptions = PRESETS.map((p, i) => ({ value: i, label: p.label }));

    const unitOptionsPaper = [
        { value: 'mm', label: 'mm' },
        { value: 'cm', label: 'cm' },
        { value: 'in', label: 'in' },
    ];

    const unitOptionsReal = [
        { value: 'mm', label: 'mm' },
        { value: 'cm', label: 'cm' },
        { value: 'm', label: 'm' },
        { value: 'km', label: 'km' },
        { value: 'in', label: 'in' },
        { value: 'ft', label: 'ft' },
        { value: 'yd', label: 'yd' },
        { value: 'mi', label: 'mi' },
    ];

    const CustomRadio = ({ label, value, checked, onChange, children }) => (
        <label className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${checked ? 'bg-[var(--primary-color)]/10' : 'hover:bg-[var(--bg-hover)]'}`}>
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${checked ? 'border-[var(--primary-color)] bg-[var(--primary-color)]' : 'border-[var(--text-secondary)]'}`}>
                {checked && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
            <input type="radio" className="hidden" value={value} checked={checked} onChange={onChange} />
            <span className={`text-sm ${checked ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{label}</span>
            {children}
        </label>
    );

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-5 w-[450px] flex flex-col gap-4" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--primary-color)] rounded-lg text-white">
                            <Scaling size={20} />
                        </div>
                        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Set Scale</h2>
                    </div>
                    <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex flex-col gap-3">

                    {/* Method Toggle */}
                    <div className="flex bg-[var(--bg-primary)] p-1 rounded-lg border border-[var(--border-color)]">
                        <button
                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'preset' ? 'bg-[var(--primary-color)] text-[var(--text-active)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                            onClick={() => setMode('preset')}
                        >
                            Preset
                        </button>
                        <button
                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${mode === 'custom' ? 'bg-[var(--primary-color)] text-[var(--text-active)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                            onClick={() => setMode('custom')}
                        >
                            Custom
                        </button>
                    </div>

                    <div className="h-[140px] flex flex-col">
                        {mode === 'preset' ? (
                            <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                <label className="text-sm font-medium text-[var(--text-secondary)]">Select Preset</label>
                                <CustomSelect
                                    className="h-11"
                                    options={presetOptions}
                                    value={selectedPreset}
                                    onChange={(val) => setSelectedPreset(val)}
                                />
                            </div>
                        ) : (
                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                <label className="text-sm font-medium text-[var(--text-secondary)] block mb-2">Custom Scale</label>
                                <div className={`flex flex-col gap-3 p-4 bg-[var(--bg-primary)] rounded-lg`}>
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider w-24">Drawing</span>
                                        <input
                                            type="number"
                                            value={paperVal}
                                            onChange={e => { setPaperVal(parseFloat(e.target.value) || 0); }}
                                            className="flex-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-3 py-1.5 text-sm h-9"
                                        />
                                        <CustomSelect
                                            className="w-28 h-9"
                                            options={unitOptionsPaper}
                                            value={paperUnit}
                                            onChange={val => { setPaperUnit(val); }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-center my-[-3px] text-[var(--text-secondary)] text-sm italic">is equal to</div>

                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider w-24">Real World</span>
                                        <input
                                            type="number"
                                            value={realVal}
                                            onChange={e => { setRealVal(parseFloat(e.target.value) || 0); }}
                                            className="flex-1 min-w-[80px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-3 py-1.5 text-sm h-9"
                                        />
                                        <CustomSelect
                                            className="w-28 h-9"
                                            options={unitOptionsReal}
                                            value={realUnit}
                                            onChange={val => { setRealUnit(val); }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Scope */}
                    <div className="flex flex-col gap-2 mt-8">
                        <label className="text-sm font-medium text-[var(--text-secondary)]">Apply To</label>
                        <div className="flex flex-col gap-2">
                            <CustomRadio label={`Current Page (${currentPage})`} value="current" checked={scope === 'current'} onChange={() => setScope('current')} />
                            <CustomRadio label="All Pages" value="all" checked={scope === 'all'} onChange={() => setScope('all')} />
                            <div className="h-10 relative">
                                <div className="absolute inset-x-0 top-0">
                                    <CustomRadio label="Custom Range" value="range" checked={scope === 'range'} onChange={() => setScope('range')}>
                                        {scope === 'range' && (
                                            <input
                                                type="text"
                                                placeholder="e.g. 1-5, 8"
                                                className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-2 py-1 text-sm flex-1 ml-auto w-32 focus:outline-none focus:border-[var(--primary-color)] transition-colors"
                                                value={pageRange}
                                                onChange={e => setPageRange(e.target.value)}
                                                onClick={e => e.stopPropagation()} // Prevent radio change
                                                autoFocus
                                            />
                                        )}
                                    </CustomRadio>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-primary)] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] rounded-md transition-colors h-10"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        className="px-6 py-2 text-sm font-semibold bg-[var(--primary-color)] text-[var(--text-active)] hover:opacity-90 rounded-lg transition-all h-10"
                    >
                        Apply Scale
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CalibrationDialog;
