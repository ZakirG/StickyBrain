/**
 * Main App component for StickyBrain floating window
 * Displays a translucent panel with refresh functionality and snippet list
 */

import React, { useState, useEffect } from 'react';
import './App.css';

// TypeScript declaration for Electron API
declare global {
  interface Window {
    electronAPI: {
      refreshRequest: () => Promise<{ snippets: any[]; summary: string; paragraph?: string }>;
      setInactive: () => void;
      onUpdate: (callback: (data: { snippets: any[]; summary: string; paragraph?: string }) => void) => void;
      onRagStart?: (callback: () => void) => void;
      runEmbeddings: () => Promise<void>;
    };
  }
}

interface Snippet {
  id: string;
  stickyTitle: string;
  content: string;
  similarity: number;
}

interface SectionData {
  snippets: Snippet[];
  summary: string;
  paragraph?: string;
}

function App() {
  // Collection of all past RAG results (latest first)
  const [sections, setSections] = useState<SectionData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [statusText, setStatusText] = useState('Awaiting input...');

  useEffect(() => {
    console.log('🎨 [RENDERER] App component mounted');
    console.log('🔌 [RENDERER] Setting up IPC listeners...');
    
    // Listen for updates from main process
    if (window.electronAPI) {
      window.electronAPI.onUpdate((newData: { snippets: any[]; summary: string; paragraph?: string }) => {
        console.log('📨 [RENDERER] Received update from main process:', newData);
        console.log('📊 [RENDERER] Snippets received:', newData.snippets?.length || 0);
        console.log('📄 [RENDERER] Summary length:', newData.summary?.length || 0);
        
        const timestamp = new Date().toLocaleTimeString();
        setLastUpdated(timestamp);
        setSections((prev) => [newData, ...prev]);
        setIsLoading(false);
        setStatusText('Results updated!');
        
        // Create debug info
        const debug = [
          `🕐 Updated: ${timestamp}`,
          `📊 Snippets: ${newData.snippets?.length || 0}`,
          `📄 Summary: ${newData.summary?.length || 0} chars`,
          `🎯 Top similarity: ${newData.snippets?.[0]?.similarity?.toFixed(3) || 'N/A'}`,
        ].join(' | ');
        setDebugInfo(debug);
        
        console.log('✅ [RENDERER] UI state updated successfully');
      });
    }

    // No opacity toggling – window stays fully opaque regardless of focus.

    window.electronAPI?.onRagStart?.(() => {
      console.log('🔄 [RENDERER] RAG pipeline started');
      setIsLoading(true);
      setSections([]);
      setDebugInfo('');
      setStatusText('Processing your note...');
    });

    return () => {};
  }, []);

  const handleRefresh = async () => {
    console.log('🔄 [RENDERER] Manual refresh button clicked');
    console.log('📤 [RENDERER] Sending refresh request to main process...');
    
    if (!window.electronAPI) return;
    
    setIsLoading(true);
    try {
      const result = await window.electronAPI.refreshRequest();
      setSections((prev) => [result, ...prev]);
      console.log('✅ [RENDERER] Refresh request sent successfully');
    } catch (error) {
      console.error('❌ [RENDERER] Refresh request failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunEmbeddings = async () => {
    if (!window.electronAPI?.runEmbeddings) return;
    setStatusText('Reindexing embeddings...');
    setIsLoading(true);
    await window.electronAPI.runEmbeddings();
    setStatusText('Reindex triggered. Waiting for updates...');
  };

  const handleClear = () => {
    setSections([]);
    setDebugInfo('');
    setStatusText('Cleared');
  };

  return (
    <>
      {/*
        Root floating panel. Default state is translucent (opacity-70).
        Hover/focus opacity classes are omitted so that JavaScript toggling fully
        controls opacity based on window focus/blur events.
      */}
      <div
        className="fixed inset-0 bg-black text-white p-4 overflow-y-auto relative"
        id="root-panel"
      >
        {/* Header Bar (drag) */}
        <div className="h-6 mb-2 select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <h1 className="text-sm font-semibold">StickyBrain</h1>
        </div>

        {/* Action Bar (no-drag) */}
        <div className="flex items-center justify-end gap-2 mb-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors disabled:opacity-50"
            data-testid="refresh-btn"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
            onClick={handleRunEmbeddings}
            disabled={isLoading}
          >
            Run Embeddings
          </button>
          <button
            className="px-3 py-1 bg-gray-700 hover:bg-gray-400 text-black rounded text-xs transition-colors disabled:opacity-50"
            onClick={handleClear}
            disabled={isLoading || sections.length === 0}
            title="Clear snippets"
          >
            🗑
          </button>
        </div>

        {/* Global Loading Overlay */}
        {isLoading && (
          <div className="fixed inset-0 bg-gray-900/80 z-50 flex flex-col items-center justify-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="text-4xl animate-spin">🔄</div>
            <p className="mt-4 text-lg font-semibold text-blue-300">{statusText}</p>
            <p className="text-sm text-gray-400">Please wait while we analyze your note.</p>
          </div>
        )}

        {/* Debug Info */}
        {debugInfo && (
          <div className="bg-gray-800 border border-gray-700 rounded p-2">
            <div className="text-xs text-gray-400 font-mono">{debugInfo}</div>
          </div>
        )}

        {/* Content Area */}
        <div className="space-y-6">
          {/* Render each result section */}
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-3">
              {section.summary && (
                <div className="bg-gray-800 border border-green-600/30 rounded p-3">
                  <h2 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                  ⚡ Summary of Related Snippets from Your Old Stickies
                    <span className="text-xs text-gray-500">({section.summary.length} chars)</span>
                  </h2>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">{section.summary}</p>
                </div>
              )}

              {section.snippets.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
                    🔍 Related Snippets
                    <span className="bg-yellow-400/20 text-yellow-300 px-2 py-0.5 rounded text-xs">
                      {section.snippets.length}
                    </span>
                  </h2>
                  {section.snippets.map((snippet) => (
                    <div key={snippet.id} className="p-3 bg-white/10 rounded">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <span className="text-xs font-medium text-blue-400 flex items-center gap-1">
                          📌 {snippet.stickyTitle}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">#{section.snippets.indexOf(snippet) + 1}</span>
                          <span className="text-xs bg-green-400/20 text-green-300 px-2 py-0.5 rounded">
                            {(snippet.similarity * 100).toFixed(1)}% match
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed">{snippet.content}</p>
                      <div className="mt-2 pt-2 border-t border-gray-700">
                        <span className="text-xs text-gray-500">
                          ID: {snippet.id} | Length: {snippet.content.length} chars
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {sections.length === 0 && !isLoading && (
            <div className="text-center text-gray-400 mt-8">
              <div className="text-2xl mb-2">🤔</div>
              <p>No results yet</p>
              <p className="text-xs mt-2">Edit a Sticky note to see RAG results</p>
            </div>
          )}
        </div>

        {/* Footer Debug */}
        <div className="text-center">
          <p className="text-xs text-gray-600">
            🔧 RAG Pipeline Debug Mode | Last Update: {lastUpdated || 'Never'}
          </p>
        </div>
      </div>
    </>
  );
}

export default App; 