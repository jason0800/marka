import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useAppStore from '../stores/useAppStore';
import PDFThumbnail from './PDFThumbnail';
import InsertSheetDialog from './InsertSheetDialog';
import { Loader2, Plus } from 'lucide-react';

const ThumbnailsPanel = ({ pdfDocument }) => {
    const { 
        currentPage, 
        setCurrentPage, 
        setJumpToPage,
        sheets,
        addSheet,
        deleteSheet,
        moveSheet,
        pushHistory
    } = useAppStore();

    const scrollRef = useRef(null);
    const [sliderVal, setSliderVal] = useState(160);
    const [isReady, setIsReady] = useState(false);
    
    // Dialog state
    const [insertDialog, setInsertDialog] = useState({
        visible: false,
        index: 0
    });

    // Context menu state
    const [contextMenu, setContextMenu] = useState({
        visible: false,
        x: 0,
        y: 0,
        sheetIndex: null
    });

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

    // Close context menu on any click
    useEffect(() => {
        const handleClose = () => {
            setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
        };
        window.addEventListener('click', handleClose);
        return () => window.removeEventListener('click', handleClose);
    }, []);

    if (!pdfDocument && sheets.length === 0) return (
        <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <p className="text-sm">No PDF loaded</p>
        </div>
    );

    const numPages = sheets.length;
    const minWidth = 80;
    const maxWidth = 240;

    const handleContextMenu = (e, index) => {
        e.preventDefault();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            sheetIndex: index
        });
    };

    const handleOpenInsertDialog = (insertIndex) => {
        setInsertDialog({
            visible: true,
            index: insertIndex
        });
    };

    const handleConfirmInsert = ({ width, height }) => {
        pushHistory();
        addSheet(insertDialog.index, width, height);
    };

    const handleDeleteSheet = (index) => {
        if (sheets.length <= 1) return;
        pushHistory();
        deleteSheet(index);
    };

    const handleMoveSheet = (fromIndex, toIndex) => {
        if (toIndex < 0 || toIndex >= sheets.length) return;
        pushHistory();
        moveSheet(fromIndex, toIndex);
    };

    return (
        <div className="bg-[var(--bg-secondary)] flex flex-col text-[var(--text-primary)] h-full relative">
            <div className="flex justify-between items-center p-3 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <h2 className="text-sm font-semibold m-0 flex items-center gap-1.5">
                    Sheets
                </h2>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">{numPages} Pages</span>
                </div>
            </div>

            {!isReady && (
                <div className="absolute inset-x-0 bottom-0 top-[45px] flex items-center justify-center bg-[var(--bg-secondary)] z-10">
                    <Loader2 className="animate-spin text-gray-300" size={24} />
                </div>
            )}

            <div
                ref={scrollRef}
                className="flex-1 p-4 flex flex-wrap justify-center content-start gap-4 overflow-y-auto overflow-x-hidden"
                style={{ opacity: isReady ? 1 : 0 }}
            >
                {(() => {
                    const maxSheetWidth = Math.max(1, ...sheets.map(s => s.width || 800));
                    const maxSheetHeight = Math.max(1, ...sheets.map(s => s.height || 1100));

                    return sheets.map((sheet, index) => {
                        const pageNum = index + 1;
                        return (
                            <div 
                                key={sheet.id} 
                                data-page={pageNum} 
                                onContextMenu={(e) => handleContextMenu(e, index)}
                                className="relative p-1"
                                style={{ width: sliderVal + 8 }}
                            >
                                <PDFThumbnail
                                    document={pdfDocument}
                                    pageNumber={pageNum}
                                    sheet={sheet}
                                    isActive={currentPage === pageNum}
                                    onSelect={(n) => setJumpToPage(n)}
                                    width={sliderVal}
                                    maxSheetWidth={maxSheetWidth}
                                    maxSheetHeight={maxSheetHeight}
                                />
                            </div>
                        );
                    });
                })()}
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

            {/* Custom Right-Click Context Menu */}
            {contextMenu.visible && (
                <div 
                    className="fixed bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-xl py-1 z-[9999] min-w-[180px] text-sm animate-in fade-in zoom-in-95 duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            handleOpenInsertDialog(contextMenu.sheetIndex);
                            setContextMenu(prev => ({ ...prev, visible: false }));
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white text-[var(--text-primary)] transition-colors"
                    >
                        Insert Sheet Before
                    </button>
                    <button
                        onClick={() => {
                            handleOpenInsertDialog(contextMenu.sheetIndex + 1);
                            setContextMenu(prev => ({ ...prev, visible: false }));
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white text-[var(--text-primary)] transition-colors"
                    >
                        Insert Sheet After
                    </button>
                    <div className="border-t border-[var(--border-color)] my-1" />
                    <button
                        onClick={() => {
                            handleMoveSheet(contextMenu.sheetIndex, contextMenu.sheetIndex - 1);
                            setContextMenu(prev => ({ ...prev, visible: false }));
                        }}
                        disabled={contextMenu.sheetIndex === 0}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white text-[var(--text-primary)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                        Move Up
                    </button>
                    <button
                        onClick={() => {
                            handleMoveSheet(contextMenu.sheetIndex, contextMenu.sheetIndex + 1);
                            setContextMenu(prev => ({ ...prev, visible: false }));
                        }}
                        disabled={contextMenu.sheetIndex === sheets.length - 1}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white text-[var(--text-primary)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                        Move Down
                    </button>
                    <div className="border-t border-[var(--border-color)] my-1" />
                    <button
                        onClick={() => {
                            handleDeleteSheet(contextMenu.sheetIndex);
                            setContextMenu(prev => ({ ...prev, visible: false }));
                        }}
                        disabled={sheets.length <= 1}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white text-red-500 disabled:opacity-40 disabled:pointer-events-none transition-colors font-medium"
                    >
                        Delete Sheet
                    </button>
                </div>
            )}

            {/* Insert Sheet Specification Dialog */}
            {insertDialog.visible && (
                <InsertSheetDialog
                    onClose={() => setInsertDialog({ visible: false, index: 0 })}
                    onConfirm={handleConfirmInsert}
                />
            )}
        </div>
    );
};

export default ThumbnailsPanel;
