import { Trash2 } from 'lucide-react';
import useAppStore from '../../stores/useAppStore';
import classes from './RightPanel.module.css';
import { calculatePolygonArea } from '../../geometry/transforms';

const RightPanel = () => {
    const { measurements, deleteMeasurement, calibrationScales, pageUnits } = useAppStore();

    const grouped = measurements.reduce((acc, m) => {
        acc[m.type] = acc[m.type] || [];
        acc[m.type].push(m);
        return acc;
    }, {});

    const renderValue = (m) => {
        const scale = calibrationScales[m.pageIndex] || 1.0;
        const unit = pageUnits[m.pageIndex] || 'px';

        if (m.type === 'length') {
            const dist = Math.sqrt(Math.pow(m.points[1].x - m.points[0].x, 2) + Math.pow(m.points[1].y - m.points[0].y, 2));
            return `${(dist / scale).toFixed(2)} ${unit}`;
        }
        if (m.type === 'area') {
            const area = calculatePolygonArea(m.points);
            return `${(area / (scale * scale)).toFixed(2)} ${unit}²`;
        }
        if (m.type === 'perimeter') {
            // Re-calc length
            let len = 0;
            for (let i = 0; i < m.points.length - 1; i++) {
                len += Math.sqrt(Math.pow(m.points[i + 1].x - m.points[i].x, 2) + Math.pow(m.points[i + 1].y - m.points[i].y, 2));
            }
            return `${(len / scale).toFixed(2)} ${unit}`;
        }
        if (m.type === 'comment') return m.text || "(Untitled)";
        if (m.type === 'count') return `Point (${m.point.x.toFixed(0)}, ${m.point.y.toFixed(0)})`;
        return m.type;
    };

    return (
        <aside className={classes.panel}>
            <h2 className={classes.header}>Measurements</h2>

            {Object.entries(grouped).map(([type, items]) => (
                <div key={type} className={classes.group}>
                    <h3 className={classes.groupHeader}>{type.toUpperCase()} ({items.length})</h3>
                    <ul className={classes.list}>
                        {items.map(m => (
                            <li key={m.id} className={classes.item}>
                                <span className={classes.label}>
                                    Page {m.pageIndex}: {renderValue(m)}
                                </span>
                                <button className={classes.deleteBtn} onClick={() => deleteMeasurement(m.id)}>
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {measurements.length === 0 && <p className={classes.empty}>No measurements yet.</p>}
        </aside>
    );
};

export default RightPanel;
