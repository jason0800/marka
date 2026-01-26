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
        viewMode,
    } = useAppStore();

    // --- Refs ---
    const containerRef = useRef(null);
    const contentRef = useRef(null);
    const rafRef = useRef(null);

    const isDraggingRef = useRef(false);
    const lastMouseRef = useRef({ x: 0, y: 0 });

    const stateRef = useRef({
        scale: storeViewport.scale || 1,
        x: storeViewport.x || 0,
        y: storeViewport.y || 0,
    });

    const startedPanButtonRef = useRef(null);      // which button started the pan
    const suppressNextClickRef = useRef(false);    // block the click after a middle-pan

    // --- Local UI state (for cursor re-render) ---
    const [pages, setPages] = useState([]);
    const [dragging, setDragging] = useState(false);

    // --- Constants ---
    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const PADDING = 40;

    // --- Bounds (vertical clamping) ---
    const boundsRef = useRef({ minY: PADDING, maxY: PADDING });

    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    const updateBounds = () => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;

        const containerH = container.clientHeight;

        // Layout height (untransformed). We transform scale ourselves.
        const pages = content.querySelectorAll(".pdf-page-container");
        if (!pages.length) return;

        const lastPage = pages[pages.length - 1];

        // bottom of last page in content coordinates
        const lastPageBottom = lastPage.offsetTop + lastPage.offsetHeight;

        const scale = stateRef.current.scale;
        const scaledContentH = lastPageBottom * scale;

        const maxY = PADDING;
        const minY = Math.min(maxY, containerH - scaledContentH - PADDING);

        boundsRef.current = { minY, maxY };
    };

    const clampY = (y) => {
        const { minY, maxY } = boundsRef.current;
        return Math.min(maxY, Math.max(minY, y));
    };

    // --- Apply state (single gateway for all pan/zoom) ---
    const applyState = (partial, commit = true) => {
        const prev = stateRef.current;

        const nextScale = clamp(partial.scale ?? prev.scale, MIN_SCALE, MAX_SCALE);

        // Build next
        const next = {
            ...prev,
            ...partial,
            scale: nextScale,
        };

        // bounds depend on scale & content/container
        stateRef.current = next;
        updateBounds();

        // clamp Y after bounds are updated
        next.y = clampY(next.y);

        stateRef.current = next;

        // Fast DOM update
        if (contentRef.current) {
            contentRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
            contentRef.current.style.transformOrigin = "0 0";
        }

        // Commit to store (throttled)
        if (commit) {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => setViewport(next));
        }
    };

    // --- 1) Load pages ---
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

    // --- 2) Bounds maintenance ---
    useLayoutEffect(() => {
        updateBounds();
    }, [pages.length, viewMode]);

    useEffect(() => {
        const onResize = () => updateBounds();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    // --- 3) Wheel: zoom (ctrl/cmd) + pan ---
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            e.preventDefault();

            const { scale, x, y } = stateRef.current;

            // Zoom (Ctrl/Cmd + wheel)
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

            // Pan (wheel)
            let dx = e.deltaX;
            let dy = e.deltaY;

            if (e.shiftKey) {
                if (dx === 0) dx = dy;
                dy = 0;
            }

            applyState({ x: x - dx, y: y - dy });
        };

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => container.removeEventListener("wheel", handleWheel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- 4) Keyboard zoom (Ctrl/Cmd +/-) ---
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

    // --- 5) Mouse drag pan ---
    const onMouseDown = (e) => {
        const shouldPan = e.button === 1 || activeTool === "pan" || e.shiftKey;
        if (!shouldPan) return;

        startedPanButtonRef.current = e.button;
        isDraggingRef.current = true;
        setDragging(true);
        lastMouseRef.current = { x: e.clientX, y: e.clientY };

        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseMove = (e) => {
        if (!isDraggingRef.current) return;
        e.stopPropagation();

        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;

        lastMouseRef.current = { x: e.clientX, y: e.clientY };

        const { x, y } = stateRef.current;
        applyState({ x: x + dx, y: y + dy });
    };

    const stopDrag = (e) => {
        if (!isDraggingRef.current) return;

        isDraggingRef.current = false;
        setDragging(false);

        // If pan started with middle mouse, block the follow-up auxclick/click
        if (startedPanButtonRef.current === 1) {
            suppressNextClickRef.current = true;
            // release after the current event loop (so it only blocks the immediate click)
            setTimeout(() => {
                suppressNextClickRef.current = false;
            }, 0);
        }

        startedPanButtonRef.current = null;

        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseUp = stopDrag;

    // Global mouseup so middle button release always stops dragging
    useEffect(() => {
        window.addEventListener("mouseup", stopDrag);
        return () => window.removeEventListener("mouseup", stopDrag);
    }, []);

    // --- 6) Sync from store (external changes) ---
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

    // --- 7) Page navigation sync (continuous) ---
    useEffect(() => {
        if (!contentRef.current) return;

        const pageEl = contentRef.current.querySelector(
            `[data-page-number="${currentPage}"]`
        );
        if (!pageEl) return;

        const pageTop = pageEl.offsetTop;
        const { scale } = stateRef.current;

        const targetY = PADDING - pageTop * scale;
        applyState({ y: targetY });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    // --- Cursor ---
    const getCursor = () => {
        if (dragging) return "grabbing";
        if (activeTool === "pan") return "grab";
        return "default";
    };

    // --- Scrollbar (simple, but consistent) ---

    const MIN_THUMB = 24;
    const TRACK_PAD = 4; // matches your scrollbar container padding-ish

    const getThumbHeight = () => {
        const container = containerRef.current;
        if (!container) return 60;

        const trackH = container.clientHeight - TRACK_PAD * 2;

        const { minY, maxY } = boundsRef.current;
        const range = Math.max(0, maxY - minY); // scrollable distance

        // If no scrolling, thumb fills track
        if (range <= 0) return trackH;

        const visibleFrac = container.clientHeight / (container.clientHeight + range);
        return clamp(trackH * visibleFrac, MIN_THUMB, trackH);
    };

    const thumbH = getThumbHeight();

    const getThumbTranslateY = (thumbH) => {
        const container = containerRef.current;
        if (!container) return 0;

        const trackH = container.clientHeight - TRACK_PAD * 2;
        const maxThumb = Math.max(0, trackH - thumbH);

        const { minY, maxY } = boundsRef.current;
        const range = Math.max(1, maxY - minY);

        // y=maxY -> 0, y=minY -> maxThumb
        const t = ((maxY - stateRef.current.y) / range) * maxThumb;
        return clamp(t, 0, maxThumb);
    };

    return (
        <div
            className={classes.viewerContainer}
            ref={containerRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
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
            {/* Content Layer (transform is also imperatively updated via applyState) */}
            <div
                ref={contentRef}
                className={classes.contentLayer}
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
                        <div className="pdf-page-container" data-page-number={currentPage}>
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
                                borderBottom: index < pages.length - 1 ? "1px solid #c0c0c0" : "none",
                                paddingBottom: index < pages.length - 1 ? "20px" : "0",
                                marginBottom: index < pages.length - 1 ? "20px" : "0",
                                width: "fit-content",
                            }}
                        >
                            <PDFPage page={page} scale={1} />
                        </div>
                    ))
                )}
            </div>

            {/* Custom Scrollbar (still simplistic mapping, but drag works correctly) */}
            <div
                style={{
                    position: "absolute",
                    right: 4,
                    top: TRACK_PAD,
                    bottom: 4,
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
                        const startY = e.clientY;
                        const startPanY = stateRef.current.y;

                        const onDrag = (moveEvent) => {
                            const deltaY = moveEvent.clientY - startY;

                            const trackH = containerRef.current.clientHeight - 8; // rough, account for padding
                            const thumbH = 60;
                            const maxThumb = Math.max(1, trackH - thumbH);

                            const { minY, maxY } = boundsRef.current;
                            const contentRange = maxY - minY; // note: minY is usually negative

                            const contentDelta = (deltaY / maxThumb) * contentRange;

                            applyState({ y: startPanY - contentDelta }); // still inverted
                        };

                        const onUp = () => {
                            window.removeEventListener("mousemove", onDrag);
                            window.removeEventListener("mouseup", onUp);
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
                        transform: `translateY(${getThumbTranslateY(thumbH)}px)`,
                    }}
                />
            </div>
        </div>
    );
};

export default PDFViewer;
