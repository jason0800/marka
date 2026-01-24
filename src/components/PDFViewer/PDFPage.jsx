import { useRef, useEffect } from 'react';
import { renderPageToCanvas } from '../../services/pdf-service';
import classes from './PDFPage.module.css';

import OverlayLayer from '../Overlay/OverlayLayer';

const PDFPage = ({ page, scale = 1.0 }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (page && canvasRef.current) {
            renderPageToCanvas(page, canvasRef.current, scale);
        }
    }, [page, scale]);

    return (
        <div className={classes.pageContainer} style={{ width: canvasRef.current?.width, height: canvasRef.current?.height }}>
            <canvas ref={canvasRef} className={classes.pageCanvas} />
            {canvasRef.current && (
                <OverlayLayer
                    page={page}
                    width={canvasRef.current.width}
                    height={canvasRef.current.height}
                />
            )}
        </div>
    );
};

export default PDFPage;
