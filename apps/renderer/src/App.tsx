/**
 * Main App component for StickyRAG floating window
 * Displays a translucent panel with refresh functionality and snippet list
 */

import { useState, useEffect } from 'react';
import './App.css';

// TypeScript declaration for Electron API
declare global {
  interface Window {
    electronAPI: {
      refreshRequest: () => Promise<{ snippets: any[]; summary: string; paragraph?: string }>;
      setInactive: () => void;
      onUpdate: (callback: (data: { snippets: any[]; summary: string; paragraph?: string }) => void) => void;
    };
  }
}

interface Snippet {
  id: string;
  stickyTitle: string;
  content: string;
  similarity: number;
}

interface AppData {
  snippets: Snippet[];
  summary: string;
  paragraph?: string;
}

function App() {
  const [data, setData] = useState<AppData>({ snippets: [], summary: '' });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Listen for updates from main process
    if (window.electronAPI) {
      window.electronAPI.onUpdate((newData: { snippets: any[]; summary: string; paragraph?: string }) => {
        // eslint-disable-next-line no-console
        console.log('[renderer] received update', newData);
        setData(newData);
        setIsLoading(false);
      });
    }

    // Handle window blur for opacity
    const handleBlur = () => {
      // eslint-disable-next-line no-console
      console.log('[renderer] window blur');
      const el = document.getElementById('root-panel');
      el?.classList.add('opacity-40');
      window.electronAPI?.setInactive();
    };

    const handleFocus = () => {
      // eslint-disable-next-line no-console
      console.log('[renderer] window focus');
      document.getElementById('root-panel')?.classList.remove('opacity-40');
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const handleRefresh = async () => {
    if (!window.electronAPI) return;
    
    setIsLoading(true);
    try {
      const result = await window.electronAPI.refreshRequest();
      setData(result);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-black/70 backdrop-blur-sm text-white p-4 transition-opacity duration-200 opacity-70 hover:opacity-100 focus:opacity-100" id="root-panel">
      {/* Header */}
      <div
        className="flex items-center justify-between mb-4 select-none"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <h1 className="text-lg font-semibold">StickyRAG</h1>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm transition-colors disabled:opacity-50"
          style={{ WebkitAppRegion: 'no-drag' }}
          data-testid="refresh-btn"
        >
          {isLoading ? 'Refreshing...' : 'Refresh suggestions'}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {data.summary && (
          <div className="mb-4 p-3 bg-white/10 rounded italic text-sm">
            {data.summary}
          </div>
        )}

        {data.paragraph && (
          <div className="mt-2 p-2 bg-yellow-800/40 rounded text-xs">
            <span className="font-semibold">DEBUG paragraph:</span> {data.paragraph}
          </div>
        )}

        {data.snippets.length > 0 ? (
          <div className="space-y-3">
            {data.snippets.map((snippet) => (
              <div key={snippet.id} className="p-3 bg-white/10 rounded">
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2 py-1 bg-blue-500/70 rounded text-xs">
                    {snippet.stickyTitle}
                  </span>
                  <span className="text-xs text-gray-300">
                    {(snippet.similarity * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm line-clamp-3">{snippet.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-400 mt-8">
            <p>No results yet</p>
            <p className="text-xs mt-2">Start typing in a Sticky note</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App; 