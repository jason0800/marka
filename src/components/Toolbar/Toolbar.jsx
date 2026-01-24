import { MousePointer2, Hand, Ruler, Scaling, Square, Milestone, Hash, MessageSquare } from 'lucide-react';
import useAppStore from '../../stores/useAppStore';
import classes from './Toolbar.module.css';
import { useEffect } from 'react';

const TOOLS = [
    { id: 'select', icon: MousePointer2, label: 'Select (1)', key: '1' },
    { id: 'pan', icon: Hand, label: 'Pan (2)', key: '2' },
    { id: 'calibrate', icon: Scaling, label: 'Calibrate (3)', key: '3' },
    { id: 'length', icon: Ruler, label: 'Length (4)', key: '4' },
    { id: 'area', icon: Square, label: 'Area (5)', key: '5' },
    { id: 'perimeter', icon: Milestone, label: 'Perimeter (6)', key: '6' },
    { id: 'count', icon: Hash, label: 'Count (7)', key: '7' },
    { id: 'comment', icon: MessageSquare, label: 'Comment (8)', key: '8' },
];

const Toolbar = () => {
    const { activeTool, setActiveTool } = useAppStore();

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
            {TOOLS.map((tool) => (
                <button
                    key={tool.id}
                    className={`${classes.toolButton} ${activeTool === tool.id ? classes.active : ''}`}
                    onClick={() => setActiveTool(tool.id)}
                    title={tool.label}
                >
                    <tool.icon size={24} />
                </button>
            ))}
        </aside>
    );
};

export default Toolbar;
