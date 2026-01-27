import { useRef, useEffect, memo, useMemo } from "react";
import OverlayLayer from "../Overlay/OverlayLayer";
import classes from "./PDFPage.module.css";

const PDFPage = memo(
    ({ page, scale = 1.0, renderScale = 1.0 }) => {
        const canvasRef = useRef(null);
        const textLayerRef = useRef(null);

        // CSS/layout size (keep stable, usually scale=1 in your viewer)
        const cssViewport = useMemo(() => page.getViewport({ scale }), [page, scale]);
        const { width, height } = cssViewport;

        useEffect(() => {
            if (!page || !canvasRef.current || !textLayerRef.current) return;

            const canvas = canvasRef.current;
            const textLayerDiv = textLayerRef.current;

            const dpr = window.devicePixelRatio || 1;

            // Render at higher resolution to match viewer zoom
            const effectiveRenderScale = Math.max(0.01, scale * renderScale);
            const renderViewport = page.getViewport({ scale: effectiveRenderScale });

            // --- Canvas ---
            const ctx = canvas.getContext("2d", { alpha: false });

            // IMPORTANT: reset transform each time (prevents stacking blur/scale bugs)
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Internal bitmap size (physical pixels)
            canvas.width = Math.floor(renderViewport.width * dpr);
            canvas.height = Math.floor(renderViewport.height * dpr);

            // On-screen size (logical CSS pixels) — keep at unscaled layout size
            canvas.style.width = `${Math.floor(width)}px`;
            canvas.style.height = `${Math.floor(height)}px`;

            // Render into high-res buffer
            const renderTask = page.render({
                canvasContext: ctx,
                viewport: renderViewport,
                transform: [dpr, 0, 0, dpr, 0, 0],
            });

            // --- Text layer ---
            textLayerDiv.innerHTML = "";
            textLayerDiv.style.width = `${Math.floor(width)}px`;
            textLayerDiv.style.height = `${Math.floor(height)}px`;
            textLayerDiv.style.setProperty("--scale-factor", String(effectiveRenderScale));

            let textCancelled = false;

            page
                .getTextContent()
                .then((textContent) => {
                    if (textCancelled) return;

                    return import("pdfjs-dist/build/pdf").then((pdfjs) => {
                        if (textCancelled) return;

                        if (pdfjs.renderTextLayer) {
                            return pdfjs
                                .renderTextLayer({
                                    textContentSource: textContent,
                                    container: textLayerDiv,
                                    viewport: renderViewport,
                                    textDivs: [],
                                })
                                .promise;
                        }
                    });
                })
                .catch(() => { });

            return () => {
                textCancelled = true;
                try {
                    renderTask.cancel();
                } catch { }
            };
        }, [page, scale, renderScale, width, height]);

        return (
            <div className={classes.pageContainer} style={{ width, height, position: "relative" }}>
                <canvas ref={canvasRef} className={classes.pageCanvas} />
                <div ref={textLayerRef} className="textLayer" />

                {width > 0 && (
                    <OverlayLayer page={page} width={width} height={height} viewScale={scale * renderScale} />
                )}
            </div>
        );
    },
    (prev, next) =>
        prev.page === next.page &&
        prev.scale === next.scale &&
        prev.renderScale === next.renderScale
);

export default PDFPage;
