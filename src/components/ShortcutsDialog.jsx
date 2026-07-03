import { X, RotateCcw } from 'lucide-react';
import useAppStore from '../stores/useAppStore';
import { useState, useEffect } from 'react';

const TOOL_LABELS = {
    select: 'Select Tool',
    pan: 'Pan Tool',
    calibrate: 'Set Scale (Calibration)',
    length: 'Length Measurement',
    area: 'Area Measurement',
    count: 'Count Tool',
    callout: 'Callout (Text + Leader)',
    text: 'Text Box',
    rectangle: 'Rectangle Shape',
    circle: 'Ellipse / Circle Shape',
    line: 'Line Shape',
    arrow: 'Arrow Shape',
};

const ShortcutsDialog = ({ onClose }) => {
    const { shortcuts, updateShortcut, resetShortcuts } = useAppStore();
    const [listeningId, setListeningId] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        if (!listeningId) return;

        const handleKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
                setListeningId(null);
                setErrorMsg('');
                return;
            }

            // Accept standard alphanumeric keys and single character symbols
            const key = e.key.toLowerCase();
            if (key.length !== 1 || key === ' ') {
                setErrorMsg('Invalid key. Please press a single letter or number.');
                return;
            }

            // Check if this key is already assigned to another tool
            const duplicateToolId = Object.keys(shortcuts).find(
                (id) => id !== listeningId && shortcuts[id] === key
            );

            if (duplicateToolId) {
                setErrorMsg(
                    `Key "${key.toUpperCase()}" is already assigned to ${TOOL_LABELS[duplicateToolId] || duplicateToolId}.`
                );
                return;
            }

            updateShortcut(listeningId, key);
            setListeningId(null);
            setErrorMsg('');
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [listeningId, shortcuts, updateShortcut]);

    const handleReset = () => {
        resetShortcuts();
        setErrorMsg('');
        setListeningId(null);
    };

    return (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center z-[9999] animate-fade-in">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-[450px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] m-0">Keyboard Shortcuts</h3>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-md hover:bg-[var(--btn-hover)] flex items-center justify-center"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
                    <p className="text-xs text-[var(--text-secondary)] m-0 leading-normal">
                        Click on a shortcut keycap below, then press any letter or number key to rebind that shortcut.
                    </p>

                    {errorMsg && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs px-3 py-2.5 rounded-lg font-medium leading-normal animate-shake">
                            {errorMsg}
                        </div>
                    )}

                    <div className="flex flex-col gap-1 border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--bg-color)]/25">
                        {Object.entries(shortcuts).map(([toolId, key]) => {
                            const isListening = listeningId === toolId;
                            return (
                                <div
                                    key={toolId}
                                    className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--btn-hover)]/30 transition-colors duration-150"
                                >
                                    <span className="text-sm font-medium text-[var(--text-primary)]">
                                        {TOOL_LABELS[toolId] || toolId}
                                    </span>
                                    <button
                                        onClick={() => {
                                            setListeningId(toolId);
                                            setErrorMsg('');
                                        }}
                                        className={`min-w-[48px] h-[30px] rounded border flex items-center justify-center font-mono text-xs font-semibold uppercase shadow-sm cursor-pointer transition-all duration-200 ${
                                            isListening
                                                ? 'bg-[var(--primary-color)] text-[var(--text-active)] border-[var(--primary-color)] animate-pulse'
                                                : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--btn-hover)]'
                                        }`}
                                    >
                                        {isListening ? '...' : key}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[var(--border-color)] bg-[var(--bg-color)]/30 flex items-center justify-between gap-3 shrink-0">
                    <button
                        onClick={handleReset}
                        className="bg-transparent border border-[var(--border-color)] text-[var(--text-primary)] px-3 py-2 rounded-md hover:bg-[var(--btn-hover)] text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                        <RotateCcw size={14} />
                        Reset Defaults
                    </button>
                    <button
                        onClick={onClose}
                        className="bg-[var(--primary-color)] border-none text-[var(--text-active)] px-4 py-2 rounded-md hover:opacity-90 text-xs font-semibold shadow-sm transition-opacity"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShortcutsDialog;
