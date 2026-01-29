import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useAppStore from "../stores/useAppStore";
import PDFPage from "./PDFPage";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const useDebouncedValue = (value, delay = 140) => {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
};

const PDFViewer = ({ document }) => {
    const {
        viewport: storeViewport,
        setViewport,
        activeTool,
        currentPage,
        setCurrentPage,
        viewMode,
    } = useAppStore();

    const containerRef = useRef(null);
    const contentRef = useRef(null);
    const rafCommitRef = useRef(null);

    const isPanningRef = useRef(false);
    const isThumbDraggingRef = useRef(false);
    const lastMouseRef = useRef({ x: 0, y: 0 });

    const startedPanButtonRef = useRef(null);
    const suppressNextClickRef = useRef(false);

    const currentPageRef = useRef(currentPage);
    useEffect(() => {
        currentPageRef.current = currentPage;
    }, [currentPage]);

    // imperative viewport truth (fast)
    const stateRef = useRef({
        scale: storeViewport.scale || 1,
        x: storeViewport.x || 0,
        y: storeViewport.y || 0,
    });

    const [pages, setPages] = useState([]);
    const [dragging, setDragging] = useState(false);
    const [, forceRerender] = useState(0);

    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const PADDING = 40;

    // ✅ key: expensive bitmap renders will use this, not live storeViewport.scale
    const debouncedRenderScale = useDebouncedValue(storeViewport.scale ?? 1, 140);

    // ---- bounds / scroll range (vertical) ----
    const boundsRef = useRef({ minY: PADDING, maxY: PADDING });

    const updateBounds = () => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;

        const containerH = container.clientHeight;

        const pageEls = content.querySelectorAll(".pdf-page-container");
        if (!pageEls.length) return;

        const lastPage = pageEls[pageEls.length - 1];
        const lastPageBottom = lastPage.offsetTop + lastPage.offsetHeight;

        const scale = stateRef.current.scale;
        const scaledContentH = lastPageBottom * scale;

        const maxY = PADDING;
        const computedMin = containerH - scaledContentH - PADDING;
        const minY = Math.min(maxY, computedMin);

        boundsRef.current = { minY, maxY };
    };

    const clampY = (y) => {
        const { minY, maxY } = boundsRef.current;
        return clamp(y, minY, maxY);
    };

    const getScrollRange = () => {
        const { minY, maxY } = boundsRef.current;
        return Math.max(0, maxY - minY);
    };

    const canScrollY = () => getScrollRange() > 0.5;

    // ---- page detection (single source, cheap) ----
    const pageDetectRafRef = useRef(0);

    const detectAndSetCurrentPage = () => {
        pageDetectRafRef.current = 0;

        if (viewMode !== "continuous") return;

        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;

        const pageEls = content.querySelectorAll(".pdf-page-container");
        if (!pageEls.length) return;

        const { y, scale } = stateRef.current;
        const probeY = (container.clientHeight / 2 - y) / scale;

        let bestIdx = 0;
        let bestDist = Infinity;

        for (let i = 0; i < pageEls.length; i++) {
            const el = pageEls[i];
            const top = el.offsetTop;
            const bottom = top + el.offsetHeight;

            if (probeY >= top && probeY < bottom) {
                bestIdx = i;
                bestDist = 0;
                break;
            }

            const dist = probeY < top ? top - probeY : probeY - bottom;
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }

        const newPage = bestIdx + 1;
        if (newPage !== currentPageRef.current) {
            currentPageRef.current = newPage;
            setCurrentPage(newPage);
        }
    };

    const scheduleDetectPage = () => {
        if (pageDetectRafRef.current) return;
        pageDetectRafRef.current = requestAnimationFrame(detectAndSetCurrentPage);
    };

    // ---- applyState (single gateway) ----
    const applyState = (partial, commit = true) => {
        const prev = stateRef.current;
        const nextScale = clamp(partial.scale ?? prev.scale, MIN_SCALE, MAX_SCALE);
        const next = { ...prev, ...partial, scale: nextScale };

        stateRef.current = next;
        updateBounds();

        next.y = clampY(next.y);
        stateRef.current = next;

        if (contentRef.current) {
            contentRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
            contentRef.current.style.transformOrigin = "0 0";
        }

        // keep thumb reactive
        forceRerender((n) => (n + 1) % 1000000);

        scheduleDetectPage();

        if (commit) {
            if (rafCommitRef.current) cancelAnimationFrame(rafCommitRef.current);
            rafCommitRef.current = requestAnimationFrame(() => setViewport(next));
        }
    };

    // ---- load pages (unchanged; still eager loads all) ----
    useEffect(() => {
        if (!document) return;
        let cancelled = false;

        const load = async () => {
            const num = document.numPages;
            const loaded = [];
            for (let i = 1; i <= num; i++) {
                const page = await document.getPage(i);
                loaded.push(page);
            }
            if (!cancelled) setPages(loaded);
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [document]);

    // ---- bounds maintenance ----
    useLayoutEffect(() => {
        updateBounds();
        scheduleDetectPage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages.length, viewMode]);

    useEffect(() => {
        const onResize = () => {
            updateBounds();
            forceRerender((n) => (n + 1) % 1000000);
            scheduleDetectPage();
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- wheel: zoom + pan ----
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            e.preventDefault();

            const { scale, x, y } = stateRef.current;

            // zoom about mouse
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

            // wheel pan
            let dx = e.deltaX;
            let dy = e.deltaY;

            if (e.shiftKey) {
                if (dx === 0) dx = dy;
                dy = 0;
            }

            if (!canScrollY()) dy = 0;
            if (dx === 0 && dy === 0) return;

            applyState({ x: x - dx, y: y - dy });
        };

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => container.removeEventListener("wheel", handleWheel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode]);

    // ---- keyboard zoom ----
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (!(e.key === "=" || e.key === "+" || e.key === "-")) return;

            e.preventDefault();

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            setTimeout(() => {
                suppressNextClickRef.current = false;
            }, 0);
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

    // ---- cursor ----
    const getCursor = () => {
        if (dragging) return "grabbing";
        if (activeTool === "pan") return "grab";
        return "default";
    };

    // ---- scrollbar mapping ----
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

    const thumbY = useMemo(() => getThumbTranslateY(thumbH), [thumbH, storeViewport]);

    // ---- render ----
    return (
        <div
            className="w-full h-full overflow-hidden bg-[var(--viewer-bg)] cursor-grab relative touch-none active:cursor-grabbing"
            ref={containerRef}
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
                className="absolute top-0 left-0 will-change-transform flex flex-col w-fit min-w-full p-[50px]"
                style={{
                    transform: `translate(${storeViewport.x}px, ${storeViewport.y}px) scale(${storeViewport.scale})`,
                    transformOrigin: "0 0",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: `${PADDING}px`,
                }}
            >
                {viewMode === "single" ? (
                    pages[currentPage - 1] && (
                        <div className="pdf-page-container" data-page-number={currentPage} style={{ position: "relative", width: "fit-content" }}>
                            {/* ✅ debouncedRenderScale */}
                            <PDFPage page={pages[currentPage - 1]} scale={1} renderScale={debouncedRenderScale} />
                        </div>
                    )
                ) : (
                    pages.map((page, index) => (
                        <div
                            key={index}
                            data-page-number={index + 1}
                            className="pdf-page-container"
                            style={{
                                position: "relative",
                                width: "fit-content",
                                borderBottom: index < pages.length - 1 ? "1px solid #c0c0c0" : "none",
                                paddingBottom: index < pages.length - 1 ? "20px" : "0",
                                marginBottom: index < pages.length - 1 ? "20px" : "0",
                            }}
                        >
                            {/* ✅ debouncedRenderScale */}
                            <PDFPage page={page} scale={1} renderScale={debouncedRenderScale} />
                        </div>
                    ))
                )}
            </div>

            {/* Scrollbar unchanged */}
            {canScrollY() && (
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
