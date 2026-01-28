import { useRef, useEffect, memo, useMemo } from "react";
import OverlayLayer from "./OverlayLayer";

const PDFPage = memo(({ page, scale = 1.0, renderScale = 1.0 }) => {
    const canvasRef = useRef(null);
    const textLayerRef = useRef(null);
    const renderSeqRef = useRef(0);

    const cssViewport = useMemo(() => page.getViewport({ scale }), [page, scale]);
    const { width, height } = cssViewport;

    useEffect(() => {
        if (!page || !canvasRef.current || !textLayerRef.current) return;

        const seq = ++renderSeqRef.current;

        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;

        const dpr = window.devicePixelRatio || 1;
        const effectiveRenderScale = Math.max(0.01, scale * renderScale);
        const renderViewport = page.getViewport({ scale: effectiveRenderScale });

        // --- build offscreen buffer ---
        const offscreen = document.createElement("canvas");
        offscreen.width = Math.floor(renderViewport.width * dpr);
        offscreen.height = Math.floor(renderViewport.height * dpr);

        const offCtx = offscreen.getContext("2d", { alpha: false });
        offCtx.setTransform(1, 0, 0, 1, 0, 0);

        // kick render into offscreen (visible canvas stays showing old bitmap)
        const renderTask = page.render({
            canvasContext: offCtx,
            viewport: renderViewport,
            transform: [dpr, 0, 0, dpr, 0, 0],
        });

        // --- Text layer (optional: also delay clearing until render commit) ---
        let textCancelled = false;
        // Don't immediately nuke the text layer; wait until commit so it doesn't blink
        // (if you do want instant update, move the clear back above)
        const nextText = page
            .getTextContent()
            .then((textContent) => {
                if (textCancelled) return;
                return import("pdfjs-dist/build/pdf").then((pdfjs) => {
                    if (textCancelled) return;
                    if (pdfjs.renderTextLayer) {
                        const tmp = document.createElement("div");
                        tmp.style.width = `${Math.floor(width)}px`;
                        tmp.style.height = `${Math.floor(height)}px`;
                        tmp.style.setProperty("--scale-factor", String(effectiveRenderScale));

                        return pdfjs
                            .renderTextLayer({
                                textContentSource: textContent,
                                container: tmp,
                                viewport: renderViewport,
                                textDivs: [],
                            })
                            .promise.then(() => tmp);
                    }
                });
            })
            .catch(() => null);

        let cancelled = false;

        Promise.all([renderTask.promise, nextText]).then(([_, tmpTextDiv]) => {
            // only commit if this is still the latest render
            if (cancelled || renderSeqRef.current !== seq) return;

            // commit visible canvas size + css size
            canvas.width = offscreen.width;
            canvas.height = offscreen.height;
            canvas.style.width = `${Math.floor(width)}px`;
            canvas.style.height = `${Math.floor(height)}px`;

            const ctx = canvas.getContext("2d", { alpha: false });
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(offscreen, 0, 0);

            // commit text layer in one shot (no blink)
            if (tmpTextDiv) {
                textLayerDiv.innerHTML = "";
                textLayerDiv.style.width = `${Math.floor(width)}px`;
                textLayerDiv.style.height = `${Math.floor(height)}px`;
                textLayerDiv.style.setProperty("--scale-factor", String(effectiveRenderScale));
                textLayerDiv.append(...tmpTextDiv.childNodes);
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
            className="relative shadow-[0_2px_10px_rgba(0,0,0,0.3)] mb-5 bg-white leading-[0]"
            style={{ width, height, position: "relative" }}
        >
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
