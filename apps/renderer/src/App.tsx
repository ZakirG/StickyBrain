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
      onIncrementalUpdate?: (callback: (data: Partial<SectionData>) => void) => void;
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
  webSearchResults?: WebSearchResult[];
}

interface WebSearchResult {
  query: string;
  title: string;
  url: string;
  description: string;
  scrapedContent?: string;
  scrapingError?: string;
  pageSummary?: string;
  summarizationError?: string;
  selectedForSummarization?: boolean;
  selectedForScraping?: boolean;
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
  // Track which scraped content sections are expanded
  const [expandedScrapedContent, setExpandedScrapedContent] = useState<Set<string>>(new Set());
  const [userGoals, setUserGoals] = useState<string>('');
  const [isGoalsSaving, setIsGoalsSaving] = useState(false);
  const [isGoalsPanelCollapsed, setIsGoalsPanelCollapsed] = useState(true);

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

      // Listen for incremental updates
      window.electronAPI.onIncrementalUpdate?.((partialData: Partial<SectionData>) => {
        console.log('📈 [RENDERER] Received incremental update:', partialData);
        console.log('📈 [RENDERER] Incremental update details:', {
          hasSnippets: !!partialData.snippets,
          snippetCount: partialData.snippets?.length || 0,
          hasSummary: !!partialData.summary,
          summaryLength: partialData.summary?.length || 0,
          hasWebSearchPrompt: !!partialData.webSearchPrompt,
          webSearchPromptLength: partialData.webSearchPrompt?.length || 0,
          hasWebSearchResults: !!partialData.webSearchResults,
          webSearchResultsCount: partialData.webSearchResults?.length || 0,
        });
        
        // Only process incremental updates if we have meaningful data
        const hasMeaningfulData = 
          (partialData.snippets && partialData.snippets.length > 0) ||
          (partialData.summary && partialData.summary.length > 0) ||
          (partialData.webSearchPrompt && partialData.webSearchPrompt.length > 0) ||
          (partialData.webSearchResults && partialData.webSearchResults.length > 0);
        
        if (!hasMeaningfulData) {
          console.log('📈 [RENDERER] No meaningful data in incremental update, skipping');
          return;
        }
        
        setSections(prevSections => {
          console.log('📈 [RENDERER] Previous sections count:', prevSections.length);
          // If we have existing sections, merge with the first one
          if (prevSections.length > 0) {
            const currentSection = prevSections[0];
            const updatedSection = {
              // Keep all existing fields
              snippets: currentSection.snippets || [],
              summary: currentSection.summary || '',
              paragraph: currentSection.paragraph || '',
              webSearchPrompt: currentSection.webSearchPrompt || '',
              webSearchResults: currentSection.webSearchResults || [],
              // Override with new data if provided
              ...partialData,
            };
            console.log('📈 [RENDERER] Merging with existing section');
            return [updatedSection, ...prevSections.slice(1)];
          } else {
            // Create new section with partial data, ensuring all required fields exist
            const newSection: SectionData = {
              snippets: partialData.snippets || [],
              summary: partialData.summary || '',
              paragraph: partialData.paragraph || '',
              webSearchPrompt: partialData.webSearchPrompt || '',
              webSearchResults: partialData.webSearchResults || [],
            };
            console.log('📈 [RENDERER] Creating new section with partial data');
            return [newSection];
          }
        });
        
        const timestamp = new Date().toLocaleTimeString();
        setLastUpdated(timestamp);
        
        console.log('✅ [RENDERER] Incremental update applied successfully');
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
    console.log('🔌 [RENDERER] Sending refresh request to main process...');
    
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
    setExpandedScrapedContent(new Set());
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

  const toggleScrapedContentExpansion = (resultId: string) => {
    setExpandedScrapedContent(prev => {
      const newSet = new Set(prev);
      if (newSet.has(resultId)) {
        newSet.delete(resultId);
      } else {
        newSet.add(resultId);
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
        <div className="h-6 mb-2 select-none flex items-center gap-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">🧠 StickyBrain</h1>
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-blue-300" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <span>Loading</span>
                <div className="lds-ripple text-blue-300">
                  <div></div>
                  <div></div>
                </div>
              </div>
            )}
          </div>
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
                className="w-full h-64 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-300 text-sm resize-none focus:outline-none focus:border-blue-500"
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

        {/* Loading Indicator */}
        {false && (
          <div className="mb-4 bg-blue-900/30 border border-blue-600/50 rounded-lg p-3 flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="text-lg animate-spin">🔄</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-300">{statusText}</p>
              <p className="text-xs text-gray-400">Analyzing your note...</p>
            </div>
          </div>
        )}

        {/* Global Loading Overlay */}
        {false && (
          <div className="fixed inset-0 bg-gray-900/80 z-50 flex flex-col items-center justify-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="text-4xl animate-spin">🔄</div>
            <p className="mt-4 text-lg font-semibold text-blue-300">{statusText}</p>
            <p className="text-sm text-gray-400">Please wait while we analyze your note.</p>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="flex gap-4 h-full overflow-hidden">
          {/* Left Column - Existing Content */}
          <div className="flex-1 space-y-6 min-w-0 overflow-y-auto">
            {/* Render each result section */}
            {sections.map((section, idx) => (
              <div key={idx} className="space-y-3">
                {section.summary && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                      ⚡ Summary of Related Snippets from Your Old Stickies
                      
                    </h2>
                    <div className="bg-gray-800 border border-green-600/30 rounded p-3">
                      <p 
                        className="text-sm text-gray-300 leading-relaxed break-words whitespace-pre-line"
                        dangerouslySetInnerHTML={{ __html: formatBoldText(section.summary) }}
                      ></p>
                    </div>
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

            {sections.length === 0 && (
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
          <div className="flex-1 border-l border-gray-700 pl-4 min-w-0 overflow-y-auto">
            {sections.length > 0 && (sections[0].webSearchPrompt || sections[0].webSearchResults) ? (
              <div className="space-y-4">
                {/* Web Research Summary Section */}
                {sections[0].webSearchResults && sections[0].webSearchResults.some(result => result.pageSummary) && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                      🌐 Web Research Summary
                      <span className="text-xs text-gray-500">
                        ({sections[0].webSearchResults.filter(result => result.pageSummary).length} pages)
                      </span>
                    </h2>
                    <div className="bg-gray-800 border border-green-600/30 rounded p-3 space-y-4">
                      {(() => {
                        const summariesWithResults = sections[0].webSearchResults.filter(result => result.pageSummary);
                        return summariesWithResults.map((result, index) => (
                          <div key={`summary-${result.url}-${index}`}>
                            <p className="text-sm text-gray-300 leading-relaxed break-words whitespace-pre-line mb-2">
                              {result.pageSummary}
                            </p>
                            <a 
                              href={result.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 break-all"
                            >
                              {result.url}
                            </a>
                            {index < summariesWithResults.length - 1 && (
                              <hr className="border-gray-600 mt-3" />
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {sections[0].webSearchPrompt && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                      🔍 Suggested Web Searches
                    </h2>
                    <div className="bg-gray-800 border border-purple-600/30 rounded p-3">
                      <p className="text-xs text-gray-400 mb-2">Based on what you're writing:</p>
                      <pre className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">
                        {sections[0].webSearchPrompt}
                      </pre>
                    </div>
                  </div>
                )}
                
                {sections[0].webSearchResults && sections[0].webSearchResults.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                      🌐 Web Search Results
                    </h2>
                    <div className="space-y-3">
                      {sections[0].webSearchResults.map((result, index) => (
                        <div 
                          key={`${result.query}-${index}`}
                          className="bg-gray-800 border border-green-600/30 rounded p-3 animate-fade-in overflow-hidden"
                          style={{ animationDelay: `${index * 200}ms` }}
                        >
                          <div className="text-xs text-gray-400 mb-1 truncate">Query: {result.query}</div>

                          <a 
                            href={result.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="block hover:bg-gray-700/50 rounded p-1 -m-1 transition-colors"
                          >
                            <h3 className="text-xs font-normal text-gray-300 hover:text-gray-200 mb-1 break-words">
                              {result.title}
                            </h3>
                            {/* Hide the description */}
                            <div className="text-xs text-green-400 mt-1 truncate opacity-75">
                              {new URL(result.url).hostname}
                            </div>
                          </a>
                          <br/>
                          
                          {/* Show page summary at the top if available */}
                          {result.pageSummary && (
                            <div className="mb-3 bg-blue-900/20 border border-blue-600/30 rounded p-2">
                              <h4 className="text-xs font-medium text-blue-400 mb-2">Page Summary:</h4>
                              <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">
                                {result.pageSummary}
                              </div>
                            </div>
                          )}
                          
                          {/* Show summarization error if summarization failed */}
                          {result.summarizationError && !result.pageSummary && (
                            <div className="mb-3 bg-red-900/20 border border-red-600/30 rounded p-2">
                              <h4 className="text-xs font-medium text-red-400 mb-2">❌ Summarization Failed:</h4>
                              <p className="text-xs text-red-300">
                                {result.summarizationError}
                              </p>
                            </div>
                          )}
                          
                          {/* Show scraped content if available */}
                          {result.scrapedContent && (
                            <div className="mt-3 pt-3 border-t border-gray-600">
                              <button
                                onClick={() => toggleScrapedContentExpansion(`${result.query}-${index}`)}
                                className="text-xs font-medium text-purple-400 hover:text-purple-300 mb-2 flex items-center gap-1"
                              >
                                {expandedScrapedContent.has(`${result.query}-${index}`) ? '▼' : '▶'} Scraped Content
                              </button>
                              {expandedScrapedContent.has(`${result.query}-${index}`) && (
                                <div className="bg-gray-900/50 rounded p-2 max-h-64 overflow-y-auto">
                                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                                    {result.scrapedContent}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Show scraping error if scraping failed */}
                          {result.scrapingError && !result.scrapedContent && (
                            <div className="mt-3 pt-3 border-t border-gray-600">
                              <h4 className="text-xs font-medium text-red-400 mb-2">❌ Scraping Failed:</h4>
                              <p className="text-xs text-red-300 bg-red-900/20 rounded p-2">
                                {result.scrapingError}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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