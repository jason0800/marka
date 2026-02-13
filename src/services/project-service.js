/**
 * Project Service - Handles .marka file save/load operations
 */

/**
 * Save current project state to a .marka file
 * @param {Object} state - Current app state from useAppStore
 * @param {string} fileName - Base filename for the .marka file
 */
export const saveProject = (state, fileName) => {
    const projectData = {
        version: 1,
        timestamp: Date.now(),
        pdfFileName: state.fileName, // Store PDF filename for auto-location
        fileSize: state.fileSize,
        measurements: state.measurements,
        shapes: state.shapes,
        calibrationScales: state.calibrationScales,
        pageUnits: state.pageUnits,
        pageRotations: state.pageRotations,
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], {
        type: 'application/json'
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    // Remove .pdf extension if present and add .marka
    const baseName = fileName.replace(/\.pdf$/i, '');
    link.download = `${baseName}.marka`;
    link.click();

    // Clean up
    URL.revokeObjectURL(link.href);
};

/**
 * Load and parse a .marka project file
 * @param {File} file - The .marka file to load
 * @returns {Promise<Object>} Parsed project data
 */
export const loadProject = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);

                // Validate structure
                if (!data.version) {
                    throw new Error('Invalid project file: missing version');
                }

                if (!data.measurements && !data.shapes) {
                    throw new Error('Invalid project file: no annotation data');
                }

                resolve(data);
            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        reader.readAsText(file);
    });
};

/**
 * Find PDF file associated with a .marka file
 * Strategy: Check same folder -> parent folder -> return null
 * Note: Browser File API doesn't allow directory traversal for security reasons.
 * This function returns the expected PDF filename, and the UI will prompt user to locate it.
 * 
 * @param {string} pdfFileName - Name of the PDF file to find
 * @returns {string} The PDF filename to search for
 */
export const getPdfFileName = (pdfFileName) => {
    return pdfFileName;
};

/**
 * Create a file input element to prompt user to select both .marka and PDF files
 * @param {string} pdfFileName - Expected PDF filename (optional, for display)
 * @returns {Promise<{markaFile: File, pdfFile: File}>} Selected files
 */
export const promptForProjectFiles = (pdfFileName) => {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.marka,application/pdf'; // Only .marka and PDF files
        input.multiple = true; // Allow selecting multiple files

        input.onchange = (e) => {
            const files = Array.from(e.target.files);

            if (files.length === 0) {
                reject(new Error('No files selected'));
                return;
            }

            // Find .marka and .pdf files
            const markaFile = files.find(f => f.name.endsWith('.marka') || f.name.endsWith('.json'));
            const pdfFile = files.find(f => f.name.endsWith('.pdf') || f.type === 'application/pdf');

            if (markaFile && pdfFile) {
                resolve({ markaFile, pdfFile });
            } else if (markaFile && !pdfFile) {
                // Only .marka selected, need PDF
                reject(new Error('NEED_PDF'));
            } else if (pdfFile && !markaFile) {
                reject(new Error('No .marka file selected'));
            } else {
                reject(new Error('Please select both .marka and PDF files'));
            }
        };

        input.oncancel = () => {
            reject(new Error('User cancelled'));
        };

        input.click();
    });
};

/**
 * Create a file input element to prompt user to locate PDF only
 * @param {string} pdfFileName - Expected PDF filename
 * @returns {Promise<File>} Selected PDF file
 */
export const promptForPDF = (pdfFileName) => {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                resolve(file);
            } else {
                reject(new Error('No file selected'));
            }
        };

        input.oncancel = () => {
            reject(new Error('User cancelled'));
        };

        input.click();
    });
};
