import React, { useRef, useState } from 'react';
import { FileUp, Plus, FileText, FolderOpen } from 'lucide-react';
import { loadPDF } from '../services/pdf-service';
import { toast } from 'sonner';
import { confirmToast } from '../utils/confirm-toast';
import { loadProject, promptForProjectFiles, promptForPDF } from '../services/project-service';
import useAppStore from '../stores/useAppStore';

const StartupPage = ({ setPdfDocument, setIsLoading, onNewPDF }) => {
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const setFileInfo = useAppStore(state => state.setFileInfo);
    const setProjectData = useAppStore(state => state.setProjectData);

    const handleFileChange = async (file) => {
        if (!file) return;

        // Basic validation
        if (file.type !== 'application/pdf') {
            toast.error('Please select a valid PDF file.');
            return;
        }

        setIsLoading(true);
        try {
            const doc = await loadPDF(file);
            setPdfDocument(doc);
            setFileInfo(file.name, file.size);
        } catch (err) {
            console.error("Failed to load PDF", err);
            toast.error("Failed to load PDF");
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

    const processProjectFiles = async (markaFile, pdfFile) => {
        setIsLoading(true); // Start loading indicator early
        try {
            // Load and parse the .marka file
            const projectData = await loadProject(markaFile);

            // If we don't have a PDF file yet (e.g. dropped only .marka), we need to check matches or prompt
            let validPdfFile = pdfFile;

            // If PDF file is provided, validate it matches
            if (validPdfFile && projectData.pdfFileName && validPdfFile.name !== projectData.pdfFileName) {
                const mismatchMessage = `Warning: You selected "${validPdfFile.name}" but this project was created with "${projectData.pdfFileName}".\n\nAnnotations may not align correctly. Continue anyway?`;
                if (!(await confirmToast(mismatchMessage, 'Continue', 'Cancel'))) {
                    setIsLoading(false);
                    return; // User cancelled
                }
            }

            // If no PDF provided, or validation failed and user wants to pick another? 
            // Actually if validation failed and user cancelled, we returned.
            // If we didn't have a PDF file, we need to prompt for it now.
            if (!validPdfFile) {
                // Let's implement a specific prompt for PDF here if missing
                const pdfFileName = projectData.pdfFileName || 'the PDF';
                const confirmMessage = `This project requires "${pdfFileName}". Please locate the PDF file.`;

                // Use confirmToast instead of confirm
                if (!(await confirmToast(confirmMessage, 'Locate PDF', 'Cancel'))) {
                    setIsLoading(false);
                    return;
                }

                try {
                    validPdfFile = await promptForPDF(pdfFileName);
                } catch (e) {
                    setIsLoading(false);
                    return; // Cancelled
                }
            }

            // Load the PDF first
            const doc = await loadPDF(validPdfFile);
            setPdfDocument(doc); // setPdfDocument takes only the doc, file info is set separately
            setFileInfo(validPdfFile.name, validPdfFile.size);

            // Then apply the project data (annotations, calibrations, etc.)
            setProjectData(projectData);

            toast.success('Project loaded successfully');

        } catch (err) {
            console.error("Failed to load project", err);
            toast.error("Failed to load project: " + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        // Check for .marka and .pdf pair
        const markaFile = files.find(f => f.name.endsWith('.marka') || f.name.endsWith('.json'));
        const pdfFile = files.find(f => f.name.endsWith('.pdf') || f.type === 'application/pdf');

        if (markaFile) {
            // Found a project file, try to process it (with or without PDF)
            await processProjectFiles(markaFile, pdfFile);
        } else if (pdfFile) {
            // Only PDF found
            handleFileChange(pdfFile);
        }
    };

    const handleOpenProject = async () => {
        try {
            // Prompt user to select both .marka and PDF files at once
            const result = await promptForProjectFiles();
            await processProjectFiles(result.markaFile, result.pdfFile);
        } catch (err) {
            if (err.message === 'NEED_PDF') {
                toast.error('Please select the PDF file as well, or use the file picker to select both files at once.');
            } else if (err.message !== 'User cancelled') {
                console.error("Failed to load project", err);
                toast.error("Failed to load project: " + err.message);
            }
            setIsLoading(false);
        }
    };

    return (
        <div
            className={`w-full h-full flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-200 ${isDragging ? 'bg-[var(--bg-hover)]' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="flex flex-col items-center gap-10 p-8 max-w-2xl w-full -translate-y-12">
                {/* Logo / Header */}
                <div className="flex flex-col items-center gap-2">
                    <img src="/marka-icon.png" alt="Marka Logo" className="w-40 h-40 mb-2" />
                    <h1 className="text-4xl font-bold tracking-tight">Marka</h1>
                    <p className="text-[var(--text-secondary)] text-lg">Web-Based PDF Markup & Measurement Tool</p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-[600px]">
                    <button
                        onClick={handleOpenProject}
                        className="group flex flex-row items-center justify-center gap-1 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-1 rounded-full bg-[var(--bg-primary)] transition-colors">
                            <FolderOpen size={20} />
                        </div>
                        <span className="font-semibold text-sm">Open Project</span>
                    </button>

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
                <div className="p-6 border-2 border-dashed border-[var(--border-color)] rounded-xl w-full max-w-[600px] flex items-center justify-center text-[var(--text-secondary)] bg-[var(--bg-secondary)]/50">
                    <p>or drag and drop Marka projects or PDF files anywhere</p>
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
