import React, { useEffect, useRef, useState, memo, useCallback } from "react";

const PDFThumbnail = memo(function PDFThumbnail({
    document,
    pageNumber,
    width = 180,
    isActive,
    onSelect, // (pageNumber) => void
}) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const [page, setPage] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const renderTaskRef = useRef(null);

    // Click handler reads dataset to avoid any stale closure weirdness
    const handleClick = useCallback((e) => {
        const n = Number(e.currentTarget.dataset.page);
        if (Number.isFinite(n)) onSelect(n);
    }, [onSelect]);

    // Intersection Observer to lazy load
    useEffect(() => {
        const node = containerRef.current;
        if (!node) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    // Fetch page when visible
    useEffect(() => {
        if (!isVisible || !document) return;

        let cancelled = false;
        document
            .getPage(pageNumber)
            .then((p) => {
                if (!cancelled) setPage(p);
            })
            .catch(console.error);

        return () => {
            cancelled = true;
        };
    }, [isVisible, document, pageNumber]);

    // Render page to canvas
    useEffect(() => {
        if (!page || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d", { alpha: false });

        // Cancel previous render if any
        try {
            renderTaskRef.current?.cancel?.();
        } catch { }
        renderTaskRef.current = null;

        const vp1 = page.getViewport({ scale: 1 });
        const scale = width / vp1.width;
        const vp = page.getViewport({ scale });

        // Backing store in device pixels (optional DPR for sharper thumbs)
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.floor(vp.width * dpr));
        canvas.height = Math.max(1, Math.floor(vp.height * dpr));
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vp.width, vp.height);

        const task = page.render({
            canvasContext: ctx,
            viewport: vp,
        });

        renderTaskRef.current = task;

        task.promise.catch((err) => {
            if (err?.name !== "RenderingCancelledException") {
                console.error("Thumbnail render error:", err);
            }
        });

        return () => {
            try {
                task.cancel?.();
            } catch { }
        };
    }, [page, width]);

    return (
        <button
            ref={containerRef}
            type="button"
            data-page={pageNumber}
            onClick={handleClick}
            className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-[var(--bg-secondary)] flex flex-col items-center gap-2 text-left"
            style={{ width }}
        >
            <div
                className={`relative bg-white shadow-sm border transition-all duration-200 ${isActive
                        ? "border-[var(--primary-color)] ring-2 ring-[var(--primary-color)] ring-opacity-50"
                        : "border-[var(--border-color)]"
                    }`}
            >
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
        </button>
    );
});

export default PDFThumbnail;
