import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import PDFThumbnail from './PDFThumbnail';
import { Loader2 } from 'lucide-react';

const ThumbnailsPanel = ({ pdfDocument }) => {
    const { currentPage, setCurrentPage, setJumpToPage } = useAppStore();
    const scrollRef = useRef(null);
    const [thumbScale, setThumbScale] = useState(1);
    const [sliderVal, setSliderVal] = useState(160);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setIsReady(true), 100);
        return () => clearTimeout(timer);
    }, []);

    // Auto-scroll to active thumbnail when page changes
    useLayoutEffect(() => {
        if (scrollRef.current) {
            const activeThumb = scrollRef.current.querySelector(`[data-page="${currentPage}"]`);
            if (activeThumb) {
                activeThumb.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }
        }
    }, [currentPage]); // Scroll whenever currentPage changes

    if (!pdfDocument) return (
        <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <p className="text-sm">No PDF loaded</p>
        </div>
    );

    const numPages = pdfDocument.numPages;
    const baseWidth = 200;
    const minWidth = 80;
    const maxWidth = 240; // max that fits comfortably or scrolls 



    return (
        <div className="bg-[var(--bg-secondary)] flex flex-col text-[var(--text-primary)] h-full relative">
            <div className="flex justify-between items-center p-3 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <h2 className="text-sm font-semibold m-0">Thumbnails</h2>
                <span className="text-xs text-[var(--text-secondary)]">{numPages} Pages</span>
            </div>

            {!isReady && (
                <div className="absolute inset-x-0 bottom-0 top-[45px] flex items-center justify-center bg-[var(--bg-secondary)] z-10">
                    <Loader2 className="animate-spin text-gray-300" size={24} />
                </div>
            )}

            <div
                ref={scrollRef}
                className="flex-1 p-4 flex flex-wrap justify-center content-start gap-4 overflow-y-auto"
                style={{ opacity: isReady ? 1 : 0 }}
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
                        className="flex-1 h-1 bg-[var(--border-color)] rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-600 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-gray-600 [&::-moz-range-thumb]:border-none accent-gray-600]"
                    />
                    <span className="text-[10px] text-[var(--text-secondary)]">Large</span>
                </div>
            </div>
        </div>
    );
};

export default ThumbnailsPanel;
