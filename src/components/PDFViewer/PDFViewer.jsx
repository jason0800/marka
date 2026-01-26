import { useEffect, useRef, useState, useLayoutEffect } from "react";
import useAppStore from "../../stores/useAppStore";
import PDFPage from "./PDFPage";
import classes from "./PDFViewer.module.css";

const PDFViewer = ({ document }) => {
    // --- Store ---
    const {
        viewport: storeViewport,
        setViewport,
        activeTool,
        currentPage,
        setCurrentPage,
        viewMode
    } = useAppStore();

    // --- Local State for Rendering ---
    const [pages, setPages] = useState([]);
    const [dragging, setDragging] = useState([false]);

    // --- Interactive State (Refs for performance) ---
    // We use refs for pan/zoom to avoid React render cycle lag during gestures
    const state = useRef({
        scale: storeViewport.scale || 1,
        x: storeViewport.x || 0,
        y: storeViewport.y || 0
    });

    const containerRef = useRef(null);
    const contentRef = useRef(null);
    const rafRef = useRef(null);
    const isDragging = useRef(false);
    const lastMouse = useRef({ x: 0, y: 0 });

    // Helper to force update if needed (rarely used if we manipulate DOM directly or use useSyncExternalStore pattern, 
    // but here we might just trigger re-renders on commit)
    const [, forceRender] = useState({});

    // --- Constants ---
    const PAGE_SPACING = 40; // Total vertical space between pages
    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const PADDING = 40; // Viewport padding

    // --- 1. Load Pages ---
    useEffect(() => {
        if (!document) return;
        const load = async () => {
            const num = document.numPages;
            const loaded = [];
            for (let i = 1; i <= num; i++) loaded.push(await document.getPage(i));
            setPages(loaded);
        };
        load();
    }, [document]);

    // --- 2. Clamping Logic ---
    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    const applyState = (newState, commit = true) => {
        // Merge and apply scale limits only
        const next = {
            ...state.current,
            ...newState,
            scale: clamp(newState.scale ?? state.current.scale, MIN_SCALE, MAX_SCALE)
        };

        state.current = next;

        // Apply to DOM (Fast)
        if (contentRef.current) {
            contentRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
            contentRef.current.style.transformOrigin = '0 0';
        }

        // Sync to Store
        if (commit) {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                setViewport(next);
            });
        }
    };

    // --- 4. Event Handlers ---

    // --- 4. Event Handlers ---

    // Wheel (Zoom + Pan) - Native listener for non-passive behavior
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            e.preventDefault();
            const { scale, x, y } = state.current;

            // ZOOM (Cmd/Ctrl + Wheel)
            if (e.ctrlKey || e.metaKey) {
                const rect = container.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;

                const wx = (mx - x) / scale;
                const wy = (my - y) / scale;

                const factor = Math.exp(-e.deltaY * 0.002);
                const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

                const newX = mx - wx * newScale;
                const newY = my - wy * newScale;

                applyState({ scale: newScale, x: newX, y: newY });
                return;
            }

            // PAN (Wheel)
            let dx = e.deltaX;
            let dy = e.deltaY;

            if (e.shiftKey) {
                if (dx === 0) dx = dy;
                dy = 0;
            }

            applyState({ x: x - dx, y: y - dy });
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    // Keyboard Zoom
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+' || e.key === '-') {
                    e.preventDefault();

                    const zoomIn = e.key !== '-';
                    const { scale, x, y } = state.current;
                    const factor = zoomIn ? 1.25 : 0.8;
                    const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

                    // Zoom to center of viewport
                    const rect = containerRef.current.getBoundingClientRect();
                    const mx = rect.width / 2;
                    const my = rect.height / 2;

                    // world anchor
                    const wx = (mx - x) / scale;
                    const wy = (my - y) / scale;

                    const newX = mx - wx * newScale;
                    const newY = my - wy * newScale;

                    applyState({ scale: newScale, x: newX, y: newY });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const onMouseDown = (e) => {
        // Middle click or Space or Tool
        if (e.button === 1 || activeTool === 'pan' || e.shiftKey) {
            isDragging.current = true;
            setDragging(true);
            lastMouse.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            e.stopPropagation(); // Prevent measurement tools from activating
        }
    };

    const onMouseMove = (e) => {
        if (!isDragging.current) return;
        e.stopPropagation(); // Prevent interference with other tools

        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };

        const { x, y } = state.current;
        applyState({ x: x + dx, y: y + dy });
    };

    const onMouseUp = (e) => {
        isDragging.current = false;
        setDragging(false);
    };

    // --- 5. Sync from Store (Initial & External Changes) ---
    useEffect(() => {
        // Only if significant difference (avoid loops)
        const dScale = Math.abs(storeViewport.scale - state.current.scale);
        const dX = Math.abs(storeViewport.x - state.current.x);
        const dY = Math.abs(storeViewport.y - state.current.y);

        if (dScale > 0.001 || dX > 1 || dY > 1) {
            applyState(storeViewport, false); // Don't commit back to store immediately
        }
    }, [storeViewport]);

    // --- 6. Page Navigation Sync ---
    // (Simplified: Scroll current page to top if changed externally)
    useEffect(() => {
        if (!contentRef.current) return;
        // Find page element
        const pageEl = contentRef.current.querySelector(`[data-page-number="${currentPage}"]`);
        if (pageEl) {
            const pageTop = pageEl.offsetTop;
            const { scale } = state.current;
            const targetY = 20 - pageTop * scale;

            applyState({ y: targetY });
        }
    }, [currentPage]);

    // --- 7. Cursor ---
    const getCursor = () => {
        if (isDragging.current) return 'grabbing';
        if (activeTool === 'pan') return 'grab';
        return 'default';
    };

    return (
        <div
            className={classes.viewerContainer}
            ref={containerRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            style={{
                cursor: getCursor(),
                userSelect: 'none' // Prevent text selection during panning
            }}
        >
            {/* Content Layer (Transform Applied Here) */}
            <div
                ref={contentRef}
                className={classes.contentLayer}
                style={{
                    // Initial rendering style, updated via ref manipulation
                    transform: `translate(${storeViewport.x}px, ${storeViewport.y}px) scale(${storeViewport.scale})`,
                    transformOrigin: '0 0',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center', // Center pages in the column
                    padding: `${PADDING}px` // Inner padding
                }}
            >
                {viewMode === 'single' ? (
                    pages[currentPage - 1] && (
                        <div className="pdf-page-container">
                            <PDFPage page={pages[currentPage - 1]} scale={1} />
                        </div>
                    )
                ) : (
                    pages.map((page, index) => (
                        <div
                            key={index}
                            data-page-number={index + 1}
                            className="pdf-page-container"
                            style={{
                                borderBottom: index < pages.length - 1 ? '1px solid #c0c0c0' : 'none',
                                paddingBottom: index < pages.length - 1 ? '20px' : '0',
                                marginBottom: index < pages.length - 1 ? '20px' : '0',
                                width: 'fit-content'
                            }}
                        >
                            <PDFPage page={page} scale={1} />
                        </div>
                    ))
                )}
            </div>

            {/* Custom Scrollbar */}
            <div
                style={{
                    position: 'absolute',
                    right: 4,
                    top: 4,
                    bottom: 4,
                    width: 8,
                    backgroundColor: 'rgba(0, 0, 0, 0.1)',
                    borderRadius: 4,
                    zIndex: 100,
                }}
            >
                {/* Scrollbar Thumb */}
                <div
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        const startY = e.clientY;
                        const startPanY = state.current.y;

                        const onDrag = (moveEvent) => {
                            const deltaY = moveEvent.clientY + startY;
                            // Multiply by a factor to make scrolling feel natural
                            applyState({ y: startPanY + deltaY * 5 });
                        };

                        const onUp = () => {
                            window.removeEventListener('mousemove', onDrag);
                            window.removeEventListener('mouseup', onUp);
                        };

                        window.addEventListener('mousemove', onDrag);
                        window.addEventListener('mouseup', onUp);
                    }}
                    style={{
                        position: 'absolute',
                        top: 0,
                        width: '100%',
                        height: 60,
                        backgroundColor: 'rgba(100, 100, 100, 0.6)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        transform: `translateY(${Math.max(0, -state.current.y / 10)}px)`, // Simple position mapping
                    }}
                />
            </div>
        </div>
    );
};

export default PDFViewer;
