import { useRef, useEffect, memo, useMemo } from "react";
import OverlayLayer from "./OverlayLayer";

// Tweak these
const MAX_CANVAS_PIXELS = 28_000_000; // ~28MP is usually safe (try 16-40MP)
const MAX_SIDE = 8192;               // many GPUs hate >8192 textures

const PDFPage = memo(({ page, scale = 1.0, renderScale = 1.0 }) => {
    const canvasRef = useRef(null);
    const textLayerRef = useRef(null);
    const renderSeqRef = useRef(0);

    // reuse offscreen buffer to avoid realloc churn
    const offscreenRef = useRef(null);

    const cssViewport = useMemo(() => page.getViewport({ scale }), [page, scale]);
    const { width, height } = cssViewport;

    useEffect(() => {
        if (!page || !canvasRef.current || !textLayerRef.current) return;

        const seq = ++renderSeqRef.current;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;

        const dpr = window.devicePixelRatio || 1;

        // Desired render scale
        const desired = Math.max(0.01, scale * renderScale);

        // Figure out the maximum render scale that fits our pixel budget
        // Start by measuring at scale=1 to get the page’s base pixel dimensions.
        const baseVp = page.getViewport({ scale: 1 });
        const baseW = baseVp.width;
        const baseH = baseVp.height;

        // pixels = (baseW*s*dpr) * (baseH*s*dpr) = baseW*baseH*(s^2)*(dpr^2)
        // => s_max = sqrt(MAX_PIXELS / (baseW*baseH*(dpr^2)))
        const sMaxByPixels = Math.sqrt(
            MAX_CANVAS_PIXELS / Math.max(1, baseW * baseH * dpr * dpr)
        );

        // Also cap by max texture side
        const sMaxBySide = Math.min(
            MAX_SIDE / Math.max(1, baseW * dpr),
            MAX_SIDE / Math.max(1, baseH * dpr)
        );

        const safeRenderScale = Math.min(desired, sMaxByPixels, sMaxBySide);

        const renderViewport = page.getViewport({ scale: safeRenderScale });

        // --- Offscreen buffer (reused) ---
        let offscreen = offscreenRef.current;
        if (!offscreen) {
            offscreen = document.createElement("canvas");
            offscreenRef.current = offscreen;
        }

        const targetW = Math.max(1, Math.floor(renderViewport.width * dpr));
        const targetH = Math.max(1, Math.floor(renderViewport.height * dpr));

        // Resize only if needed
        if (offscreen.width !== targetW) offscreen.width = targetW;
        if (offscreen.height !== targetH) offscreen.height = targetH;

        const offCtx = offscreen.getContext("2d", { alpha: false });
        offCtx.setTransform(1, 0, 0, 1, 0, 0);
        offCtx.clearRect(0, 0, offscreen.width, offscreen.height);

        const renderTask = page.render({
            canvasContext: offCtx,
            viewport: renderViewport,
            transform: [dpr, 0, 0, dpr, 0, 0],
        });

        // Optional: don’t render text layer when zoom is extreme (it can get heavy too)
        const ENABLE_TEXT_LAYER = safeRenderScale <= 3.5; // adjust
        let textCancelled = false;

        const nextText = ENABLE_TEXT_LAYER
            ? page
                .getTextContent()
                .then((textContent) => {
                    if (textCancelled) return null;
                    return import("pdfjs-dist/build/pdf").then((pdfjs) => {
                        if (textCancelled) return null;
                        if (!pdfjs.renderTextLayer) return null;

                        const tmp = document.createElement("div");
                        tmp.style.width = `${Math.floor(width)}px`;
                        tmp.style.height = `${Math.floor(height)}px`;
                        tmp.style.setProperty("--scale-factor", String(safeRenderScale));

                        return pdfjs
                            .renderTextLayer({
                                textContentSource: textContent,
                                container: tmp,
                                viewport: renderViewport,
                                textDivs: [],
                            })
                            .promise.then(() => tmp);
                    });
                })
                .catch(() => null)
            : Promise.resolve(null);

        let cancelled = false;

        Promise.all([renderTask.promise, nextText]).then(([_, tmpTextDiv]) => {
            if (cancelled || renderSeqRef.current !== seq) return;

            // Commit visible canvas (backing size is clamped; CSS size is always full zoom)
            canvas.width = offscreen.width;
            canvas.height = offscreen.height;
            canvas.style.width = `${Math.floor(width)}px`;
            canvas.style.height = `${Math.floor(height)}px`;

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
                // If disabled, at least clear once so it doesn't lag behind
                textLayerDiv.innerHTML = "";
            }
        });

        return () => {
            cancelled = true;
            textCancelled = true;
            try {
                renderTask.cancel();
            } catch { }
        };
    }, [page, scale, renderScale, width, height]);

    return (
        <div
            className="relative leading-[0]"
            style={{ width, height }}
        >
            <canvas ref={canvasRef} className="block" />
            <div
                ref={textLayerRef}
                className="absolute inset-0 overflow-hidden leading-[1.0] pointer-events-none [&>span]:text-transparent [&>span]:absolute [&>span]:whitespace-pre [&>span]:cursor-text [&>span]:origin-[0%_0%] [&>span]:pointer-events-auto"
            />
            {width > 0 && (
                <OverlayLayer
                    page={page}
                    width={width}
                    height={height}
                    viewScale={scale * renderScale}
                />
            )}
        </div>
    );

});

export default PDFPage;
