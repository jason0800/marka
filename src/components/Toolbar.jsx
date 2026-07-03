import {
    MousePointer2, Hand, Ruler, RulerDimensionLine, Square, Hash, MessageSquare,
    Box, Circle, Minus, ArrowRight, RectangleHorizontal, Type, MessageCircle,
    ScalingIcon,
    Tally5Icon,
    PencilRuler,
    Keyboard
} from 'lucide-react';
import useAppStore from '../stores/useAppStore';
import { useEffect, useState } from 'react';
import CalibrationDialog from './CalibrationDialog';
import { confirmToast } from '../utils/confirm-toast';

const TOOLS = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'pan', icon: Hand, label: 'Pan' },
    { id: 'calibrate', icon: PencilRuler, label: 'Set Scale' },
    { type: 'separator' },
    { id: 'length', icon: RulerDimensionLine, label: 'Length' },
    { id: 'area', icon: AreaIcon, label: 'Area' },
    { id: 'count', icon: Tally5Icon, label: 'Count' },
    { type: 'separator' },
    { id: 'callout', icon: CalloutIcon, label: 'Callout' },
    { id: 'text', icon: Type, label: 'Text Box' },
    { id: 'rectangle', icon: RectangleHorizontal, label: 'Rectangle' },
    { id: 'circle', icon: Circle, label: 'Circle' },
    { id: 'line', icon: Minus, label: 'Line' },
    { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
];

const Toolbar = () => {
    const { activeTool, setActiveTool, shortcuts } = useAppStore();
    const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
    const [pendingTool, setPendingTool] = useState(null);

    const handleToolSelect = async (toolId) => {
        if (toolId === 'calibrate') {
            setShowCalibrationDialog(true);
            return;
        }

        // Check for calibration if selecting measurement tools
        if (['length', 'area'].includes(toolId)) {
            const { calibrationScales, currentPage } = useAppStore.getState();

            // Check if scale exists for current page
            if (!calibrationScales[currentPage - 1]) {
                setPendingTool(toolId);
                const confirmed = await confirmToast(
                    "Scale not set. Please set the scale first to use this tool.",
                    "Set Scale",
                    "Cancel"
                );

                if (confirmed) {
                    setShowCalibrationDialog(true);
                } else {
                    setPendingTool(null);
                }
                return; // Don't activate tool if uncalibrated
            }
        }

        setActiveTool(toolId);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Ignore if Ctrl/Cmd is pressed (to avoid conflicts with undo/redo)
            if (e.ctrlKey || e.metaKey) return;

            const pressedKey = e.key.toLowerCase();
            const toolId = Object.keys(shortcuts).find(id => shortcuts[id] === pressedKey);
            if (toolId) {
                handleToolSelect(toolId);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setActiveTool, shortcuts]);

    return (
        <aside className="w-[50px] bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col items-center pt-3 pb-3 gap-1.5 z-10 shrink-0 overflow-y-auto no-scrollbar">
            {TOOLS.map((tool, i) => {
                if (tool.type === 'separator') {
                    return <div key={i} className="w-[60%] h-px bg-[var(--border-color)] my-1 shrink-0" />;
                }
                const isActive = activeTool === tool.id && tool.id !== 'calibrate';
                const shortcutKey = shortcuts[tool.id];
                const displayTitle = shortcutKey
                    ? `${tool.label} (${shortcutKey.toUpperCase()})`
                    : tool.label;

                return (
                    <button
                        key={tool.id}
                        className={`w-[36px] h-[36px] rounded-md border-none bg-transparent text-[var(--text-secondary)] flex items-center justify-center transition-all duration-200 hover:bg-[var(--btn-hover)] hover:text-[var(--text-primary)] shrink-0 ${isActive
                            ? '!bg-[var(--primary-color)] !text-[var(--text-active)] shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.25)]'
                            : ''
                            }`}
                        onClick={() => handleToolSelect(tool.id)}
                        title={displayTitle}
                    >
                        <tool.icon size={20} />
                    </button>
                );
            })}

            <div className="flex-1" />

            {showCalibrationDialog && (
                <CalibrationDialog onClose={() => {
                    setShowCalibrationDialog(false);
                    const { calibrationScales, currentPage } = useAppStore.getState();
                    if (calibrationScales[currentPage - 1] && pendingTool) {
                        setActiveTool(pendingTool);
                    }
                    setPendingTool(null);
                }} />
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
