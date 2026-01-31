import React from 'react';
import { X, Plus } from 'lucide-react';
import useAppStore from '../stores/useAppStore';

const TabBar = () => {
    const { tabs, activeTabId, switchTab, closeTab, addTab } = useAppStore();

    if (tabs.length === 0) return null;

    return (
        <div className="flex bg-[var(--bg-secondary)] h-9 select-none">
            <div className="flex overflow-x-auto no-scrollbar max-w-full h-full">
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    return (
                        <div
                            key={tab.id}
                            className={`
                                group flex items-center gap-2 pl-3 pr-1.5 cursor-pointer text-xs font-medium border-r border-white/25
                                ${isActive
                                    ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                                    : 'bg-black/15 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }
                                transition-colors
                                min-w-[120px] max-w-[200px]
                            `}
                            onClick={() => switchTab(tab.id)}
                            title={tab.title}
                        >
                            <span className="truncate flex-1">{tab.title}</span>
                            <button
                                className={`p-1 rounded-md hover:bg-black/10 opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''} transition-all`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id);
                                }}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TabBar;
