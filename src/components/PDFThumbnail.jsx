import React, { useEffect, useRef, useState, memo } from 'react';
import useAppStore from '../stores/useAppStore';

const PDFThumbnail = memo(({ document, pageNumber, width = 180, isActive, onClick }) => {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const [page, setPage] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const renderTaskRef = useRef(null);

    // Intersection Observer to lazy load
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.1 }
        );

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => observer.disconnect();
    }, []);

    // Fetch page when visible
    useEffect(() => {
        if (!isVisible || !document || page) return;

        let active = true;
        document.getPage(pageNumber).then((p) => {
            if (active) setPage(p);
        }).catch(console.error);

        return () => { active = false; };
    }, [isVisible, document, pageNumber, page]);

    // Render page to canvas
    useEffect(() => {
        if (!page || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { alpha: false });

        // Cancel previous render if any
        if (renderTaskRef.current) {
            try {
                renderTaskRef.current.cancel();
            } catch (e) { }
        }

        // Calculate scale to fit width
        // Use scale 1 viewport to get aspect ratio
        const viewport = page.getViewport({ scale: 1 });
        const scale = width / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        // Set dimensions
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        const renderContext = {
            canvasContext: ctx,
            viewport: scaledViewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        renderTask.promise.catch((err) => {
            if (err.name !== 'RenderingCancelledException') {
                console.error('Thumbnail render error:', err);
            }
        });

        return () => {
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch (e) { }
            }
        };
    }, [page, width]);

    return (
        <div
            ref={containerRef}
            onClick={onClick}
            className={`cursor-pointer rounded-lg p-2 transition-colors hover:bg-[var(--bg-secondary)] flex flex-col items-center gap-2 ${isActive ? 'bg-[var(--bg-secondary)] ring-2 ring-[var(--primary-color)]' : ''
                }`}
        >
            <div className="relative bg-white shadow-sm border border-[var(--border-color)]">
                {/* Placeholder / Loading State */}
                {!page && (
                    <div
                        style={{ width: width, height: width * 1.4 }}
                        className="flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs"
                    >
                        Loading...
                    </div>
                )}

                <canvas ref={canvasRef} className="block" />
            </div>
            <span className="text-xs text-[var(--text-secondary)] font-medium">
                {pageNumber}
            </span>
        </div>
    );
});

export default PDFThumbnail;
