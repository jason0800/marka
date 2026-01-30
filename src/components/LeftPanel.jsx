import React, { useState } from 'react';
import { LayoutGrid, Sliders } from 'lucide-react';
import ThumbnailsPanel from './ThumbnailsPanel';
import PropertiesPanel from './PropertiesPanel';
import useAppStore from '../stores/useAppStore'; // Just in case, though might not need it here directly

const LeftPanel = ({ pdfDocument }) => {
    const [activeTab, setActiveTab] = useState('thumbnails');

    return (
        <div className="flex h-full border-r border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
            {/* Skinny Icon Column */}
            <div className="w-[50px] flex flex-col items-center py-4 border-r border-[var(--border-color)] bg-[var(--bg-secondary)] gap-2">
                <button
                    className={`p-2 rounded-lg transition-colors ${activeTab === 'thumbnails'
                        ? 'bg-[var(--primary-color)] text-[var(--text-active)] shadow-md'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    onClick={() => setActiveTab('thumbnails')}
                    title="Thumbnails"
                >
                    <LayoutGrid size={20} />
                </button>
                <button
                    className={`p-2 rounded-lg transition-colors ${activeTab === 'properties'
                        ? 'bg-[var(--primary-color)] text-[var(--text-active)] shadow-md'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                        }`}
                    onClick={() => setActiveTab('properties')}
                    title="Properties"
                >
                    <Sliders size={20} />
                </button>
            </div>

            {/* Content Column */}
            <div className="flex-1 w-[260px] overflow-hidden bg-[var(--bg-secondary)]">
                {activeTab === 'thumbnails' && (
                    <ThumbnailsPanel pdfDocument={pdfDocument} />
                )}
                {activeTab === 'properties' && (
                    <PropertiesPanel />
                )}
            </div>
        </div>
    );
};

export default LeftPanel;
