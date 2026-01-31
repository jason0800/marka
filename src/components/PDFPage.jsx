import { memo, useEffect, useMemo, useRef } from "react";
import OverlayLayer from "./OverlayLayer";

/**
 * Why this version feels smoother on "one insanely detailed page":
 * - While user is zooming/panning fast: we DO NOT call page.render() at all.
 *   We just let the parent viewer's CSS transform scale/pan the existing bitmap.
 * - When interaction stops: we render ONCE (idle/debounced), canceling any in-flight render.
 * - We avoid re-importing pdfjs every render (cached).
 * - We keep canvas sizing stable and cap DPR + pixel budget.
 */

// Tweak these
const MAX_CANVAS_PIXELS = 20_000_000; // try 12–24MP for heavy drawings
const MAX_SIDE = 8192;               // many GPUs hate >8192 textures
const MAX_DPR = 2;                   // cap to reduce spikes on 3x/4x displays

// Cached, one-time import for renderTextLayer (if you want it)
let pdfjsTextLayerPromise = null;
const getTextLayerRenderer = () => {
    if (!pdfjsTextLayerPromise) {
        // renderTextLayer lives in different places depending on pdfjs version/build.
        // This tries a couple common ones.
        pdfjsTextLayerPromise = Promise.allSettled([
            import("pdfjs-dist/web/pdf_viewer"), // often has renderTextLayer
            import("pdfjs-dist/build/pdf"),      // fallback
        ]).then((results) => {
            for (const r of results) {
                if (r.status === "fulfilled") {
                    const mod = r.value;
                    if (mod?.renderTextLayer) return mod.renderTextLayer;
                    if (mod?.TextLayerBuilder?.prototype?.render) {
                        // Not a direct renderer; skip.
                    }
                }
            }
            return null;
        });
    }
    return pdfjsTextLayerPromise;
};

// requestIdleCallback fallback
const requestIdle = (cb) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        return window.requestIdleCallback(cb, { timeout: 250 });
    }
    return window.setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 50);
};

const cancelIdle = (id) => {
    if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(id);
        return;
    }
    clearTimeout(id);
};

const PDFPage = memo(function PDFPage({
    page,
    scale = 1.0,          // CSS/layout scale (often 1 in your viewer)
    renderScale = 1.0,     // "crispness" scale (what you were changing on zoom)
    rotation = 0,          // Page rotation in degrees
    isInteracting = false, // ✅ pass from viewer: (isZooming || dragging)
}) {
    const canvasRef = useRef(null);
    const textLayerRef = useRef(null);

    const renderTaskRef = useRef(null);
    const idleRef = useRef(0);
    const seqRef = useRef(0);

    // Reuse offscreen buffer to avoid realloc churn
    const offscreenRef = useRef(null);

    // Remember last rendered params to avoid pointless re-renders
    const lastRenderKeyRef = useRef("");

    // CSS viewport (stable box)
    const cssViewport = useMemo(() => page.getViewport({ scale, rotation }), [page, scale, rotation]);
    const { width, height } = cssViewport;

    // Always keep the visible canvas CSS sized correctly (cheap)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.style.width = `${Math.floor(width)}px`;
        canvas.style.height = `${Math.floor(height)}px`;
    }, [width, height]);

    useEffect(() => {
        if (!page || !canvasRef.current || !textLayerRef.current) return;

        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;

        // Cancel any scheduled/ongoing work on changes
        if (idleRef.current) cancelIdle(idleRef.current);
        idleRef.current = 0;

        try {
            renderTaskRef.current?.cancel?.();
        } catch { }
        renderTaskRef.current = null;

        const seq = ++seqRef.current;

        // While interacting: DO NOT re-render PDF.
        // Keep current bitmap and (optionally) hide heavy text layer.
        if (isInteracting) {
            // Optional: hide text layer during interaction to avoid layout/reflow spikes
            // (especially if you had it enabled).
            textLayerDiv.innerHTML = "";
            return;
        }

        // Defer the heavy render until the browser is idle-ish.
        idleRef.current = requestIdle(async () => {
            idleRef.current = 0;
            if (seqRef.current !== seq) return;

            const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

            // Desired raster scale
            const desired = Math.max(0.01, scale * renderScale);

            // Compute safe scale under pixel + side limits
            const baseVp = page.getViewport({ scale: 1, rotation });
            const baseW = baseVp.width;
            const baseH = baseVp.height;

            const sMaxByPixels = Math.sqrt(
                MAX_CANVAS_PIXELS / Math.max(1, baseW * baseH * dpr * dpr)
            );

            const sMaxBySide = Math.min(
                MAX_SIDE / Math.max(1, baseW * dpr),
                MAX_SIDE / Math.max(1, baseH * dpr)
            );

            const safeRenderScale = Math.min(desired, sMaxByPixels, sMaxBySide);

            // If we already rendered at essentially the same safe scale, skip.
            // (Prevents micro-stutter from tiny floating-point changes.)
            const renderKey = `${page.pageNumber}|${Math.round(safeRenderScale * 1000)}|${Math.round(dpr * 100)}|${Math.round(scale * 1000)}|${rotation}`;
            if (lastRenderKeyRef.current === renderKey) return;
            lastRenderKeyRef.current = renderKey;

            const renderViewport = page.getViewport({ scale: safeRenderScale, rotation });

            // Offscreen buffer
            let offscreen = offscreenRef.current;
            if (!offscreen) {
                offscreen = document.createElement("canvas");
                offscreenRef.current = offscreen;
            }

            const targetW = Math.max(1, Math.floor(renderViewport.width * dpr));
            const targetH = Math.max(1, Math.floor(renderViewport.height * dpr));

            // Resize only if needed (resize itself can be expensive)
            if (offscreen.width !== targetW) offscreen.width = targetW;
            if (offscreen.height !== targetH) offscreen.height = targetH;

            const offCtx = offscreen.getContext("2d", { alpha: false });

            // Clear
            offCtx.setTransform(1, 0, 0, 1, 0, 0);
            offCtx.clearRect(0, 0, offscreen.width, offscreen.height);

            // Start render
            const task = page.render({
                canvasContext: offCtx,
                viewport: renderViewport,
                transform: [dpr, 0, 0, dpr, 0, 0],
            });
            renderTaskRef.current = task;

            // Text layer: for heavy drawings, it can be expensive.
            // Suggest: keep it OFF or only enable at modest scales.
            const ENABLE_TEXT_LAYER = safeRenderScale <= 2.5; // tune
            const textPromise = ENABLE_TEXT_LAYER
                ? (async () => {
                    try {
                        const renderTextLayer = await getTextLayerRenderer();
                        if (!renderTextLayer) return null;

                        const textContent = await page.getTextContent();
                        if (seqRef.current !== seq) return null;

                        const tmp = document.createElement("div");
                        tmp.style.width = `${Math.floor(width)}px`;
                        tmp.style.height = `${Math.floor(height)}px`;
                        tmp.style.setProperty("--scale-factor", String(safeRenderScale));

                        // pdfjs renderTextLayer API differs across versions; this matches the common signature.
                        const res = renderTextLayer({
                            textContentSource: textContent,
                            container: tmp,
                            viewport: renderViewport,
                            textDivs: [],
                        });

                        // Some versions return { promise }, some return a Promise directly.
                        if (res?.promise) await res.promise;
                        else if (res?.then) await res;

                        return tmp;
                    } catch {
                        return null;
                    }
                })()
                : Promise.resolve(null);

            let tmpTextDiv = null;

            try {
                await task.promise;
                tmpTextDiv = await textPromise;
            } catch (err) {
                // ignore cancels
                if (err?.name !== "RenderingCancelledException") {
                    console.error("PDF render error:", err);
                }
                return;
            }

            // If newer request superseded this one, bail
            if (seqRef.current !== seq) return;

            // Commit to onscreen canvas (copy from offscreen)
            // Keep backing buffer sized to offscreen; CSS size stays stable.
            if (canvas.width !== offscreen.width) canvas.width = offscreen.width;
            if (canvas.height !== offscreen.height) canvas.height = offscreen.height;

            const ctx = canvas.getContext("2d", { alpha: false });
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(offscreen, 0, 0);

            // Commit text layer without blinking
            if (tmpTextDiv) {
                textLayerDiv.innerHTML = "";
                textLayerDiv.style.width = `${Math.floor(width)}px`;
                textLayerDiv.style.height = `${Math.floor(height)}px`;
                textLayerDiv.style.setProperty("--scale-factor", String(safeRenderScale));
                textLayerDiv.append(...tmpTextDiv.childNodes);
            } else {
                textLayerDiv.innerHTML = "";
            }
        });

        return () => {
            // Cancel pending
            if (idleRef.current) cancelIdle(idleRef.current);
            idleRef.current = 0;

            // Cancel render
            try {
                renderTaskRef.current?.cancel?.();
            } catch { }
            renderTaskRef.current = null;
        };
    }, [page, scale, renderScale, isInteracting, width, height, rotation]);

    return (
        <div className="relative leading-[0]" style={{ width, height }}>
            <canvas ref={canvasRef} className="block" />
            <div
                ref={textLayerRef}
                className="absolute inset-0 overflow-hidden leading-[1.0] pointer-events-none [&>span]:text-transparent [&>span]:absolute [&>span]:whitespace-pre [&>span]:cursor-text [&>span]:origin-[0%_0%] [&>span]:pointer-events-auto"
            />
            {width > 0 && (
                <OverlayLayer page={page} width={width} height={height} viewScale={scale * renderScale} />
            )}
        </div>
    );
});

export default PDFPage;
