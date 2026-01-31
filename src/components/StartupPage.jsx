import React, { useRef, useState } from 'react';
import { FileUp, Plus, FileText } from 'lucide-react';
import { loadPDF } from '../services/pdf-service';

import useAppStore from '../stores/useAppStore';

const StartupPage = ({ setPdfDocument, setIsLoading, onNewPDF }) => {
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const setFileInfo = useAppStore(state => state.setFileInfo);

    const handleFileChange = async (file) => {
        if (!file) return;

        // Basic validation
        if (file.type !== 'application/pdf') {
            alert('Please select a valid PDF file.');
            return;
        }

        setIsLoading(true);
        try {
            const doc = await loadPDF(file);
            setPdfDocument(doc);
            setFileInfo(file.name, file.size);
        } catch (err) {
            console.error("Failed to load PDF", err);
            alert("Failed to load PDF");
        } finally {
            setIsLoading(false);
        }
    };

    const onInputChange = (e) => {
        handleFileChange(e.target.files[0]);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        handleFileChange(file);
    };

    return (
        <div
            className={`w-full h-full flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-200 ${isDragging ? 'bg-[var(--bg-hover)]' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="flex flex-col items-center gap-10 p-8 max-w-2xl w-full">
                {/* Logo / Header */}
                <div className="flex flex-col items-center gap-2">
                    <img src="/marka-icon.png" alt="Marka Logo" className="w-40 h-40 mb-2" />
                    <h1 className="text-4xl font-bold tracking-tight">Marka</h1>
                    <p className="text-[var(--text-secondary)] text-lg">Web-Based PDF Markup & Measurement Tool</p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-[400px]">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="group flex flex-row items-center justify-center gap-1 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-1 rounded-full bg-[var(--bg-primary)] transition-colors">
                            <FileUp size={20} />
                        </div>
                        <span className="font-semibold text-sm">Open PDF</span>
                    </button>

                    <button
                        onClick={onNewPDF}
                        className="group flex flex-row items-center justify-center gap-1 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-1 rounded-full bg-[var(--bg-primary)] transition-colors">
                            <Plus size={20} />
                        </div>
                        <span className="font-semibold text-sm">New PDF</span>
                    </button>
                </div>

                {/* Drop Zone Hint */}
                <div className="p-6 border-2 border-dashed border-[var(--border-color)] rounded-xl w-full max-w-[400px] flex items-center justify-center text-[var(--text-secondary)] bg-[var(--bg-secondary)]/50">
                    <p>or drag and drop a PDF file anywhere</p>
                </div>

                <input
                    type="file"
                    accept="application/pdf"
                    ref={fileInputRef}
                    onChange={onInputChange}
                    className="hidden"
                />
            </div>

            {/* Footer / Version */}
            <div className="fixed bottom-4 text-xs text-[var(--text-tertiary)]">
                Version 1.0.0
            </div>
        </div>
    );
};

export default StartupPage;
