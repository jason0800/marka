import React, { useRef, useState } from 'react';
import { FileUp, Plus, FileText, FolderOpen, Ruler, Scale, ShieldCheck, Layers } from 'lucide-react';
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

                    // Validate if the user selected the correct PDF
                    if (validPdfFile && projectData.pdfFileName && validPdfFile.name !== projectData.pdfFileName) {
                        const mismatchMessage = `Warning: You selected "${validPdfFile.name}" but this project was created with "${projectData.pdfFileName}".\n\nAnnotations may not align correctly. Continue anyway?`;
                        if (!(await confirmToast(mismatchMessage, 'Continue', 'Cancel'))) {
                            setIsLoading(false);
                            return; // User cancelled
                        }
                    }
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
        const pdfFiles = files.filter(f => f.name.endsWith('.pdf') || f.type === 'application/pdf');

        if (markaFile && pdfFiles.length > 1) {
            toast.error('Multiple PDF files dropped. Please drop only one PDF with the project file.');
            return;
        }

        const pdfFile = pdfFiles[0];

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
                toast.error('Please select the PDF file as well to open the project.');
            } else if (err.message !== 'User cancelled') {
                console.error("Failed to load project", err);
                toast.error("Failed to load project: " + err.message);
            }
            setIsLoading(false);
        }
    };

    return (
        <div
            className={`w-full h-full overflow-y-auto flex flex-col items-center bg-[var(--bg-color)] text-[var(--text-primary)] transition-colors duration-200 ${isDragging ? 'bg-[var(--bg-hover)]' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="flex flex-col items-center gap-10 p-8 max-w-2xl w-full pt-16">
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
                        <div className="p-1 rounded-full bg-[var(--bg-color)] transition-colors">
                            <FolderOpen size={20} />
                        </div>
                        <span className="font-semibold text-sm">Open Project</span>
                    </button>

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="group flex flex-row items-center justify-center gap-1 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-1 rounded-full bg-[var(--bg-color)] transition-colors">
                            <FileUp size={20} />
                        </div>
                        <span className="font-semibold text-sm">Open PDF</span>
                    </button>

                    <button
                        onClick={onNewPDF}
                        className="group flex flex-row items-center justify-center gap-1 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200"
                    >
                        <div className="p-1 rounded-full bg-[var(--bg-color)] transition-colors">
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

            {/* Separator */}
            <div className="w-full max-w-[600px] border-t border-[var(--border-color)] my-8"></div>

            {/* Features & Marketing Semantic Section */}
            <section className="w-full max-w-4xl flex flex-col gap-12 mt-4 mb-16 px-6 text-left">
                {/* Section Title */}
                <div className="text-center flex flex-col gap-2">
                    <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                        Professional PDF Markup & Construction Takeoff
                    </h2>
                    <p className="text-[var(--text-secondary)] text-sm max-w-xl mx-auto">
                        Marka is engineered for architects, estimators, contractors, and design professionals who need fast, accurate, and secure PDF tools.
                    </p>
                </div>

                {/* Feature Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <article className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200 flex gap-4">
                        <div className="p-3 rounded-lg bg-[var(--bg-color)] text-[var(--primary-color)] h-fit">
                            <Scale size={24} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Precision Calibration</h3>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Calibrate technical drawings and construction blueprints by drawing a line over a known dimension. Set scales in metric or imperial.
                            </p>
                        </div>
                    </article>

                    <article className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200 flex gap-4">
                        <div className="p-3 rounded-lg bg-[var(--bg-color)] text-[var(--primary-color)] h-fit">
                            <Ruler size={24} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Takeoff Measurements</h3>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Calculate linear lengths, total perimeters, and polygon areas. Tally elements and objects quickly with the visual count tool.
                            </p>
                        </div>
                    </article>

                    <article className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200 flex gap-4">
                        <div className="p-3 rounded-lg bg-[var(--bg-color)] text-[var(--primary-color)] h-fit">
                            <Layers size={24} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Advanced Annotation</h3>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Draw rectangles, circles, arrows, and lines. Customize fill opacity, borders, dashed patterns, rotation angles, and add text comments.
                            </p>
                        </div>
                    </article>

                    <article className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-200 flex gap-4">
                        <div className="p-3 rounded-lg bg-[var(--bg-color)] text-[var(--primary-color)] h-fit">
                            <ShieldCheck size={24} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold text-[var(--text-primary)]">100% Secure & Local</h3>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Your drawings never leave your device. All parsing, rendering, and calculation happen client-side in the browser for maximum confidentiality.
                            </p>
                        </div>
                    </article>
                </div>

                {/* Frequently Asked Questions (FAQ) */}
                <div className="flex flex-col gap-6 mt-4">
                    <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)] text-center">
                        Frequently Asked Questions
                    </h2>
                    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
                        <details className="group p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                                <span className="font-semibold text-[var(--text-primary)] pr-4">How does blueprint scale calibration work?</span>
                                <span className="transition-transform duration-200 group-open:rotate-180 text-[var(--text-secondary)]">
                                    <span className="group-open:hidden">+</span>
                                    <span className="hidden group-open:inline font-bold">-</span>
                                </span>
                            </summary>
                            <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-color)]/50 pt-3">
                                Upload your drawing, select the calibration tool, draw a line between two points with a known distance (like a dimension line or grid line), and enter its actual value (e.g. 5 meters or 10 feet). Once set, all measurements you draw will automatically use this scale ratio.
                            </p>
                        </details>

                        <details className="group p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                                <span className="font-semibold text-[var(--text-primary)] pr-4">What dimensions and templates are supported?</span>
                                <span className="transition-transform duration-200 group-open:rotate-180 text-[var(--text-secondary)]">
                                    <span className="group-open:hidden">+</span>
                                    <span className="hidden group-open:inline font-bold">-</span>
                                </span>
                            </summary>
                            <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-color)]/50 pt-3">
                                You can create new blank PDF canvases with standard ISO dimensions (A0 to A5, B0 to B5, C0 to C5), US formats (Letter, Legal), or specify custom dimensions in millimeters, centimeters, inches, or points.
                            </p>
                        </details>

                        <details className="group p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                                <span className="font-semibold text-[var(--text-primary)] pr-4">Are my files uploaded to a server?</span>
                                <span className="transition-transform duration-200 group-open:rotate-180 text-[var(--text-secondary)]">
                                    <span className="group-open:hidden">+</span>
                                    <span className="hidden group-open:inline font-bold">-</span>
                                </span>
                            </summary>
                            <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed border-t border-[var(--border-color)]/50 pt-3">
                                No. Marka respects your privacy. All documents are loaded and processed locally inside your web browser. Nothing is ever sent to our servers, keeping your sensitive proprietary designs fully confidential.
                            </p>
                        </details>
                    </div>
                </div>
            </section>

            {/* Footer / Version */}
            <div className="mb-6 text-xs text-[var(--text-tertiary)]">
                Version 1.0.0
            </div>
        </div>
    );
};

export default StartupPage;
