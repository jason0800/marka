import { useEffect, useRef, useState } from "react";
import useAppStore from "../../stores/useAppStore";
import PDFPage from "./PDFPage";
import classes from "./PDFViewer.module.css";

const PDFViewer = ({ document }) => {
    // --- Store (NEW viewport-based store) ---
    const { viewport, setViewport, activeTool } = useAppStore();
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

    // --- Pages State ---
    const [pages, setPages] = useState([]);

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

    // Wheel listener (non-passive so we can preventDefault)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onWheel = (e) => {
            // Your rule: Ctrl/Meta OR NOT Shift => zoom
            if (e.ctrlKey || e.metaKey || !e.shiftKey) {
                e.preventDefault();

                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const { visualScale: currentScale, pan: currentPan } = stateRef.current;

                // screen -> world
                const worldX = (mouseX - currentPan.x) / currentScale;
                const worldY = (mouseY - currentPan.y) / currentScale;

                // additive zoom (kept from your code)
                const zoomFactor = -e.deltaY * 0.002 * currentScale;
                const newScale = Math.min(Math.max(0.1, currentScale + zoomFactor), 8.0);

                // world -> screen (keep cursor point stable)
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
            }
        };

        container.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            container.removeEventListener("wheel", onWheel);
        };
    }, [setViewport]);

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
        const ny = e.clientY - dragStart.y;

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
            {/* OUTER: pan only (never scaled) */}
            <div
                className={classes.contentLayer}
                style={{
                    transform: `translate(${pan.x}px, ${pan.y}px)`,
                    transformOrigin: '0 0'
                }}
            >
                {/* INNER: visual-only scale bridge */}
                <div
                    style={{
                        transform: `scale(${cssScale})`,
                        transformOrigin: '0 0'
                    }}
                >
                    {pages.map((page, index) => (
                        <PDFPage key={index} page={page} scale={renderScale} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PDFViewer;
