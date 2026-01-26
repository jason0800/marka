import { useEffect, useRef, useState } from "react";
import useAppStore from "../../stores/useAppStore";
import PDFPage from "./PDFPage";
import classes from "./PDFViewer.module.css";

const PDFViewer = ({ document }) => {
    // --- Store (NEW viewport-based store) ---
    const { viewport, setViewport, activeTool, currentPage, setCurrentPage, viewMode } = useAppStore();
    const zoom = viewport.scale;
    const pan = { x: viewport.x, y: viewport.y };

    // --- Local Visual State (smooth zoom) ---
    const [visualScale, setVisualScale] = useState(1.0);
    const [renderScale, setRenderScale] = useState(1.0);

    // --- Drag State ---
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    // --- Space key state ---
    const spaceDownRef = useRef(false);
    const [isSpaceDown, setIsSpaceDown] = useState(false);

    // --- Refs ---
    const containerRef = useRef(null);
    const renderTimeoutRef = useRef(null);
    const isProgrammaticScroll = useRef(false); // prevent circular updates

    // --- Pages State ---
    const [pages, setPages] = useState([]);

    // --- Scroll Sync (Continuous Mode) ---
    useEffect(() => {
        if (viewMode !== 'continuous' || pages.length === 0) return;

        const container = containerRef.current;
        if (!container) return;

        // Ideally we would use IntersectionObserver on the page elements
        // BUT our page elements are inside a scaled/translated div, which makes standard
        // root/rootMargin IO definitions tricky.
        // Instead, we can map the viewport center to local coordinate space and find which page is there.
        // Simplest approximation: Scroll position.
        // BUT we are using CUSTOM PAN (transform translate), not native scroll.
        // So checking native scroll events won't work if overflow is hidden.
        // Wait, existing code uses:
        // transform: `translate(${pan.x}px, ${pan.y}px)`
        //
        // So "scrolling" is actually changing `pan.y`.
        //
        // To find the current page:
        // 1. Calculate "visible center Y" in localized space.
        //    visibleCenterY = (-pan.y + containerHeight/2) / scale
        // 2. Iterate pages and find which one covers that Y.

        // However, we only have the `pages` array, we don't know their heights easily unless we query DOM.
        // Let's query the DOM elements with `data-page-number`.

        const updateCurrentPage = () => {
            if (isProgrammaticScroll.current) return;

            // We can check which element is closest to the center of the viewport
            // We need to query relative to the window/viewport
            const centerX = window.innerWidth / 2; // Approximate or use container rect
            const centerY = window.innerHeight / 2;

            // Or better: just find the first element that intersects the viewport center line
            const elements = window.document.querySelectorAll('.pdf-page-container');
            let bestPage = currentPage;
            let minDist = Infinity;

            elements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const dist = Math.abs(rect.top + rect.height / 2 - centerY);
                if (dist < minDist && dist < window.innerHeight) { // Threshold
                    minDist = dist;
                    bestPage = parseInt(el.getAttribute('data-page-number'));
                }
            });

            if (bestPage && bestPage !== currentPage) {
                setCurrentPage(bestPage);
            }
        };

        // We need to listen to viewport Store changes? 
        // `pan` is a dependency of the component render, so we can check on every render/update.
        updateCurrentPage();

    }, [pan.y, viewMode]); // Check when vertical pan changes

    // --- Scroll TO Page (Navigation) ---
    useEffect(() => {
        if (viewMode !== 'continuous' || pages.length === 0) return;

        // If currentPage changes, we want to scroll to it.
        // We set a flag to avoid the sync-back loop.

        // We need to find the element
        const pageEl = window.document.querySelector(`.pdf-page-container[data-page-number='${currentPage}']`);
        if (pageEl) {
            // Calculate target pan.y
            // We want the top of this element to be at the top of the container (plus some margin)
            // BUT this element's position is affected by current Transform.
            // We need its position relative to the "contentLayer" (the unscaled wrapper).

            // Actually, it's inside the SCALED wrapper.
            // Structure: Outer -> ContentLayer (Pan) -> ScaledLayer (Scale) -> PageContainer

            // If we assume a constant gap and standard page heights, we could math it.
            // Since mixed page sizes are possible, DOM is safer.

            // Let:
            // currentPan.y (store)
            // currentScale (store)
            // rect.top (screen space)

            // We want: newRect.top = 20 (margin)
            // newRect.top = rect.top + (newPan.y - oldPan.y)
            // 20 = rect.top + newPanY - oldPanY
            // newPanY = 20 - rect.top + oldPanY

            isProgrammaticScroll.current = true;

            // Using timeout to allow render if switching modes
            setTimeout(() => {
                const rect = pageEl.getBoundingClientRect();
                const containerRect = containerRef.current.getBoundingClientRect();

                // We want the page top to be slightly below container top
                const desiredTop = containerRect.top + 20;
                const currentTop = rect.top;

                const diff = desiredTop - currentTop;

                setViewport(prev => ({
                    ...prev,
                    y: prev.y + diff
                }));

                setTimeout(() => { isProgrammaticScroll.current = false; }, 100);
            }, 0);
        }
    }, [currentPage, viewMode]); // Run when page changes defined by user input logic outside scroll

    // Load Pages + initial centering
    useEffect(() => {
        if (!document) return;

        const loadPages = async () => {
            const numPages = document.numPages;
            const loadedPages = [];

            for (let i = 1; i <= numPages; i++) {
                const page = await document.getPage(i);
                loadedPages.push(page);
            }

            setPages(loadedPages);

            // Initial centering (uses store viewport scale)
            if (containerRef.current && loadedPages.length > 0) {
                const page0 = loadedPages[0];
                const scale0 = useAppStore.getState().viewport.scale;
                const vp0 = page0.getViewport({ scale: scale0 });

                const containerWidth = containerRef.current.clientWidth;

                const initialPanX = Math.max(0, (containerWidth - vp0.width) / 2);
                const initialPanY = 20;

                setViewport((v) => ({ ...v, x: initialPanX, y: initialPanY }));
            }
        };

        loadPages();
    }, [document, setViewport]);

    // Initialize local scales from store once
    useEffect(() => {
        const s = useAppStore.getState().viewport.scale;
        setVisualScale(s);
        setRenderScale(s);
    }, []);

    // Keep a ref in sync for wheel math (avoid stale closures)
    const stateRef = useRef({ visualScale: 1.0, pan: { x: 0, y: 0 } });
    useEffect(() => {
        stateRef.current = { visualScale, pan };
    }, [visualScale, pan]);

    // Space key tracking (global)
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.code === "Space" && !e.repeat) {
                spaceDownRef.current = true;
                setIsSpaceDown(true);
            }
        };
        const onKeyUp = (e) => {
            if (e.code === "Space") {
                spaceDownRef.current = false;
                setIsSpaceDown(false);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, []);

    // Keyboard Zoom (Ctrl + / -)
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    handleKeyboardZoom(true);
                } else if (e.key === '-') {
                    e.preventDefault();
                    handleKeyboardZoom(false);
                }
            }
        };

        const handleKeyboardZoom = (zoomIn) => {
            const container = containerRef.current;
            if (!container) return;

            const { visualScale: currentScale, pan: currentPan } = stateRef.current;
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;

            // Zoom center = center of container
            const mouseX = containerWidth / 2;
            const mouseY = containerHeight / 2;

            // screen -> world
            const worldX = (mouseX - currentPan.x) / currentScale;
            const worldY = (mouseY - currentPan.y) / currentScale;

            // Multiplicative zoom factor
            const zoomFactor = 1.25;
            let newScale = zoomIn ? currentScale * zoomFactor : currentScale / zoomFactor;
            newScale = Math.min(Math.max(0.1, newScale), 8.0);

            // world -> screen
            const newPanX = mouseX - worldX * newScale;
            const newPanY = mouseY - worldY * newScale;

            // Smooth CSS zoom immediately
            setVisualScale(newScale);

            // Update pan atomically in store
            setViewport((v) => ({ ...v, x: newPanX, y: newPanY }));

            // Debounce expensive PDF render
            if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);
            renderTimeoutRef.current = setTimeout(() => {
                setRenderScale(newScale);
                // Commit scale to store
                setViewport((v) => ({ ...v, scale: newScale }));
            }, 300);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [setViewport]);

    // --- Scrollbar State ---
    const [contentHeight, setContentHeight] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);

    // Update container size on resize
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setContainerHeight(containerRef.current.clientHeight);
            }
        };
        window.addEventListener('resize', updateSize);
        updateSize();
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Estimate/Calculate Content Height
    useEffect(() => {
        // We can use the rendered height of the inner div if possible, OR sum of pages.
        // Since we have the pages array and scale, we could calculate it, BUT pages load async and might not have viewport yet.
        // Easiest is to measure the inner content div.
        // We need a ref to the "inner scaled bridge" div.
        const measureHeight = () => {
            // Find the element wrapping the pages
            const contentDiv = containerRef.current?.querySelector(`.${classes.contentLayer} > div`);
            if (contentDiv) {
                // The height of this div is unscaled pixels if we use getBoundingClientRect? No, transform scale affects it.
                // We want the logical height * visualScale.
                // Actually, offsets and scroll limits depend on "world space" vs "screen space".
                // Our `pan.y` mimics moving the "world" relative to screen.
                // contentHeight should be the height in "screen pixels" (scaled).

                const rect = contentDiv.getBoundingClientRect();
                // rect.height includes the scale transform.
                setContentHeight(rect.height);
            }
        };

        // Measure periodically or on specific changes
        measureHeight();
        // Also measure after a short timeout to allow PDF rendering (canvas resizing)
        const t = setTimeout(measureHeight, 500);
        return () => clearTimeout(t);
    }, [pages, visualScale, viewMode]);

    // Calculate Scrollbar Props
    // We want scrollbar to represent the viewport coverage.
    // viewport height = containerHeight
    // total scrollable area = contentHeight + (padding?)
    // pan.y = 0 => Top aligned (approx).
    // pan.y moves negative as we scroll down.

    // Min pan.y (bottommost) = ?
    // When bottom of content aligns with bottom of viewport: pan.y = containerHeight - contentHeight
    // Max pan.y (topmost) = 20 (padding)

    const maxPanY = 20; // Allow Over-scroll top (was 200, but 20 is more reasonable for initial padding)
    const minPanY = Math.min(maxPanY, containerHeight - contentHeight - 20); // Allow Over-scroll bottom

    // Clamp Y Logic
    const clampY = (y) => {
        return Math.min(maxPanY, Math.max(minPanY, y));
    };

    // Wheel listener for Panning (Scrolling)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onWheel = (e) => {
            e.preventDefault();

            // Panning (scrolling)
            let deltaX = e.deltaX;
            let deltaY = e.deltaY;

            // Support Shift + Scroll -> Horizontal Scroll
            if (e.shiftKey) {
                // If we have no horizontal delta, map the vertical delta
                if (deltaX === 0) {
                    deltaX = deltaY;
                }
                // Force vertical deviation to zero
                deltaY = 0;
            }

            setViewport((v) => {
                let newX = v.x - deltaX;
                let newY = v.y - deltaY;

                // Apply clamping
                newY = clampY(newY);

                return { ...v, x: newX, y: newY };
            });
        };

        container.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            container.removeEventListener("wheel", onWheel);
        };
    }, [setViewport, contentHeight, containerHeight]); // Depend on heights for clamping closure

    const handleMouseDown = (e) => {
        const shouldPan =
            e.button === 1 || // middle mouse
            spaceDownRef.current || // space + drag
            activeTool === "pan" ||
            (e.shiftKey && activeTool !== "select"); // your extra rule

        if (shouldPan) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            e.preventDefault();
        }
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;

        const nx = e.clientX - dragStart.x;
        let ny = e.clientY - dragStart.y;

        // Apply boundary
        ny = clampY(ny);

        setViewport((v) => ({ ...v, x: nx, y: ny }));
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // CSS bridge between fast visual zoom and slower PDF render zoom
    const cssScale = renderScale === 0 ? 1 : visualScale / renderScale;

    // Determine Cursor
    const getCursor = () => {
        if (isDragging) return 'grabbing';
        if (activeTool === 'pan' || isSpaceDown) return 'grab';
        if (activeTool === 'select') return 'default';
        return 'crosshair'; // drawing tools
    };

    // Scrollbar Logic
    // map pan.y [minPanY, maxPanY] -> thumb position [containerHeight - thumbHeight, 0] ?
    // Wait, typical scrollbar: top = 0% -> pan.y = top.

    // Let's use simple ratio:
    // Scrollable Range (World) = contentHeight - containerHeight (if content > container)
    // Actually, pan.y goes from ~0 down to -(contentHeight - containerHeight).
    // Let's map pan.y to a 0-1 progress.

    const viewportH = containerHeight;
    const scrollableH = contentHeight;
    const showScrollbar = scrollableH > viewportH;

    // Thumb height proportional to view
    const thumbHeight = Math.max(30, (viewportH / scrollableH) * viewportH);
    const trackHeight = viewportH;

    // Range of pan.y: [minPanY, maxPanY]
    // Range of thumb logic: 0 to (trackHeight - thumbHeight)
    // pct = (currentPanY - maxPanY) / (minPanY - maxPanY) 
    // This gives 0 at top, 1 at bottom.

    const scrollProgress = (pan.y - maxPanY) / (minPanY - maxPanY); // 0 at top, 1 at bottom (roughly)
    // Clamp progress 0-1 for display
    const clampedProgress = Math.max(0, Math.min(1, scrollProgress || 0));

    const thumbTop = clampedProgress * (trackHeight - thumbHeight);

    // Scrollbar Drag
    const startDragScroll = (e) => {
        e.stopPropagation();
        const startY = e.clientY;
        const startPanY = pan.y;

        const onScrollDrag = (moveEvent) => {
            const deltaPixels = moveEvent.clientY - startY;
            // distinct pixel in scrollbar track moves X pixels in Pan space?
            // Ratio = (minPanY - maxPanY) / (trackHeight - thumbHeight)
            const ratio = (minPanY - maxPanY) / (trackHeight - thumbHeight);

            const newPanY = startPanY + deltaPixels * ratio;

            setViewport(v => ({ ...v, y: clampY(newPanY) }));
        };

        const stopScrollDrag = () => {
            window.removeEventListener('mousemove', onScrollDrag);
            window.removeEventListener('mouseup', stopScrollDrag);
        };

        window.addEventListener('mousemove', onScrollDrag);
        window.addEventListener('mouseup', stopScrollDrag);
    };

    return (
        <div
            className={classes.viewerContainer}
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: getCursor() }}
        >
            {/* Scrollbar Track */}
            {showScrollbar && (
                <div
                    style={{
                        position: 'absolute',
                        right: 4,
                        top: 2,
                        bottom: 2,
                        width: 8,
                        borderRadius: 4,
                        zIndex: 100,
                        backgroundColor: 'transparent',
                    }}
                >
                    {/* Scrollbar Thumb */}
                    <div
                        onMouseDown={startDragScroll}
                        style={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            width: '100%',
                            height: thumbHeight,
                            transform: `translateY(${thumbTop}px)`,
                            backgroundColor: 'rgba(150, 150, 150, 0.5)',
                            borderRadius: 4,
                            cursor: 'default',
                        }}
                    />
                </div>
            )}

            {/* OUTER: pan only (never scaled) */}
            <div
                className={classes.contentLayer}
                style={{
                    transform: `translate(${pan.x}px, ${pan.y}px)`,
                    transformOrigin: '0 0',
                    // Removed width: 100% to prevent CSS centering conflicts
                }}
            >
                {/* INNER: visual-only scale bridge */}
                <div
                    style={{
                        transform: `scale(${cssScale})`,
                        transformOrigin: '0 0',
                        display: 'flex',
                        flexDirection: 'column',
                        // Removed alignItems: center to rely on coordinate positioning
                        // Removed gap to control spacing via margins
                    }}
                >
                    {viewMode === 'single' ? (
                        pages[currentPage - 1] && (
                            <PDFPage
                                key={currentPage - 1}
                                page={pages[currentPage - 1]}
                                scale={renderScale}
                            />
                        )
                    ) : (
                        pages.map((page, index) => (
                            <div
                                key={index}
                                data-page-number={index + 1}
                                className="pdf-page-container"
                                style={{
                                    width: 'fit-content',
                                    // Divider Logic
                                    borderBottom: index < pages.length - 1 ? '1px solid #e5e5e5' : 'none', // Lighter border
                                    paddingBottom: index < pages.length - 1 ? '30px' : '0', // Space between page and line
                                    marginBottom: index < pages.length - 1 ? '30px' : '0', // Space between line and next page
                                }}
                            >
                                <PDFPage page={page} scale={renderScale} />
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default PDFViewer;
