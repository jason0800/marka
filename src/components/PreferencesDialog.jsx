import React from 'react';
import { X, Sun, Moon } from 'lucide-react';
import useAppStore from '../stores/useAppStore';

const PreferencesDialog = ({ onClose }) => {
    const { theme, setTheme } = useAppStore();

    return (
        <div 
            className="fixed inset-0 bg-transparent flex items-center justify-center z-[9999] pointer-events-none"
            onClick={onClose}
        >
            <div 
                className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-[380px] shadow-2xl p-5 pointer-events-auto animate-scale-up flex flex-col gap-4"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
                    <h3 className="text-base font-semibold text-[var(--text-primary)] m-0">Preferences</h3>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-md hover:bg-[var(--btn-hover)] flex items-center justify-center cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Theme Setting */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">Appearance Theme</label>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setTheme('light')}
                            className={`flex-1 h-9 rounded-lg border flex items-center justify-center gap-2 text-xs font-medium cursor-pointer transition-all duration-150 ${
                                theme === 'light'
                                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[var(--text-active)]'
                                    : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--btn-hover)]'
                            }`}
                        >
                            <Sun size={14} />
                            Light
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={`flex-1 h-9 rounded-lg border flex items-center justify-center gap-2 text-xs font-medium cursor-pointer transition-all duration-150 ${
                                theme === 'dark'
                                    ? 'bg-[var(--primary-color)] border-[var(--primary-color)] text-[var(--text-active)]'
                                    : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--btn-hover)]'
                            }`}
                        >
                            <Moon size={14} />
                            Dark
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="pt-3 border-t border-[var(--border-color)] flex justify-end">
                    <button
                        onClick={onClose}
                        className="bg-[var(--primary-color)] border-none text-[var(--text-active)] px-4 py-2 rounded-md hover:opacity-90 text-xs font-semibold shadow-sm cursor-pointer"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PreferencesDialog;
