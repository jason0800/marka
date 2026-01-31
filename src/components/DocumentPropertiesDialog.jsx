import React, { useEffect, useState } from 'react';
import { X, FileText, Calendar, User, Tag } from 'lucide-react';

const DocumentPropertiesDialog = ({ document, onClose, fileName, fileSize }) => {
    const [metadata, setMetadata] = useState(null);
    const [pageSize, setPageSize] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!document) return;

        const fetchMetadata = async () => {
            try {
                const data = await document.getMetadata();
                setMetadata(data);

                if (document.numPages > 0) {
                    const page = await document.getPage(1);
                    const vp = page.getViewport({ scale: 1 });
                    // Convert points to mm (1 pt = 1/72 inch, 1 inch = 25.4 mm)
                    const w_mm = (vp.width / 72) * 25.4;
                    const h_mm = (vp.height / 72) * 25.4;
                    setPageSize({
                        width: Math.round(w_mm),
                        height: Math.round(h_mm),
                        widthPt: Math.round(vp.width),
                        heightPt: Math.round(vp.height)
                    });
                }

            } catch (err) {
                console.error("Failed to get metadata", err);
            } finally {
                setLoading(false);
            }
        };

        fetchMetadata();
    }, [document]);

    if (!document) return null;

    const info = metadata?.info || {};

    // Helper to format date strings from PDF (D:20230101...)
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        // Basic parsing for "D:YYYYMMDD..."
        if (dateStr.startsWith('D:')) {
            const year = dateStr.substring(2, 6);
            const month = dateStr.substring(6, 8);
            const day = dateStr.substring(8, 10);
            const hour = dateStr.substring(10, 12);
            const min = dateStr.substring(12, 14);
            return `${year}-${month}-${day} ${hour}:${min}`;
        }
        return dateStr;
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return '-';
        if (bytes === 0) return 'Unknown';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
                    <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                        <FileText size={16} className="text-[var(--primary-color)]" />
                        Document Properties
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="text-center py-8 text-[var(--text-secondary)]">Loading metadata...</div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-[100px_1fr] gap-y-3 gap-x-4 text-sm">
                                <span className="text-[var(--text-secondary)]">File Name</span>
                                <span className="text-[var(--text-primary)] font-medium truncate" title={fileName}>{fileName || "Untitled"}</span>

                                <span className="text-[var(--text-secondary)]">File Size</span>
                                <span className="text-[var(--text-primary)]">{formatFileSize(fileSize)}</span>

                                <span className="text-[var(--text-secondary)]">Page Size</span>
                                <span className="text-[var(--text-primary)]">
                                    {pageSize ? `${pageSize.width} x ${pageSize.height} mm` : "-"}
                                </span>

                                <span className="text-[var(--text-secondary)]">Page Count</span>
                                <span className="text-[var(--text-primary)]">{document.numPages}</span>

                                <div className="col-span-2 h-px bg-[var(--border-color)] my-2" />

                                <span className="text-[var(--text-secondary)]">Title</span>
                                <span className="text-[var(--text-primary)]">{info.Title || "-"}</span>

                                <span className="text-[var(--text-secondary)]">Author</span>
                                <span className="text-[var(--text-primary)]">{info.Author || "-"}</span>

                                <span className="text-[var(--text-secondary)]">Application</span>
                                <span className="text-[var(--text-primary)]">{info.Creator || "-"}</span>

                                <span className="text-[var(--text-secondary)]">Producer</span>
                                <span className="text-[var(--text-primary)]">{info.Producer || "-"}</span>

                                <span className="text-[var(--text-secondary)]">Created</span>
                                <span className="text-[var(--text-primary)]">{formatDate(info.CreationDate)}</span>

                                <span className="text-[var(--text-secondary)]">Modified</span>
                                <span className="text-[var(--text-primary)]">{formatDate(info.ModDate)}</span>

                                <span className="text-[var(--text-secondary)]">PDF Version</span>
                                <span className="text-[var(--text-primary)]">{info.PDFFormatVersion || "-"}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-[var(--border-color)] bg-[var(--bg-tertiary)] flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-[var(--bg-color)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded text-xs font-medium text-[var(--text-primary)] transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DocumentPropertiesDialog;
