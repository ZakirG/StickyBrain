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
      loadUserGoals: () => Promise<string>;
      saveUserGoals: (goals: string) => Promise<void>;
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
  webSearchPrompt?: string;
}

interface UserGoals {
  text: string;
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
 * Extracts the first 2-3 sentences from text for preview, preserving newlines
 */
function extractPreview(text: string): string {
  if (!text) return '';
  
  // If text is short enough, return as-is
  if (text.length <= 400) {
    return text;
  }
  
  // For longer text, try to break at sentence boundaries but preserve formatting
  const sentences = text.match(/[^.!?]*[.!?]+/g) || [];
  
  if (sentences.length === 0) {
    // If no sentence endings found, take first 300 characters
    return text.substring(0, 297) + '...';
  }
  
  // Find the original position of each sentence in the text to preserve formatting
  let preview = '';
  let currentPos = 0;
  
  for (let i = 0; i < Math.min(3, sentences.length); i++) {
    const sentence = sentences[i];
    const sentenceStart = text.indexOf(sentence, currentPos);
    
    if (sentenceStart >= 0) {
      // Include any whitespace/newlines before the sentence
      const beforeSentence = text.substring(currentPos, sentenceStart);
      preview += beforeSentence + sentence;
      currentPos = sentenceStart + sentence.length;
      
      // Stop if we're getting too long
      if (preview.length > 400) {
        break;
      }
    }
  }
  
  // If still too long, truncate but try to preserve some formatting
  if (preview.length > 400) {
    preview = preview.substring(0, 397) + '...';
  }
  
  return preview + (preview === text.trim() ? '' : '...');
}

function App() {
  // Collection of all past RAG results (latest first)
  const [sections, setSections] = useState<SectionData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [statusText, setStatusText] = useState('Awaiting input...');
  // Track which snippets have expanded full content
  const [expandedSnippets, setExpandedSnippets] = useState<Set<string>>(new Set());
  // Track which snippet content is expanded
  const [expandedSnippetContent, setExpandedSnippetContent] = useState<Set<string>>(new Set());
  const [userGoals, setUserGoals] = useState<string>('');
  const [isGoalsSaving, setIsGoalsSaving] = useState(false);
  const [isGoalsPanelCollapsed, setIsGoalsPanelCollapsed] = useState(false);

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
        setSections([newData]);
        setIsLoading(false);
        setStatusText('Results updated!');
        
        console.log('✅ [RENDERER] UI state updated successfully');
      });
    }

    // No opacity toggling – window stays fully opaque regardless of focus.

    window.electronAPI?.onRagStart?.(() => {
      console.log('🔄 [RENDERER] RAG pipeline started');
      setIsLoading(true);
      setSections([]);
      setStatusText('Processing your note...');
    });

    // Load user goals on startup
    window.electronAPI.loadUserGoals().then((goals: string) => {
      setUserGoals(goals);
    });

    return () => {};
  }, []);

  const handleRefresh = async () => {
    console.log('🔄 [RENDERER] Manual refresh button clicked');
    console.log('�� [RENDERER] Sending refresh request to main process...');
    
    if (!window.electronAPI) return;
    
    setIsLoading(true);
    try {
      const result = await window.electronAPI.refreshRequest();
      setSections([result]);
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

  const handleSaveGoals = async () => {
    setIsGoalsSaving(true);
    try {
      await window.electronAPI.saveUserGoals(userGoals);
      console.log('Goals saved successfully');
    } catch (error) {
      console.error('Failed to save goals:', error);
    } finally {
      setIsGoalsSaving(false);
    }
  };

  const handleClear = () => {
    setSections([]);
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
          <h1 className="text-sm font-semibold">🧠 StickyBrain</h1>
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

        {/* User Goals Panel */}
        <div className="mb-4 rounded-lg p-4">
          <div 
            className="flex items-center gap-2 cursor-pointer mb-2"
            onClick={() => setIsGoalsPanelCollapsed(!isGoalsPanelCollapsed)}
          >
            <h2 className="text-sm font-semibold text-blue-400">User Goals</h2>
            <svg 
              className={`w-4 h-4 text-blue-400 transition-transform ${isGoalsPanelCollapsed ? '-rotate-90' : 'rotate-0'}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {!isGoalsPanelCollapsed && (
            <div className="space-y-2">
              <textarea
                value={userGoals}
                onChange={(e) => setUserGoals(e.target.value)}
                placeholder="Enter your goals here."
                className="w-full h-20 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-300 text-sm resize-none focus:outline-none focus:border-blue-500"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleSaveGoals}
                  disabled={isGoalsSaving}
                  className="px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                >
                  {isGoalsSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Global Loading Overlay */}
        {isLoading && (
          <div className="fixed inset-0 bg-gray-900/80 z-50 flex flex-col items-center justify-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="text-4xl animate-spin">🔄</div>
            <p className="mt-4 text-lg font-semibold text-blue-300">{statusText}</p>
            <p className="text-sm text-gray-400">Please wait while we analyze your note.</p>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="flex gap-4 h-full">
          {/* Left Column - Existing Content */}
          <div className="flex-1 space-y-6">
            {/* Render each result section */}
            {sections.map((section, idx) => (
              <div key={idx} className="space-y-3">
                {section.summary && (
                  <div className="bg-gray-800 border border-green-600/30 rounded p-3">
                    <h2 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                    ⚡ Summary of Related Snippets from Your Old Stickies
                      <span className="text-xs text-gray-500">({section.summary.length} chars)</span>
                    </h2>
                    <hr className="border-gray-600 mb-3 -mx-3" />
                    <p 
                      className="text-sm text-gray-300 leading-relaxed break-words whitespace-pre-line"
                      dangerouslySetInnerHTML={{ __html: formatBoldText(section.summary) }}
                    ></p>
                  </div>
                )}

                {section.snippets.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
                      🔍 Related Snippets from Your Stickies
                      <span className="bg-yellow-400/20 text-yellow-300 px-2 py-0.5 rounded text-xs">
                        {section.snippets.length}
                      </span>
                    </h2>
                    {section.snippets.map((snippet) => {
                      const noteTitle = snippet.noteText ? extractNoteTitle(snippet.noteText) : snippet.stickyTitle;
                      const isFullContentExpanded = expandedSnippets.has(snippet.id);
                      const isSnippetContentExpanded = expandedSnippetContent.has(snippet.id);
                      
                      console.log('🔍 [RENDERER] Raw snippet content:', JSON.stringify(snippet.content));
                      const snippetPreview = extractPreview(snippet.content);
                      console.log('🔍 [RENDERER] Processed snippet preview:', JSON.stringify(snippetPreview));
                      const shouldShowSnippetToggle = snippet.content.length > snippetPreview.length;
                      
                      const fullContentPreview = snippet.noteText ? extractPreview(snippet.noteText) : '';
                      const shouldShowFullContentToggle = snippet.noteText && snippet.noteText.length > fullContentPreview.length;
                      
                      return (
                        <div key={snippet.id} className="p-3 bg-white/10 border border-gray-600/30 rounded">
                          <div className="mb-2">
                            <span className="text-sm font-medium text-blue-400 flex items-center gap-1">
                              🏴‍☠️ Sticky: "{noteTitle}""
                            </span>
                          </div>
                          <hr className="border-gray-600 mb-3 -mx-3" />
                          
                          {/* Snippet Content */}
                          <div className="mb-3">
                            <button
                              onClick={() => toggleSnippetContentExpansion(snippet.id)}
                              className="text-xs font-medium text-gray-400 hover:text-gray-300 mb-1 flex items-center gap-1"
                            >
                              {isSnippetContentExpanded ? '▼' : '▶'} Snippet Text
                            </button>
                            <pre className="p-2 bg-gray-800/60 rounded text-xs whitespace-pre-wrap font-sans overflow-x-auto">
                              {(() => {
                                const displayContent = isSnippetContentExpanded ? snippet.content : snippetPreview;
                                console.log('🖥️ [RENDERER] Content being displayed:', JSON.stringify(displayContent));
                                console.log('🖥️ [RENDERER] Content char codes:', displayContent.split('').map(c => c.charCodeAt(0)).join(','));
                                return displayContent;
                              })()}
                            </pre>
                            {shouldShowSnippetToggle && (
                              <button
                                onClick={() => toggleSnippetContentExpansion(snippet.id)}
                                className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1 mt-1"
                              >
                                {isSnippetContentExpanded ? '▲' : '▶'} {isSnippetContentExpanded ? 'Show Less' : 'Show More'}
                              </button>
                            )}
                          </div>
                          
                          {/* Full Sticky Content - Hidden for now */}
                          {snippet.noteText && (
                            <div className="mt-3 hidden">
                              <h4 className="text-xs font-medium text-gray-400 mb-1">Full Sticky Content</h4>
                              <pre className="p-2 bg-gray-800/60 rounded text-xs whitespace-pre-wrap font-sans overflow-x-auto">
                                {isFullContentExpanded ? snippet.noteText : fullContentPreview}
                              </pre>
                              {shouldShowFullContentToggle && (
                                <button
                                  onClick={() => toggleSnippetExpansion(snippet.id)}
                                  className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1 mt-1"
                                >
                                  {isFullContentExpanded ? '▼' : '▶'} {isFullContentExpanded ? 'Show Less' : 'Show More'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {sections.length === 0 && !isLoading && (
              <div className="text-center text-gray-500 mt-8">
                <div className="text-2xl mb-2">🧠</div>
                <p className="text-sm">Welcome to Sticky Brain!</p>
                <p className="text-xs mt-2 max-w-xs mx-auto leading-relaxed">
                  Start typing thoughts in a Sticky and I'll grab relevant snippets from other Stickies of yours.
                </p>
              </div>
            )}
          </div>

          {/* Right Column - Web Search Prompts */}
          <div className="flex-1 border-l border-gray-700 pl-4">
            {sections.length > 0 && sections[0].webSearchPrompt ? (
              <div className="space-y-3">
                <div className="bg-gray-800 border border-purple-600/30 rounded p-3">
                  <h2 className="text-sm font-semibold text-purple-400 flex items-center gap-2">
                    🔍 Suggested Web Searches
                  </h2>
                  <pre className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">
                    {sections[0].webSearchPrompt}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 mt-8">
                <div className="text-2xl mb-2">🔍</div>
                <p className="text-sm">Web Search Suggestions</p>
                <p className="text-xs mt-2 max-w-xs mx-auto leading-relaxed">
                  Start typing in a Sticky and I'll suggest relevant web searches.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Debug */}
        <div className="text-center">
          {/* <p className="text-xs text-gray-600">
            StickyBrain
          </p> */}
        </div>
      </div>
    </>
  );
}

export default App; 