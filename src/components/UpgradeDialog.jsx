import React from 'react';
import { X, Lock } from 'lucide-react';

const UpgradeDialog = ({ onClose }) => {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl w-[400px] p-6 relative flex flex-col items-center text-center">

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer"
                >
                    <X size={20} />
                </button>

                <div className="bg-amber-500/20 p-4 rounded-full mb-4">
                    <Lock size={32} className="text-amber-500" />
                </div>

                <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
                    Unlock Premium Features
                </h2>

                <p className="text-[var(--text-secondary)] mb-6 leading-relaxed">
                    Saving and opening editable project files (.marka) is a Premium feature.
                    Free users can only export flattened PDFs.
                </p>

                <button
                    className="bg-amber-500 hover:bg-amber-600 text-black font-semibold py-3 px-8 rounded-md border-none cursor-pointer transition-colors w-full"
                    onClick={() => alert("This would open the Stripe checkout flow.")}
                >
                    Upgrade to Pro
                </button>

                <p className="text-xs text-[var(--text-secondary)] mt-4">
                    Already have an account? <span className="text-amber-500 cursor-pointer hover:underline">Log in</span>
                </p>
            </div>
        </div>
    );
};

export default UpgradeDialog;
