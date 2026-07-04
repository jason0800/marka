import React, { useState } from 'react';
import { LayoutGrid, Sliders } from 'lucide-react';
import ThumbnailsPanel from './ThumbnailsPanel';
import PropertiesPanel from './PropertiesPanel';
import useAppStore from '../stores/useAppStore';

const LeftPanel = ({ pdfDocument }) => {
    const [activeTab, setActiveTab] = useState('thumbnails');

    // Accent line fixed to the LEFT edge
    const AccentLine = () => (
        <span style={{
            position: 'absolute',
            left: 0, // Changed from right to left
            top: 0,
            bottom: 0,
            width: 3,
            background: 'var(--primary-color)',
            borderRadius: 0,
        }} />
    );

    return (
        <div className="flex h-full border-r border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
            {/* Skinny Icon Column */}
            <div className="w-[48px] flex flex-col items-center py-3 border-r border-[var(--border-color)] bg-[var(--bg-secondary)] gap-1.5">
                <button
                    // Added 'relative' here
                    className={`relative p-2 rounded-r-md transition-colors ${activeTab === 'thumbnails'
                        ? 'bg-gray-100 text-[var(--text-active)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--btn-hover)]'
                        }`}
                    onClick={() => setActiveTab(activeTab === 'thumbnails' ? null : 'thumbnails')}
                    title="Thumbnails"
                >
                    <LayoutGrid size={20} />
                    {activeTab === 'thumbnails' && <AccentLine />}
                </button>
                <button
                    // Added 'relative' here
                    className={`relative p-2 rounded-r-md transition-colors ${activeTab === 'properties'
                        ? 'bg-gray-100 text-[var(--text-active)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--btn-hover)]'
                        }`}
                    onClick={() => setActiveTab(activeTab === 'properties' ? null : 'properties')}
                    title="Properties"
                >
                    <Sliders size={20} />
                    {activeTab === 'properties' && <AccentLine />}
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