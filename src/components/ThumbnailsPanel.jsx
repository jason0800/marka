import React, { useEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import PDFThumbnail from './PDFThumbnail';

const ThumbnailsPanel = ({ pdfDocument }) => {
    const { currentPage, setCurrentPage, setJumpToPage } = useAppStore();
    const scrollRef = useRef(null);
    const [thumbScale, setThumbScale] = useState(1);

    // Initial scroll to active thumbnail logic
    useEffect(() => {
        if (scrollRef.current) {
            const activeThumb = scrollRef.current.querySelector(`[data-page="${currentPage}"]`);
            if (activeThumb) {
                activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, []); // Only on mount

    if (!pdfDocument) return (
        <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <p className="text-sm">No PDF loaded</p>
        </div>
    );

    const numPages = pdfDocument.numPages;
    const baseWidth = 200;
    const minWidth = 80;
    const maxWidth = 240; // max that fits comfortably or scrolls 

    // Convert 0-1 scale to width
    // Let's just use the slider value as width for simplicity
    const [sliderVal, setSliderVal] = useState(200);

    return (
        <div className="bg-[var(--bg-secondary)] flex flex-col text-[var(--text-primary)] h-full">
            <div className="flex justify-between items-center p-3 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <h2 className="text-sm font-semibold m-0">Thumbnails</h2>
                <span className="text-xs text-[var(--text-secondary)]">{numPages} Pages</span>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 p-4 flex flex-wrap justify-center content-start gap-4 overflow-y-auto"
            >
                {Array.from({ length: numPages }, (_, i) => {
                    const pageNum = i + 1;
                    return (
                        <div key={pageNum} data-page={pageNum} style={{ width: sliderVal }}>
                            <PDFThumbnail
                                document={pdfDocument}
                                pageNumber={pageNum}
                                isActive={currentPage === pageNum}
                                onSelect={(n) => setJumpToPage(n)}
                                width={sliderVal}
                            />
                        </div>
                    );
                })}
            </div>

            <div className="p-3 px-4 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-secondary)]">Small</span>
                    <input
                        type="range"
                        min={minWidth}
                        max={maxWidth}
                        value={sliderVal}
                        onChange={(e) => setSliderVal(parseInt(e.target.value))}
                        className="flex-1 h-1 bg-[var(--border-color)] rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--primary-color)]"
                    />
                    <span className="text-[10px] text-[var(--text-secondary)]">Large</span>
                </div>
            </div>
        </div>
    );
};

export default ThumbnailsPanel;
