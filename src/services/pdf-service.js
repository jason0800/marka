import * as pdfjsLib from 'pdfjs-dist';
// Import worker as a URL so Vite processes it correctly
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const loadPDF = async (file) => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        // Using standard font data is essential for rendering text correctly if fonts are missing
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            // Matches the installed version ^5.4.530
            cMapUrl: 'https://unpkg.com/pdfjs-dist@5.4.530/cmaps/',
            cMapPacked: true,
        });
        return await loadingTask.promise;
    } catch (error) {
        console.error("Error loading PDF:", error);
        throw error;
    }
};

export const renderPageToCanvas = async (page, canvas, scale = 1.0) => {
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext('2d');

    const renderContext = {
        canvasContext: context,
        viewport: viewport,
    };

    // Clear canvas before render
    context.clearRect(0, 0, canvas.width, canvas.height);

    return await page.render(renderContext).promise;
};
