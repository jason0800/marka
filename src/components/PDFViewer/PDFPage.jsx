import { useRef, useEffect, memo } from 'react';
import OverlayLayer from '../Overlay/OverlayLayer';
import classes from './PDFPage.module.css';

const PDFPage = memo(({ page, scale = 1.0 }) => {
    const canvasRef = useRef(null);
    const textLayerRef = useRef(null);

    // Calculate Viewport Synchronously to prevent layout thrashing
    const viewport = page.getViewport({ scale });
    const { width, height } = viewport;

    // Render Canvas Effect
    useEffect(() => {
        if (!page || !canvasRef.current || !textLayerRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        const outputScale = window.devicePixelRatio || 1;

        // Set Canvas Dimensions (Physical Pixels)
        canvas.width = Math.floor(width * outputScale);
        canvas.height = Math.floor(height * outputScale);

        // CSS Dimensions need to match viewport
        canvas.style.width = Math.floor(width) + "px";
        canvas.style.height = Math.floor(height) + "px";

        // Transform for HiDPI
        context.scale(outputScale, outputScale);

        // Render Canvas
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        const renderTask = page.render(renderContext);

        // Text Layer Logic
        const textLayerDiv = textLayerRef.current;
        textLayerDiv.innerHTML = "";
        textLayerDiv.style.setProperty('--scale-factor', scale);

        page.getTextContent().then(textContent => {
            if (textLayerDiv) {
                import('pdfjs-dist/build/pdf').then(pdfjs => {
                    if (pdfjs.renderTextLayer) {
                        pdfjs.renderTextLayer({
                            textContentSource: textContent,
                            container: textLayerDiv,
                            viewport: viewport,
                            textDivs: []
                        }).promise;
                    }
                }).catch(() => {
                    // Silent fail or fallback if imports missing
                });
            }
        });

        return () => {
            renderTask.cancel();
        };
    }, [page, scale, width, height, viewport]); // Dependencies

    return (
        <div className={classes.pageContainer} style={{ width, height }}>
            <canvas ref={canvasRef} className={classes.pageCanvas} />
            <div ref={textLayerRef} className="textLayer" style={{ width, height }}></div>
            {width > 0 && (
                <OverlayLayer
                    page={page}
                    width={width}
                    height={height}
                    viewScale={scale}
                />
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.scale === nextProps.scale && prevProps.page === nextProps.page;
});

export default PDFPage;
