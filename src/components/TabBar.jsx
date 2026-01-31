import React from 'react';
import { X, Plus } from 'lucide-react';
import useAppStore from '../stores/useAppStore';

const TabBar = () => {
    const { tabs, activeTabId, switchTab, closeTab, addTab } = useAppStore();

    if (tabs.length === 0) return null;

    return (
        <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border-color)] h-9 px-2 select-none">
            <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-full">
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    return (
                        <div
                            key={tab.id}
                            className={`
                                group flex items-center gap-2 px-3 py-1.5 rounded-t-lg cursor-pointer text-xs font-medium border-t border-x
                                ${isActive
                                    ? 'bg-[var(--bg-primary)] border-[var(--border-color)] border-b-transparent text-[var(--text-primary)] mb-[-1px] pb-2 z-10'
                                    : 'bg-[var(--bg-tertiary)] border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] opacity-80 hover:opacity-100'
                                }
                                transition-all
                                min-w-[120px] max-w-[200px]
                            `}
                            onClick={() => switchTab(tab.id)}
                            title={tab.title}
                        >
                            <span className="truncate flex-1">{tab.title}</span>
                            <button
                                className={`p-0.5 rounded-full hover:bg-[var(--bg-hover-strong)] opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''} transition-opacity`}
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
