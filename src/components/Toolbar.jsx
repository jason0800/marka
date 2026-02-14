import {
    MousePointer2, Hand, Ruler, RulerDimensionLine, Square, Hash, MessageSquare,
    Box, Circle, Minus, ArrowRight, RectangleHorizontal, Type, MessageCircle,
    ScalingIcon,
    Tally5Icon,
    PencilRuler
} from 'lucide-react';
import useAppStore from '../stores/useAppStore';
import { useEffect, useState } from 'react';
import CalibrationDialog from './CalibrationDialog';

const TOOLS = [
    { id: 'select', icon: MousePointer2, label: 'Select (V)', key: 'v' },
    { id: 'pan', icon: Hand, label: 'Pan (H)', key: 'h' },
    { id: 'calibrate', icon: PencilRuler, label: 'Set Scale (C)', key: 'c' },
    { type: 'separator' },
    { id: 'length', icon: RulerDimensionLine, label: 'Length (L)', key: 'l' },
    { id: 'area', icon: AreaIcon, label: 'Area (E)', key: 'e' },
    { id: 'count', icon: Tally5Icon, label: 'Count (N)', key: 'n' },
    { type: 'separator' },
    { id: 'callout', icon: CalloutIcon, label: 'Callout (Q)', key: 'q' },
    { id: 'text', icon: Type, label: 'Text Box (T)', key: 't' },
    { id: 'rectangle', icon: RectangleHorizontal, label: 'Rectangle (R)', key: 'r' },
    { id: 'circle', icon: Circle, label: 'Circle (C)', key: 'c' },
    { id: 'line', icon: Minus, label: 'Line (L)', key: 'l' },
    { id: 'arrow', icon: ArrowRight, label: 'Arrow (A)', key: 'a' },
];

const Toolbar = () => {
    const { activeTool, setActiveTool } = useAppStore();
    const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Ignore if Ctrl/Cmd is pressed (to avoid conflicts with undo/redo)
            if (e.ctrlKey || e.metaKey) return;

            const tool = TOOLS.find(t => t.key === e.key);
            if (tool) {
                if (tool.id === 'calibrate') {
                    setShowCalibrationDialog(true);
                } else {
                    setActiveTool(tool.id);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setActiveTool]);

    return (
        <aside className="w-[60px] bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col items-center pt-4 pb-4 gap-2 z-10 shrink-0 overflow-y-auto no-scrollbar">
            {TOOLS.map((tool, i) => {
                if (tool.type === 'separator') {
                    return <div key={i} className="w-[60%] h-px bg-[var(--border-color)] my-1 shrink-0" />;
                }
                const isActive = activeTool === tool.id && tool.id !== 'calibrate';
                return (
                    <button
                        key={tool.id}
                        className={`w-9 h-9 rounded-md border-none bg-transparent text-[var(--text-secondary)] flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] shrink-0 ${isActive
                            ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.25)]'
                            : ''
                            }`}
                        onClick={() => {
                            if (tool.id === 'calibrate') {
                                setShowCalibrationDialog(true);
                            } else {
                                setActiveTool(tool.id);
                            }
                        }}
                        title={tool.label}
                    >
                        <tool.icon size={20} />
                    </button>
                );
            })}

            {showCalibrationDialog && (
                <CalibrationDialog onClose={() => setShowCalibrationDialog(false)} />
            )}
        </aside>
    );
};

function CalloutIcon({ size, ...props }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            <rect x="1" y="8" width="14" height="11" rx="2" />
            <path d="M15 13h4l3.5-5" />
            <path d="M19 8h4v4" />
        </svg>
    );
}

function AreaIcon({ size, ...props }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            {/* Square */}
            {/* Square */}
            <rect x="2" y="9" width="12" height="12" rx="2" strokeWidth="2.5" />

            {/* Top Horizontal Dimension */}
            <path d="M2 3h12" />
            <path d="M2 1v4" />
            <path d="M14 1v4" />

            {/* Right Vertical Dimension */}
            <path d="M20 9v12" />
            <path d="M18 9h4" />
            <path d="M18 21h4" />
        </svg>
    );
}

export default Toolbar;
