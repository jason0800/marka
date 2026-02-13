import React from 'react';
import { toast } from 'sonner';

export const confirmToast = (message, confirmText = 'Yes', cancelText = 'No') => {
    return new Promise((resolve) => {
        toast.custom((t) => (
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4 rounded-lg shadow-xl flex flex-col gap-3 min-w-[300px]">
                <p className="text-sm font-medium text-[var(--text-primary)] whitespace-pre-line">
                    {message}
                </p>
                <div className="flex gap-2 justify-end">
                    <button
                        onClick={() => {
                            toast.dismiss(t);
                            resolve(false);
                        }}
                        className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--btn-hover)] rounded-md transition-colors border border-transparent hover:border-[var(--border-color)]"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={() => {
                            toast.dismiss(t);
                            resolve(true);
                        }}
                        className="px-3 py-1.5 text-sm font-medium text-[#1a1a1a] bg-[var(--primary-color)] hover:brightness-105 rounded-md transition-all shadow-sm"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        ), {
            duration: Infinity,
            onDismiss: () => resolve(false),
        });
    });
};
