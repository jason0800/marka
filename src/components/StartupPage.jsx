import React, { useRef, useState } from 'react';
import { FileUp, Plus, FileText } from 'lucide-react';
import { loadPDF } from '../services/pdf-service';

const StartupPage = ({ setPdfDocument, setIsLoading }) => {
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);

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

    const handleNewProject = () => {
        if (confirm("Start a new project?")) {
            window.location.reload();
        }
    };

    return (
        <div
            className={`w-full h-full flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-200 ${isDragging ? 'bg-[var(--bg-hover)]' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="flex flex-col items-center gap-8 p-12 max-w-2xl w-full">
                {/* Logo / Header */}
                <div className="flex flex-col items-center gap-2 mb-8">
                    <div className="w-16 h-16 bg-[var(--primary-color)] rounded-2xl flex items-center justify-center shadow-lg mb-4">
                        <FileText size={32} className="text-white" />
                    </div>
                    <h1 className="text-4xl font-bold tracking-tight">Marka</h1>
                    <p className="text-[var(--text-secondary)] text-lg">PDF Annotation & Measurement Tool</p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="group flex flex-col items-center justify-center gap-4 p-8 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-4 rounded-full bg-[var(--bg-primary)] group-hover:bg-[var(--primary-color)] group-hover:text-white transition-colors">
                            <FileUp size={24} />
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="font-semibold text-lg">Open PDF</span>
                            <span className="text-sm text-[var(--text-secondary)]">From your computer</span>
                        </div>
                    </button>

                    <button
                        onClick={handleNewProject}
                        className="group flex flex-col items-center justify-center gap-4 p-8 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-4 rounded-full bg-[var(--bg-primary)] group-hover:bg-[var(--primary-color)] group-hover:text-white transition-colors">
                            <Plus size={24} />
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="font-semibold text-lg">New Project</span>
                            <span className="text-sm text-[var(--text-secondary)]">Start fresh</span>
                        </div>
                    </button>
                </div>

                {/* Drop Zone Hint */}
                <div className="mt-8 p-8 border-2 border-dashed border-[var(--border-color)] rounded-xl w-full flex items-center justify-center text-[var(--text-secondary)] bg-[var(--bg-secondary)]/50">
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
