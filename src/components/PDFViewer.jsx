import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useCallback,
} from "react";
import useAppStore from "../stores/useAppStore";
import PDFPage from "./PDFPage";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const useDebouncedValue = (value, delay = 180) => {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
};

const DEFAULT_PAGE_W = 800;
const DEFAULT_PAGE_H = 1100;

const PDFViewer = ({ document }) => {
    const {
        viewport: storeViewport,
        setViewport,
        activeTool,
        currentPage,
        setCurrentPage,
        viewMode,
        pageRotations,
        setNumPages: setStoreNumPages,
    } = useAppStore();

    // --- DOM refs ---
    const containerRef = useRef(null);
    const contentRef = useRef(null);

    // IMPORTANT: wheel listener must attach even when ref is null on first effect run
    const [containerEl, setContainerEl] = useState(null);
    const setContainerNode = useCallback((node) => {
        containerRef.current = node;
        setContainerEl(node);
    }, []);

    // --- input / interaction refs ---
    const isPanningRef = useRef(false);
    const isThumbDraggingRef = useRef(false);
    const lastMouseRef = useRef({ x: 0, y: 0 });
    const startedPanButtonRef = useRef(null);
    const suppressNextClickRef = useRef(false);
    const suppressDetectUntilRef = useRef(0);

    // --- current page ref (avoid stale closures) ---
    const currentPageRef = useRef(currentPage);
    useEffect(() => {
        currentPageRef.current = currentPage;
    }, [currentPage]);

    // --- imperative viewport truth ---
    const stateRef = useRef({
        scale: storeViewport.scale || 1,
        x: storeViewport.x || 0,
        y: storeViewport.y || 0,
    });

    const [dragging, setDragging] = useState(false);

    // tick is only for virtualization + derived UI; do NOT bump it on every wheel event
    const [tick, bumpTick] = useState(0);
    const rafTickRef = useRef(0);
    const scheduleTick = useCallback(() => {
        if (rafTickRef.current) return;
        rafTickRef.current = requestAnimationFrame(() => {
            rafTickRef.current = 0;
            bumpTick((t) => (t + 1) % 1_000_000);
        });
    }, []);

    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const PADDING = 40;
    const PAGE_GAP = 12;

    // ---- zoom jank killer: "pin" renderScale while zooming, only re-rasterize after idle ----
    const [isZooming, setIsZooming] = useState(false);
    const zoomIdleTimerRef = useRef(null);

    const markZooming = useCallback(() => {
        if (!isZooming) setIsZooming(true);
        if (zoomIdleTimerRef.current) clearTimeout(zoomIdleTimerRef.current);
        zoomIdleTimerRef.current = setTimeout(() => setIsZooming(false), 220);
    }, [isZooming]);

    useEffect(() => {
        return () => {
            if (zoomIdleTimerRef.current) clearTimeout(zoomIdleTimerRef.current);
        };
    }, []);

    const debouncedRenderScale = useDebouncedValue(storeViewport.scale ?? 1, 180);
    // While zooming: don't trigger expensive re-rendering; after idle it sharpens.
    const effectiveRenderScale = (isZooming || dragging) ? 1 : debouncedRenderScale;

    // ---- document + caches ----
    const [numPages, setNumPages] = useState(0);
    const pageCacheRef = useRef(new Map()); // pageNumber -> PDFPageProxy
    const loadingRef = useRef(new Set()); // pageNumber strings in-flight
    const baseHeightsRef = useRef([]); // scale=1 heights
    const [layoutVersion, bumpLayout] = useState(0);

    const getMaxPages = useCallback(() => {
        return document?.numPages ?? numPages;
    }, [document, numPages]);

    const ensurePageLoaded = useCallback(
        async (pageNumber) => {
            if (!document) return;

            const maxPages = getMaxPages();
            if (pageNumber < 1 || pageNumber > maxPages) return;
            if (pageCacheRef.current.has(pageNumber)) return;

            const key = String(pageNumber);
            if (loadingRef.current.has(key)) return;
            loadingRef.current.add(key);

            try {
                const page = await document.getPage(pageNumber);
                pageCacheRef.current.set(pageNumber, page);

                const vp = page.getViewport({ scale: 1 });
                const idx = pageNumber - 1;
                const nextH = vp?.height || DEFAULT_PAGE_H;

                if (baseHeightsRef.current[idx] !== nextH) {
                    baseHeightsRef.current[idx] = nextH;
                    bumpLayout((x) => x + 1);
                }
            } finally {
                loadingRef.current.delete(key);
                scheduleTick(); // ✅ not immediate rerender storm
            }
        },
        [document, getMaxPages, scheduleTick]
    );

    useEffect(() => {
        if (!document) return;

        const n = document.numPages || 0;
        setNumPages(n);
        setStoreNumPages(n); // Sync to store

        pageCacheRef.current = new Map();
        loadingRef.current = new Set();
        baseHeightsRef.current = Array.from({ length: n }, () => DEFAULT_PAGE_H);

        ensurePageLoaded(1);
        scheduleTick();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [document]);

    // ---- bounds ----
    const boundsRef = useRef({ minY: PADDING, maxY: PADDING });

    const getBaseContentHeight = useCallback(() => {
        if (!numPages) return 0;
        const hs = baseHeightsRef.current;
        let sum = PADDING * 2;
        for (let i = 0; i < numPages; i++) {
            sum += hs[i] || DEFAULT_PAGE_H;
            if (i < numPages - 1) sum += PAGE_GAP;
        }
        return sum;
    }, [numPages, PAGE_GAP]);

    const getBaseContentHeightForMode = useCallback(() => {
        if (!numPages) return 0;

        if (viewMode === "single") {
            const idx = Math.max(
                0,
                Math.min(numPages - 1, (currentPageRef.current || 1) - 1)
            );
            const h = baseHeightsRef.current[idx] || DEFAULT_PAGE_H;
            return PADDING * 2 + h;
        }

        return getBaseContentHeight();
    }, [getBaseContentHeight, numPages, viewMode]);

    const updateBounds = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const containerH = container.clientHeight;
        const scale = stateRef.current.scale;

        const scaledContentH = getBaseContentHeightForMode() * scale;

        const maxY = PADDING;
        const computedMin = containerH - scaledContentH - PADDING;
        const minY = Math.min(maxY, computedMin);

        boundsRef.current = { minY, maxY };
    }, [getBaseContentHeightForMode]);

    const clampY = useCallback((y) => {
        const { minY, maxY } = boundsRef.current;
        return clamp(y, minY, maxY);
    }, []);

    const getScrollRange = useCallback(() => {
        const { minY, maxY } = boundsRef.current;
        return Math.max(0, maxY - minY);
    }, []);

    const canScrollY = useCallback(() => getScrollRange() > 0.5, [getScrollRange]);

    // ---- page detection ----
    const pageDetectRafRef = useRef(0);

    const detectAndSetCurrentPage = useCallback(() => {
        pageDetectRafRef.current = 0;

        // ✅ suppress auto-detection right after programmatic jumps
        if (performance.now() < suppressDetectUntilRef.current) return;

        if (viewMode !== "continuous") return;

        const container = containerRef.current;
        if (!container || !numPages) return;

        const { y, scale } = stateRef.current;
        const probeY = (container.clientHeight / 2 - y) / scale;

        const hs = baseHeightsRef.current;
        let cursor = PADDING;

        let bestIdx = 0;

        for (let i = 0; i < numPages; i++) {
            const h = hs[i] || DEFAULT_PAGE_H;

            // ✅ gap belongs to THIS page
            const top = cursor;
            const bottom = top + h + (i < numPages - 1 ? PAGE_GAP : 0);

            if (probeY >= top && probeY < bottom) {
                bestIdx = i;
                break;
            }

            cursor = top + h + PAGE_GAP;
        }

        const newPage = bestIdx + 1;
        if (newPage !== currentPageRef.current) {
            currentPageRef.current = newPage;
            setCurrentPage(newPage);
        }
    }, [numPages, setCurrentPage, viewMode, PAGE_GAP]);


    const scheduleDetectPage = useCallback(() => {
        if (pageDetectRafRef.current) return;
        pageDetectRafRef.current = requestAnimationFrame(detectAndSetCurrentPage);
    }, [detectAndSetCurrentPage]);

    // ---- applyState (NO immediate forceRerender; only scheduleTick once/frame) ----
    const commitRafRef = useRef(0);

    const applyState = useCallback(
        (partial, commit = true) => {
            const prev = stateRef.current;
            const nextScale = clamp(partial.scale ?? prev.scale, MIN_SCALE, MAX_SCALE);
            const next = { ...prev, ...partial, scale: nextScale };

            stateRef.current = next;

            updateBounds();
            next.y = clampY(next.y);
            stateRef.current = next;

            // Fast path: DOM transform (no React)
            if (contentRef.current) {
                contentRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
                contentRef.current.style.transformOrigin = "0 0";
            }

            // Derived UI + virtualization at most once/frame
            scheduleTick();
            scheduleDetectPage();

            // Commit to store at most once/frame
            if (commit) {
                if (commitRafRef.current) cancelAnimationFrame(commitRafRef.current);
                commitRafRef.current = requestAnimationFrame(() => {
                    commitRafRef.current = 0;
                    setViewport(stateRef.current);
                });
            }
        },
        [clampY, scheduleDetectPage, scheduleTick, setViewport, updateBounds]
    );

    // ---- bounds maintenance ----
    useLayoutEffect(() => {
        updateBounds();
        scheduleTick();
        scheduleDetectPage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numPages, viewMode, layoutVersion, currentPage, containerEl]);

    useEffect(() => {
        const onResize = () => {
            updateBounds();
            scheduleTick();
            scheduleDetectPage();
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [scheduleDetectPage, scheduleTick, updateBounds]);

    // ---- wheel: zoom + pan (ATTACHES RELIABLY) ----
    useEffect(() => {
        const container = containerEl;
        if (!container) return;

        const handleWheel = (e) => {
            e.preventDefault();

            const { scale, x, y } = stateRef.current;

            if (e.ctrlKey || e.metaKey) {
                markZooming();

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

            let dx = e.deltaX;
            let dy = e.deltaY;

            if (e.shiftKey) {
                if (dx === 0) dx = dy;
                dy = 0;
            }

            if (dx === 0 && dy === 0) return;

            applyState({ x: x - dx, y: y - dy });
        };

        container.addEventListener("wheel", handleWheel, {
            passive: false,
            capture: true,
        });
        return () =>
            container.removeEventListener("wheel", handleWheel, { capture: true });
    }, [applyState, containerEl, markZooming]);

    // ---- mode switch positioning ----
    // ---- mode switch positioning & explicit jumps ----
    const { jumpToPage, setJumpToPage } = useAppStore();

    useEffect(() => {
        if (!numPages) return;

        const container = containerRef.current;
        if (!container) return;

        const targetPage = jumpToPage || currentPage;

        const idx = Math.max(0, Math.min(numPages - 1, targetPage - 1));
        const hs = baseHeightsRef.current;

        let pageTop = PADDING;
        for (let i = 0; i < idx; i++) pageTop += (hs[i] || DEFAULT_PAGE_H) + PAGE_GAP;

        const { scale } = stateRef.current;

        let targetY;

        if (jumpToPage) {
            // ✅ suppress auto-detect briefly so it doesn't snap to next page while settling
            suppressDetectUntilRef.current = performance.now() + 250;

            // ✅ update immediately (so thumbnails highlight the clicked page instantly)
            if (currentPageRef) currentPageRef.current = targetPage;
            if (currentPage !== targetPage) setCurrentPage(targetPage);

            // ✅ bias a little INTO the page so we never land in the gap/boundary
            const BIAS_INTO_PAGE = 10; // base coords (unscaled)

            // Align top of page near top of viewport, but slightly inside the page
            targetY = -(pageTop * scale) + PADDING + BIAS_INTO_PAGE * scale;
        } else {
            // Center logic (mode switch / recenter)
            const pageH = hs[idx] || DEFAULT_PAGE_H;
            targetY = container.clientHeight / 2 - (pageTop + pageH / 2) * scale;
        }

        applyState({ y: targetY }, true);

        if (jumpToPage) {
            setJumpToPage(null); // consume trigger
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, jumpToPage, numPages]);

    // ---- keyboard zoom ----
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (!(e.key === "=" || e.key === "+" || e.key === "-")) return;

            e.preventDefault();
            markZooming();

            const zoomIn = e.key !== "-";
            const { scale, x, y } = stateRef.current;
            const factor = zoomIn ? 1.25 : 0.8;
            const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const mx = rect.width / 2;
            const my = rect.height / 2;

            const wx = (mx - x) / scale;
            const wy = (my - y) / scale;

            const newX = mx - wx * newScale;
            const newY = my - wy * newScale;

            applyState({ scale: newScale, x: newX, y: newY });
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [applyState, markZooming]);

    // ---- mouse pan ----
    const onMouseDown = (e) => {
        const shouldPan = e.button === 1 || activeTool === "pan" || e.shiftKey;
        if (!shouldPan) return;

        startedPanButtonRef.current = e.button;
        isPanningRef.current = true;
        setDragging(true);
        lastMouseRef.current = { x: e.clientX, y: e.clientY };

        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseMove = (e) => {
        if (!isPanningRef.current) return;
        e.stopPropagation();

        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };

        const { x, y } = stateRef.current;
        applyState({ x: x + dx, y: canScrollY() ? y + dy : y });
    };

    const stopPan = (e) => {
        if (!isPanningRef.current) return;

        isPanningRef.current = false;
        setDragging(false);

        if (startedPanButtonRef.current === 1) {
            suppressNextClickRef.current = true;
            setTimeout(() => (suppressNextClickRef.current = false), 0);
        }
        startedPanButtonRef.current = null;

        e?.preventDefault?.();
        e?.stopPropagation?.();
    };

    useEffect(() => {
        window.addEventListener("mouseup", stopPan);
        return () => window.removeEventListener("mouseup", stopPan);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- sync from store (external) ----
    useEffect(() => {
        const dScale = Math.abs((storeViewport.scale ?? 1) - stateRef.current.scale);
        const dX = Math.abs((storeViewport.x ?? 0) - stateRef.current.x);
        const dY = Math.abs((storeViewport.y ?? 0) - stateRef.current.y);

        if (dScale > 0.001 || dX > 1 || dY > 1) {
            applyState(
                {
                    scale: storeViewport.scale ?? stateRef.current.scale,
                    x: storeViewport.x ?? stateRef.current.x,
                    y: storeViewport.y ?? stateRef.current.y,
                },
                false
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storeViewport]);

    // ---- virtualization ----
    const getVisibleRange = useCallback(() => {
        const container = containerRef.current;
        if (!container || !numPages) return { start: 0, end: -1 };

        const { y, scale } = stateRef.current;

        const viewTop = (-y) / scale;
        const viewBottom = (container.clientHeight - y) / scale;

        const overscan = 1500 / scale;
        const minY = viewTop - overscan;
        const maxY = viewBottom + overscan;

        const hs = baseHeightsRef.current;

        let cursor = PADDING;
        let start = 0;
        for (let i = 0; i < numPages; i++) {
            const h = hs[i] || DEFAULT_PAGE_H;
            const top = cursor;
            const bottom = top + h;
            if (bottom >= minY) {
                start = i;
                break;
            }
            cursor = bottom + PAGE_GAP;
        }

        cursor = PADDING;
        let end = numPages - 1;
        for (let i = 0; i < numPages; i++) {
            const h = hs[i] || DEFAULT_PAGE_H;
            const top = cursor;
            const bottom = top + h;
            if (top > maxY) {
                end = Math.max(0, i - 1);
                break;
            }
            cursor = bottom + PAGE_GAP;
        }

        return { start, end };
    }, [numPages, PAGE_GAP]);

    const visibleRange = useMemo(
        () => getVisibleRange(),
        // tick is throttled to 1/frame
        [tick, numPages, viewMode, getVisibleRange]
    );

    useEffect(() => {
        if (viewMode !== "continuous") return;
        const { start, end } = visibleRange;
        if (end < start) return;

        // 1. Ensure visible pages are loaded
        for (let i = start; i <= end; i++) ensurePageLoaded(i + 1);

        // 2. Prune invisible pages (Garbage Collection)
        const CACHE_BUFFER = 2; // Reduced from 5 to 2 for Extreme Memory Optimization
        const minKeep = start - CACHE_BUFFER;
        const maxKeep = end + CACHE_BUFFER;

        for (const [pageNum, pageProxy] of pageCacheRef.current.entries()) {
            const pageIdx = pageNum - 1;
            if (pageIdx < minKeep || pageIdx > maxKeep) {
                // Release memory
                try {
                    pageProxy.cleanup();
                } catch (e) {
                    console.warn(`Failed to cleanup page ${pageNum}`, e);
                }
                pageCacheRef.current.delete(pageNum);
            }
        }
    }, [ensurePageLoaded, visibleRange, viewMode]);

    // ---- scrollbar ----
    const MIN_THUMB = 24;
    const TRACK_PAD = 4;

    const getThumbHeight = () => {
        const container = containerRef.current;
        if (!container) return 60;

        const trackH = container.clientHeight - TRACK_PAD * 2;
        const range = getScrollRange();
        if (range <= 0) return trackH;

        const visibleFrac = container.clientHeight / (container.clientHeight + range);
        return clamp(trackH * visibleFrac, MIN_THUMB, trackH);
    };

    const thumbH = getThumbHeight();

    const getThumbTranslateY = (thumbHeight) => {
        const container = containerRef.current;
        if (!container) return 0;

        const range = getScrollRange();
        if (range <= 0) return 0;

        const trackH = container.clientHeight - TRACK_PAD * 2;
        const maxThumb = Math.max(0, trackH - thumbHeight);

        const { maxY } = boundsRef.current;
        const t = ((maxY - stateRef.current.y) / range) * maxThumb;
        return clamp(t, 0, maxThumb);
    };

    const thumbY = getThumbTranslateY(thumbH);

    const { topSpacerH, bottomSpacerH, renderIndices } = useMemo(() => {
        if (viewMode !== "continuous" || !numPages) {
            return { topSpacerH: 0, bottomSpacerH: 0, renderIndices: [] };
        }

        const hs = baseHeightsRef.current;
        const { start, end } = visibleRange;

        let top = 0;
        for (let i = 0; i < start; i++) top += (hs[i] || DEFAULT_PAGE_H) + PAGE_GAP;

        let bottom = 0;
        for (let i = end + 1; i < numPages; i++)
            bottom += (hs[i] || DEFAULT_PAGE_H) + PAGE_GAP;

        const indices = [];
        for (let i = start; i <= end; i++) indices.push(i);

        return { topSpacerH: top, bottomSpacerH: bottom, renderIndices: indices };
    }, [visibleRange, numPages, viewMode, layoutVersion]);

    const getCursor = () => {
        if (dragging) return "grabbing";
        if (activeTool === "pan") return "grab";
        return "default";
    };

    // NOTE: avoid calling ensurePageLoaded during render if you can.
    // We'll keep it (best-effort), but it still can cause extra microtasks.
    useEffect(() => {
        if (!document) return;
        if (viewMode === "single") ensurePageLoaded(currentPage);
    }, [currentPage, document, ensurePageLoaded, viewMode]);

    return (
        <div
            className="w-full h-full overflow-hidden bg-[var(--viewer-bg)] relative touch-none"
            ref={setContainerNode}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={stopPan}
            onMouseLeave={stopPan}
            onAuxClickCapture={(e) => {
                if (!suppressNextClickRef.current) return;
                e.preventDefault();
                e.stopPropagation();
            }}
            onClickCapture={(e) => {
                if (!suppressNextClickRef.current) return;
                e.preventDefault();
                e.stopPropagation();
            }}
            style={{ cursor: getCursor(), userSelect: "none" }}
        >
            <div
                ref={contentRef}
                className="absolute top-0 left-0 will-change-transform flex flex-col w-fit min-w-full"
                style={{
                    transform: `translate(${stateRef.current.x}px, ${stateRef.current.y}px) scale(${stateRef.current.scale})`,
                    transformOrigin: "0 0",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: `${PADDING}px`,
                }}
            >
                {viewMode === "single" ? (
                    (() => {
                        const page = pageCacheRef.current.get(currentPage);
                        return (
                            <div
                                className="pdf-page-container"
                                data-page-number={currentPage}
                                style={{ position: "relative", width: "fit-content" }}
                            >
                                {page ? (
                                    <PDFPage
                                        page={page}
                                        scale={1}
                                        renderScale={effectiveRenderScale}
                                        rotation={pageRotations?.[currentPage - 1] || 0}
                                        isInteracting={isZooming || dragging}
                                    />
                                ) : (
                                    <div style={{ width: DEFAULT_PAGE_W, height: DEFAULT_PAGE_H }} />
                                )}
                            </div>
                        );
                    })()
                ) : (
                    <>
                        {topSpacerH > 0 && <div style={{ height: topSpacerH }} />}

                        {renderIndices.map((i) => {
                            const pageNumber = i + 1;
                            const page = pageCacheRef.current.get(pageNumber);
                            const h = baseHeightsRef.current[i] || DEFAULT_PAGE_H;

                            return (
                                <div
                                    key={pageNumber}
                                    className="pdf-page-container"
                                    data-page-number={pageNumber}
                                    style={{
                                        position: "relative",
                                        width: "fit-content",
                                        minHeight: h,
                                        background: "transparent",
                                        marginBottom: pageNumber < numPages ? `${PAGE_GAP}px` : "0px",
                                    }}
                                >
                                    {page ? (
                                        <PDFPage
                                            page={page}
                                            scale={1}
                                            renderScale={effectiveRenderScale}
                                            rotation={pageRotations?.[pageNumber - 1] || 0}
                                            isInteracting={isZooming || dragging}
                                        />
                                    ) : (
                                        <div style={{ width: DEFAULT_PAGE_W, height: h }} />
                                    )}
                                </div>
                            );
                        })}

                        {bottomSpacerH > 0 && <div style={{ height: bottomSpacerH }} />}
                    </>
                )}
            </div>

            {viewMode === "continuous" && canScrollY() && (
                <div
                    style={{
                        position: "absolute",
                        right: 4,
                        top: TRACK_PAD,
                        bottom: TRACK_PAD,
                        width: 8,
                        backgroundColor: "rgba(0, 0, 0, 0.1)",
                        borderRadius: 4,
                        zIndex: 100,
                    }}
                >
                    <div
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();

                            const range = getScrollRange();
                            if (range <= 0) return;

                            const container = containerRef.current;
                            if (!container) return;

                            isThumbDraggingRef.current = true;

                            const startClientY = e.clientY;
                            const startThumbY = getThumbTranslateY(thumbH);

                            const trackH = container.clientHeight - TRACK_PAD * 2;
                            const maxThumb = Math.max(1, trackH - thumbH);

                            const onDrag = (moveEvent) => {
                                const delta = moveEvent.clientY - startClientY;
                                const newThumbY = clamp(startThumbY + delta, 0, maxThumb);

                                const { maxY } = boundsRef.current;
                                const newY = maxY - (newThumbY / maxThumb) * range;

                                applyState({ y: newY });
                            };

                            const onUp = () => {
                                window.removeEventListener("mousemove", onDrag);
                                window.removeEventListener("mouseup", onUp);
                                isThumbDraggingRef.current = false;
                            };

                            window.addEventListener("mousemove", onDrag);
                            window.addEventListener("mouseup", onUp);
                        }}
                        style={{
                            position: "absolute",
                            top: 0,
                            width: "100%",
                            height: thumbH,
                            backgroundColor: "rgba(100, 100, 100, 0.6)",
                            borderRadius: 4,
                            cursor: "pointer",
                            transform: `translateY(${thumbY}px)`,
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export default PDFViewer;
