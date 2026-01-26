import { useState, useEffect } from 'react';
import useAppStore from '../../stores/useAppStore';
import classes from './BottomBar.module.css';

const BottomBar = ({ totalPages }) => {
    const { currentPage, setCurrentPage, viewMode, setViewMode } = useAppStore();
    const [pageInput, setPageInput] = useState(currentPage);

    useEffect(() => {
        setPageInput(currentPage);
    }, [currentPage]);

    const handlePageChange = (e) => {
        const val = parseInt(e.target.value);
        setPageInput(e.target.value);
        if (!isNaN(val) && val >= 1 && val <= totalPages) {
            setCurrentPage(val);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            let val = parseInt(pageInput);
            if (isNaN(val)) val = currentPage;
            val = Math.max(1, Math.min(val, totalPages));
            setCurrentPage(val);
            setPageInput(val); // normalize input
            e.currentTarget.blur();
        }
    };

    const goNext = () => setCurrentPage(Math.min(currentPage + 1, totalPages));
    const goPrev = () => setCurrentPage(Math.max(currentPage - 1, 1));
    const goFirst = () => setCurrentPage(1);
    const goLast = () => setCurrentPage(totalPages);

    return (
        <div className={classes.bottomBar}>
            <div className={classes.leftControls}>
                {/* Placeholder for future status items */}
            </div>

            <div className={classes.centerControls} style={{ visibility: totalPages > 0 ? 'visible' : 'hidden' }}>
                <button
                    className={classes.iconButton}
                    onClick={goFirst}
                    disabled={currentPage <= 1}
                    title="First Page"
                >
                    «
                </button>
                <button
                    className={classes.iconButton}
                    onClick={goPrev}
                    disabled={currentPage <= 1}
                    title="Previous Page"
                >
                    ‹
                </button>

                <span className={classes.pageCount}>Page</span>
                <input
                    type="text"
                    className={classes.pageInput}
                    value={pageInput}
                    onChange={handlePageChange}
                    onKeyDown={handleKeyDown}
                />
                <span className={classes.pageCount}>of {totalPages || 0}</span>

                <button
                    className={classes.iconButton}
                    onClick={goNext}
                    disabled={currentPage >= totalPages}
                    title="Next Page"
                >
                    ›
                </button>
                <button
                    className={classes.iconButton}
                    onClick={goLast}
                    disabled={currentPage >= totalPages}
                    title="Last Page"
                >
                    »
                </button>
            </div>

            <div className={classes.rightControls}>
                <button
                    className={classes.viewModeButton}
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
