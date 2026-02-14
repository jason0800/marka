import { useState, useEffect } from 'react';
import useAppStore from '../stores/useAppStore';

const BottomBar = ({ totalPages }) => {
    const {
        currentPage,
        setCurrentPage,
        viewMode,
        setViewMode,
        calibrationScales,
        calibrationDetails,
        setPageScale,
        setJumpToPage
    } = useAppStore();

    const [pageInput, setPageInput] = useState(currentPage);
    const [scaleDisplay, setScaleDisplay] = useState('');

    useEffect(() => {
        setPageInput(currentPage);

        // Load scale for current page
        const pageIndex = currentPage - 1;
        const scale = calibrationScales[pageIndex];
        const details = calibrationDetails[pageIndex];

        if (details) {
            // Format: "1 mm = 0.5 m"
            setScaleDisplay(`${details.paperVal} ${details.paperUnit} = ${details.realVal} ${details.realUnit}`);
        } else if (scale) {
            // Fallback for legacy/unknown details: 1:X (where X is calculated assuming mm/mm or similar?)
            // Actually, without units, 1:X is ambiguous but "1:50" usually means 1 unit paper = 50 units real.
            setScaleDisplay(`1:${Math.round(scale)}`);
        } else {
            setScaleDisplay('Not Set');
        }
    }, [currentPage, calibrationScales, calibrationDetails]);

    const handlePageChange = (e) => {
        const val = parseInt(e.target.value);
        setPageInput(e.target.value);
        if (!isNaN(val) && val >= 1 && val <= totalPages) {
            setCurrentPage(val);
        }
    };

    const handlePageKeyDown = (e) => {
        if (e.key === 'Enter') {
            let val = parseInt(pageInput);
            if (isNaN(val)) val = currentPage;
            val = Math.max(1, Math.min(val, totalPages));
            setCurrentPage(val);
            setPageInput(val);
            e.currentTarget.blur();
        }
    };

    const goNext = () => setJumpToPage(Math.min(currentPage + 1, totalPages));
    const goPrev = () => setJumpToPage(Math.max(currentPage - 1, 1));
    const goFirst = () => setJumpToPage(1);
    const goLast = () => setJumpToPage(totalPages);

    return (
        <div className="w-full h-[50px] bg-[var(--bg-secondary)] border-t border-[var(--border-color)] grid grid-cols-[1fr_auto_1fr] items-center px-5 box-border text-[var(--text-primary)] text-[15px] select-none">
            <div className="flex items-center gap-2 justify-self-start">
                <span className="opacity-80 text-sm font-medium">Scale:</span>
                <div
                    className="text-[var(--text-primary)] text-sm font-medium opacity-75 cursor-default"
                    title="Current Scale (Set via Toolbar)"
                >
                    {scaleDisplay}
                </div>
            </div>

            <div className="flex items-center justify-self-center" style={{ visibility: totalPages > 0 ? 'visible' : 'hidden' }}>
                <div className="flex items-center gap-1 mr-4">
                    <button
                        className="bg-transparent border border-transparent text-[var(--text-secondary)] p-1.5 rounded-md flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default h-8 w-8"
                        onClick={goFirst}
                        disabled={currentPage <= 1}
                        title="First Page"
                    >
                        <span className="text-xl font-bold leading-none">«</span>
                    </button>
                    <button
                        className="bg-transparent border border-transparent text-[var(--text-secondary)] p-1.5 rounded-md flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default h-8 w-8"
                        onClick={goPrev}
                        disabled={currentPage <= 1}
                        title="Previous Page"
                    >
                        <span className="text-xl font-bold leading-none">‹</span>
                    </button>
                </div>

                <div className="flex items-center gap-2 text-[var(--text-secondary)] text-[13px] font-medium">
                    <span>Page</span>
                    <input
                        type="text"
                        className="bg-[var(--bg-color)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md px-2 h-7 w-[40px] text-center text-[13px] font-medium focus:outline-none focus:border-[var(--primary-color)] transition-all"
                        value={pageInput}
                        onChange={handlePageChange}
                        onKeyDown={handlePageKeyDown}
                    />
                    <span className="opacity-50">/</span>
                    <span>{totalPages || 0}</span>
                </div>

                <div className="flex items-center gap-1 ml-4">
                    <button
                        className="bg-transparent border border-transparent text-[var(--text-secondary)] p-1.5 rounded-md flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default h-8 w-8"
                        onClick={goNext}
                        disabled={currentPage >= totalPages}
                        title="Next Page"
                    >
                        <span className="text-xl font-bold leading-none">›</span>
                    </button>
                    <button
                        className="bg-transparent border border-transparent text-[var(--text-secondary)] p-1.5 rounded-md flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default h-8 w-8"
                        onClick={goLast}
                        disabled={currentPage >= totalPages}
                        title="Last Page"
                    >
                        <span className="text-xl font-bold leading-none">»</span>
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-2 justify-self-end">
                <button
                    className="bg-[var(--bg-color)] border border-[var(--border-color)] text-[var(--text-primary)] p-1.5 rounded-md text-[13px] cursor-pointer transition-all duration-200 min-w-[36px] h-[36px] flex items-center justify-center hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)]"
                    onClick={() => setViewMode(viewMode === 'continuous' ? 'single' : 'continuous')}
                    title={viewMode === 'continuous' ? "Switch to Single Page View" : "Switch to Continuous View"}
                >
                    {viewMode === 'continuous' ? (
                        /* Continuous Mode Icon (stack) */
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="4" y="2" width="16" height="8" rx="1" />
                            <rect x="4" y="14" width="16" height="8" rx="1" />
                        </svg>
                    ) : (
                        /* Single Page Icon */
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="5" y="4" width="14" height="16" rx="2" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
};

export default BottomBar;
