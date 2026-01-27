import {
    MousePointer2, Hand, Ruler, Scaling, Square, Milestone, Hash, MessageSquare,
    Box, Circle, Minus, ArrowRight, Pentagon, RectangleHorizontal
} from 'lucide-react';
import useAppStore from '../../stores/useAppStore';
import classes from './Toolbar.module.css';
import { useEffect } from 'react';

const TOOLS = [
    { id: 'select', icon: MousePointer2, label: 'Select (V)', key: 'v' },
    { id: 'pan', icon: Hand, label: 'Pan (H)', key: 'h' },
    { id: 'calibrate', icon: Scaling, label: 'Calibrate (C)', key: 'c' },
    { type: 'separator' },
    { id: 'length', icon: Ruler, label: 'Length (L)', key: 'l' },
    { id: 'area', icon: Pentagon, label: 'Area (E)', key: 'e' },
    { id: 'perimeter', icon: Milestone, label: 'Perimeter (P)', key: 'p' },
    { id: 'count', icon: Hash, label: 'Count (N)', key: 'n' },
    { type: 'separator' },
    { id: 'rectangle', icon: RectangleHorizontal, label: 'Rectangle (R)', key: 'r' },
    { id: 'circle', icon: Circle, label: 'Circle (O)', key: 'o' },
    { id: 'line', icon: Minus, label: 'Line (I)', key: 'i' },
    { id: 'arrow', icon: ArrowRight, label: 'Arrow (A)', key: 'a' },
    { type: 'separator' },
    { id: 'comment', icon: MessageSquare, label: 'Comment (M)', key: 'm' },
];

const Toolbar = () => {
    const { activeTool, setActiveTool } = useAppStore();

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Ignore if Ctrl/Cmd is pressed (to avoid conflicts with undo/redo)
            if (e.ctrlKey || e.metaKey) return;

            const tool = TOOLS.find(t => t.key === e.key);
            if (tool) {
                setActiveTool(tool.id);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setActiveTool]);

    return (
        <aside className={classes.toolbar}>
            {TOOLS.map((tool, i) => {
                if (tool.type === 'separator') {
                    return <div key={i} style={{ width: '60%', height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />;
                }
                return (
                    <button
                        key={tool.id}
                        className={`${classes.toolButton} ${activeTool === tool.id ? classes.active : ''}`}
                        onClick={() => setActiveTool(tool.id)}
                        title={tool.label}
                    >
                        <tool.icon size={20} />
                    </button>
                );
            })}
        </aside>
    );
};

export default Toolbar;
