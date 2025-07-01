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
  noteText?: string;
  noteTitle?: string;
}

interface SectionData {
  snippets: Snippet[];
  summary: string;
  paragraph?: string;
}

/**
 * Converts **bold** markdown to HTML while preserving newlines
 */
function formatBoldText(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Extracts the first line from note text to use as title
 */
function extractNoteTitle(noteText: string): string {
  if (!noteText) return '';
  const firstLine = noteText.split('\n')[0].trim();
  return firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;
}

/**
 * Extracts the first 2-3 sentences from text for preview
 */
function extractPreview(text: string): string {
  if (!text) return '';
  
  // Split by sentence endings, keeping the punctuation
  const sentences = text.match(/[^.!?]*[.!?]+/g) || [];
  
  if (sentences.length === 0) {
    // If no sentence endings found, take first 150 characters
    return text.length > 150 ? text.substring(0, 147) + '...' : text;
  }
  
  // Take first 2-3 sentences, but limit total length
  let preview = sentences.slice(0, 3).join(' ').trim();
  
  if (preview.length > 200) {
    preview = sentences.slice(0, 2).join(' ').trim();
  }
  
  if (preview.length > 200) {
    preview = preview.substring(0, 197) + '...';
  }
  
  return preview + (preview === text.trim() ? '' : '...');
}

function App() {
  // Collection of all past RAG results (latest first)
  const [sections, setSections] = useState<SectionData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [statusText, setStatusText] = useState('Awaiting input...');
  // Track which snippets have expanded full content
  const [expandedSnippets, setExpandedSnippets] = useState<Set<string>>(new Set());
  // Track which snippet content is expanded
  const [expandedSnippetContent, setExpandedSnippetContent] = useState<Set<string>>(new Set());

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
    setExpandedSnippets(new Set());
    setExpandedSnippetContent(new Set());
  };

  const toggleSnippetExpansion = (snippetId: string) => {
    setExpandedSnippets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(snippetId)) {
        newSet.delete(snippetId);
      } else {
        newSet.add(snippetId);
      }
      return newSet;
    });
  };

  const toggleSnippetContentExpansion = (snippetId: string) => {
    setExpandedSnippetContent(prev => {
      const newSet = new Set(prev);
      if (newSet.has(snippetId)) {
        newSet.delete(snippetId);
      } else {
        newSet.add(snippetId);
      }
      return newSet;
    });
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
                  <p 
                    className="text-sm text-gray-300 leading-relaxed break-words whitespace-pre-line"
                    dangerouslySetInnerHTML={{ __html: formatBoldText(section.summary) }}
                  ></p>
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
                  {section.snippets.map((snippet) => {
                    const noteTitle = snippet.noteText ? extractNoteTitle(snippet.noteText) : snippet.stickyTitle;
                    const isExpanded = expandedSnippets.has(snippet.id);
                    
                    return (
                      <div key={snippet.id} className="p-3 bg-white/10 rounded">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                          <span className="text-xs font-medium text-blue-400 flex items-center gap-1">
                            📌 {noteTitle}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">#{section.snippets.indexOf(snippet) + 1}</span>
                            <span className="text-xs bg-green-400/20 text-green-300 px-2 py-0.5 rounded">
                              {(snippet.similarity * 100).toFixed(1)}% match
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                          {snippet.content}
                        </p>
                        {snippet.noteText && (
                          <div className="mt-2">
                            <button
                              onClick={() => toggleSnippetExpansion(snippet.id)}
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mb-1"
                            >
                              {isExpanded ? '▼' : '▶'} Full Sticky Content
                            </button>
                            {isExpanded && (
                              <div className="p-2 bg-gray-800/60 rounded text-xs whitespace-pre-wrap">
                                {snippet.noteText}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-2 pt-2 border-t border-gray-700">
                          <span className="text-xs text-gray-500">
                            ID: {snippet.id} | Length: {snippet.content.length} chars
                          </span>
                        </div>
                      </div>
                    );
                  })}
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