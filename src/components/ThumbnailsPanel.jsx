import React, { useEffect, useRef } from 'react';
import useAppStore from '../stores/useAppStore';
import PDFThumbnail from './PDFThumbnail';

const ThumbnailsPanel = ({ pdfDocument }) => {
    const { currentPage, setCurrentPage } = useAppStore();
    const scrollRef = useRef(null);

    // Scroll to active thumbnail on first load or when page changes?
    // Maybe better to just let user scroll. Auto-scrolling might be annoying if user is browsing thumbnails.
    // But initial scroll to current page is good.

    useEffect(() => {
        if (scrollRef.current) {
            const activeThumb = scrollRef.current.querySelector(`[data-page="${currentPage}"]`);
            if (activeThumb) {
                activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [currentPage]); // Re-runs when current page changes. Maybe too aggressive?

    if (!pdfDocument) return (
        <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <p className="text-sm">No PDF loaded</p>
        </div>
    );

    const numPages = pdfDocument.numPages;

    return (
        <div className="bg-[var(--bg-secondary)] flex flex-col text-[var(--text-primary)] h-full">
            <div className="flex justify-between items-center p-3 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <h2 className="text-sm font-semibold m-0">Thumbnails</h2>
                <span className="text-xs text-[var(--text-secondary)]">{numPages} Pages</span>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto"
            >
                {Array.from({ length: numPages }, (_, i) => {
                    const pageNum = i + 1;
                    return (
                        <div key={pageNum} data-page={pageNum}>
                            <PDFThumbnail
                                document={pdfDocument}
                                pageNumber={pageNum}
                                isActive={currentPage === pageNum}
                                onClick={() => setCurrentPage(pageNum)}
                                width={200} // Adjust based on panel width (260px - padding)
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ThumbnailsPanel;
