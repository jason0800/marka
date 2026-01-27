import {
    MousePointer2, Hand, Ruler, Scaling, Square, Milestone, Hash, MessageSquare,
    Box, Circle, Minus, ArrowRight, Pentagon, RectangleHorizontal
} from 'lucide-react';
import useAppStore from '../stores/useAppStore';
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
        <aside className="w-[60px] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col items-center pt-4 gap-3 z-10">
            {TOOLS.map((tool, i) => {
                if (tool.type === 'separator') {
                    return <div key={i} className="w-[60%] h-px bg-[var(--border-color)] my-1" />;
                }
                const isActive = activeTool === tool.id;
                return (
                    <button
                        key={tool.id}
                        className={`w-9 h-9 rounded-md border-none bg-transparent text-[var(--text-secondary)] flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] ${isActive
                                ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.5)]'
                                : ''
                            }`}
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
