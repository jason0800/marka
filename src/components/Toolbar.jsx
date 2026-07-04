import {
    MousePointer2, Hand, RulerDimensionLine, Circle, Minus,
    ArrowRight, RectangleHorizontal, Type, Tally5Icon, PencilRuler,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import useAppStore from '../stores/useAppStore';
import { useEffect, useState, useRef, useCallback } from 'react';
import CalibrationDialog from './CalibrationDialog';
import { confirmToast } from '../utils/confirm-toast';

// ─── All tool IDs for keyboard shortcut lookup ────────────────────────────────
const ALL_TOOL_IDS = [
    'select', 'pan', 'calibrate',
    'length', 'area', 'angle', 'count',
    'callout', 'text',
    'rectangle', 'circle', 'polygon', 'polyline',
    'line', 'arrow',
];

// ─── Toolbar layout definition ────────────────────────────────────────────────
const TOOLBAR = [
    { type: 'tool', id: 'select', icon: MousePointer2, label: 'Select' },
    { type: 'tool', id: 'pan', icon: Hand, label: 'Pan' },
    { type: 'tool', id: 'calibrate', icon: PencilRuler, label: 'Set Scale' },
    { type: 'separator' },
    { type: 'tool', id: 'length', icon: RulerDimensionLine, label: 'Length' },
    { type: 'tool', id: 'area', icon: AreaIcon, label: 'Area' },
    { type: 'tool', id: 'angle', icon: AngleIcon, label: 'Angle' },
    { type: 'tool', id: 'count', icon: Tally5Icon, label: 'Count' },
    { type: 'separator' },
    {
        type: 'group', groupId: 'annotations',
        children: [
            { id: 'callout', icon: CalloutIcon, label: 'Callout' },
            { id: 'text', icon: Type, label: 'Text Box' },
        ],
    },
    {
        type: 'group', groupId: 'shapes',
        children: [
            { id: 'rectangle', icon: RectangleHorizontal, label: 'Rectangle' },
            { id: 'circle', icon: Circle, label: 'Circle' },
            { id: 'polygon', icon: PolygonIcon, label: 'Polygon' },
            { id: 'polyline', icon: PolylineIcon, label: 'Polyline' },
        ],
    },
    {
        type: 'group', groupId: 'lines',
        children: [
            { id: 'line', icon: Minus, label: 'Line' },
            { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
        ],
    },
];

// ─── Toolbar component ────────────────────────────────────────────────────────
const Toolbar = () => {
    const { activeTool, setActiveTool, shortcuts } = useAppStore();
    const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
    const [pendingTool, setPendingTool] = useState(null);

    // Last-used tool per group (controls which icon is shown on the group button)
    const [groupActive, setGroupActive] = useState({
        annotations: 'callout',
        shapes: 'rectangle',
        lines: 'line',
    });

    // Which group flyout is open + its top offset
    const [flyout, setFlyout] = useState(null); // { groupId, top }
    const toolbarRef = useRef(null);

    // ── Tool activation ──────────────────────────────────────────────────────
    const handleToolSelect = useCallback(async (toolId) => {
        if (toolId === 'calibrate') {
            setShowCalibrationDialog(true);
            setFlyout(null);
            return;
        }
        if (['length', 'area'].includes(toolId)) {
            const { calibrationScales, currentPage } = useAppStore.getState();
            if (!calibrationScales[currentPage - 1]) {
                setPendingTool(toolId);
                const confirmed = await confirmToast(
                    'Scale not set. Please set the scale first to use this tool.',
                    'Set Scale', 'Cancel'
                );
                if (confirmed) setShowCalibrationDialog(true);
                else setPendingTool(null);
                return;
            }
        }
        setActiveTool(toolId);
        setFlyout(null);
    }, [setActiveTool]);

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.ctrlKey || e.metaKey) return;
            const key = e.key.toLowerCase();
            const toolId = ALL_TOOL_IDS.find(id => shortcuts[id] === key);
            if (toolId) handleToolSelect(toolId);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [shortcuts, handleToolSelect]);

    // ── Close flyout on outside click ────────────────────────────────────────
    // IMPORTANT: use bubble phase (no capture flag) so that onMouseDown+stopPropagation
    // inside the flyout portal buttons can block this from firing.
    useEffect(() => {
        const onMouseDown = (e) => {
            setFlyout(null);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, []);

    // ── Group right-click handler ────────────────────────────────────────────
    const handleGroupRightClick = (e, groupId) => {
        e.preventDefault();
        // Store viewport-relative coords so the portal can use position:fixed
        const buttonRect = e.currentTarget.getBoundingClientRect();
        setFlyout(prev => prev?.groupId === groupId ? null : {
            groupId,
            // Align flyout top with the button top, open to the left
            top: buttonRect.top,
            right: window.innerWidth - buttonRect.left + 8,
        });
    };

    // ── Group left-click: activate current displayed tool ────────────────────
    const handleGroupClick = (group) => {
        const currentId = groupActive[group.groupId];
        const child = group.children.find(c => c.id === currentId) || group.children[0];
        handleToolSelect(child.id);
    };

    // ── Child tool selection from flyout ─────────────────────────────────────
    const handleChildSelect = (groupId, childId) => {
        setGroupActive(prev => ({ ...prev, [groupId]: childId }));
        handleToolSelect(childId);
    };

    // ── Style helpers ─────────────────────────────────────────────────────────
    const btnBase = [
        'relative w-[36px] h-[36px] rounded-l-md border-none bg-transparent',
        'text-[var(--text-secondary)] flex items-center justify-center',
        'transition-all duration-150 hover:bg-[var(--btn-hover)]',
        'hover:text-[var(--text-primary)] shrink-0 cursor-pointer overflow-hidden',
    ].join(' ');

    return (
        <aside
            ref={toolbarRef}
            className="relative w-[50px] bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col items-center pt-3 pb-3 gap-1.5 z-10 shrink-0 overflow-y-auto no-scrollbar"
        >
            {TOOLBAR.map((item, i) => {
                // ── Separator ──────────────────────────────────────────────
                if (item.type === 'separator') {
                    return <div key={i} className="w-[60%] h-px bg-[var(--border-color)] my-1 shrink-0" />;
                }

                // ── Plain tool button ──────────────────────────────────────
                if (item.type === 'tool') {
                    const isActive = activeTool === item.id && item.id !== 'calibrate';
                    const key = shortcuts[item.id];
                    const title = key ? `${item.label} (${key.toUpperCase()})` : item.label;
                    return (
                        <button
                            key={item.id}
                            className={`${btnBase} ${isActive ? 'bg-gray-100' : ''}`}
                            onClick={() => handleToolSelect(item.id)}
                            title={title}
                        >
                            <item.icon size={20} />
                            {isActive && (
                                <span style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 3,
                                    background: 'var(--primary-color)',
                                    borderRadius: 0,
                                }} />
                            )}
                        </button>
                    );
                }

                // ── Group button ───────────────────────────────────────────
                if (item.type === 'group') {
                    const activeChildId = groupActive[item.groupId];
                    const displayChild = item.children.find(c => c.id === activeChildId) || item.children[0];
                    const isGroupActive = item.children.some(c => c.id === activeTool);
                    const DisplayIcon = displayChild.icon;

                    return (
                        <button
                            key={item.groupId}
                            className={btnBase}
                            onClick={() => handleGroupClick(item)}
                            onContextMenu={(e) => handleGroupRightClick(e, item.groupId)}
                            title={`${displayChild.label} — right-click for more`}
                        >
                            <DisplayIcon size={20} />
                            {/* Triangle indicator — bottom-left since flyout opens leftward */}
                            <svg
                                width="5" height="5" viewBox="0 0 5 5"
                                style={{ position: 'absolute', bottom: 3, left: 3, pointerEvents: 'none', opacity: 0.5 }}
                            >
                                <polygon points="0,0 5,5 0,5" fill="currentColor" />
                            </svg>
                            {isGroupActive && (
                                <span style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 3,
                                    background: 'var(--primary-color)',
                                    borderRadius: 0,
                                }} />
                            )}
                        </button>
                    );
                }

                return null;
            })}

            <div className="flex-1" />

            {/* ── Flyout portal — rendered into document.body to escape overflow clipping ── */}
            {flyout && (() => {
                const group = TOOLBAR.find(t => t.type === 'group' && t.groupId === flyout.groupId);
                if (!group) return null;
                return createPortal(
                    <div
                        style={{
                            position: 'fixed',
                            top: flyout.top,
                            right: flyout.right,
                            zIndex: 99999,
                        }}
                        className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-none min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-0 flex flex-col"
                        onMouseDown={e => e.stopPropagation()}
                    >
                        {group.children.map(child => {
                            const isChildActive = activeTool === child.id;
                            const key = shortcuts[child.id];
                            const ChildIcon = child.icon;
                            return (
                                <button
                                    key={child.id}
                                    className={`bg-transparent border-none text-[var(--text-primary)] px-4 py-2 text-left cursor-pointer text-[13px] flex items-center gap-2 w-full whitespace-nowrap
                                        ${isChildActive
                                            ? 'bg-[#b4e6a0] !text-[#1a1a1a]'
                                            : 'hover:bg-[#b4e6a0] hover:!text-[#1a1a1a]'
                                        }`}
                                    onMouseDown={e => {
                                        e.stopPropagation();
                                        handleChildSelect(group.groupId, child.id);
                                    }}
                                >
                                    <ChildIcon size={16} style={{ flexShrink: 0 }} />
                                    <span className="flex-1 text-left">{child.label}</span>
                                    {key && (
                                        <span className="ml-auto text-xs text-[#888] pl-4 font-mono uppercase">{key}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>,
                    document.body
                );
            })()}

            {showCalibrationDialog && (
                <CalibrationDialog onClose={() => {
                    setShowCalibrationDialog(false);
                    const { calibrationScales, currentPage } = useAppStore.getState();
                    if (calibrationScales[currentPage - 1] && pendingTool) setActiveTool(pendingTool);
                    setPendingTool(null);
                }} />
            )}
        </aside>
    );
};

// ─── Icon components ──────────────────────────────────────────────────────────

function CalloutIcon({ size, style, ...props }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={style} {...props}>
            <rect x="1" y="8" width="14" height="11" rx="2" />
            <path d="M15 13h4l3.5-5" />
            <path d="M19 8h4v4" />
        </svg>
    );
}

function AreaIcon({ size, style, ...props }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={style} {...props}>
            <rect x="2" y="9" width="12" height="12" rx="2" strokeWidth="2.5" />
            <path d="M2 3h12" /><path d="M2 1v4" /><path d="M14 1v4" />
            <path d="M20 9v12" /><path d="M18 9h4" /><path d="M18 21h4" />
        </svg>
    );
}

function AngleIcon({ size, style, ...props }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={style} {...props}>
            <path d="M20 19H4V3" />
            <path d="M4 11a8 8 0 0 1 8 8" />
        </svg>
    );
}

function PolylineIcon({ size, style, ...props }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={style} {...props}>
            <path d="m3 16 7-7 6 6 5-7" />
        </svg>
    );
}

function PolygonIcon({ size, style, ...props }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={style} {...props}>
            <path d="M12 3 L21 9 L18 19 L6 19 L3 9 Z" />
        </svg>
    );
}

export default Toolbar;
