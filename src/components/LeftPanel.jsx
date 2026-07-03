import React, { useState } from 'react';
import { LayoutGrid, Sliders } from 'lucide-react';
import ThumbnailsPanel from './ThumbnailsPanel';
import PropertiesPanel from './PropertiesPanel';
import useAppStore from '../stores/useAppStore'; // Just in case, though might not need it here directly

// Left panel with thumbnails, properties, and bookmarks.
const LeftPanel = ({ pdfDocument }) => {
    const [activeTab, setActiveTab] = useState('thumbnails');

    return (
        <div className="flex h-full border-r border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
            {/* Skinny Icon Column */}
            <div className="w-[48px] flex flex-col items-center py-3 border-r border-[var(--border-color)] bg-[var(--bg-secondary)] gap-1.5">
                <button
                    className={`p-2 rounded-md transition-colors ${activeTab === 'thumbnails'
                        ? 'bg-[var(--primary-color)] text-[var(--text-active)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--btn-hover)]'
                        }`}
                    onClick={() => setActiveTab(activeTab === 'thumbnails' ? null : 'thumbnails')}
                    title="Thumbnails"
                >
                    <LayoutGrid size={20} />
                </button>
                <button
                    className={`p-2 rounded-md transition-colors ${activeTab === 'properties'
                        ? 'bg-[var(--primary-color)] text-[var(--text-active)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--btn-hover)]'
                        }`}
                    onClick={() => setActiveTab(activeTab === 'properties' ? null : 'properties')}
                    title="Properties"
                >
                    <Sliders size={20} />
                </button>
            </div>

            {/* Content Column */}
            {activeTab && (
                <div className="flex-1 w-[260px] overflow-hidden bg-[var(--bg-secondary)]">
                    {activeTab === 'thumbnails' && (
                        <ThumbnailsPanel pdfDocument={pdfDocument} />
                    )}
                    {activeTab === 'properties' && (
                        <PropertiesPanel />
                    )}
                </div>
            )}
        </div>
    );
};

export default LeftPanel;
