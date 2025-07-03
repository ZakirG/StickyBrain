/**
 * Preload script for secure IPC communication
 * Exposes safe APIs to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

// Define the API interface
interface ElectronAPI {
  refreshRequest: () => Promise<{ snippets: any[]; summary: string; paragraph?: string }>;
  setInactive: () => void;
  onUpdate: (callback: (data: { snippets: any[]; summary: string; paragraph?: string }) => void) => void;
  onRagStart: (callback: () => void) => void;
  runEmbeddings: () => Promise<void>;
  loadUserGoals: () => Promise<string>;
  saveUserGoals: (goals: string) => Promise<void>;
  onIncrementalUpdate: (callback: (data: any) => void) => void;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  refreshRequest: () => ipcRenderer.invoke('refresh-request'),
  setInactive: () => ipcRenderer.send('set-inactive'),
  onUpdate: (callback: (data: { snippets: any[]; summary: string; paragraph?: string }) => void) => {
    ipcRenderer.on('update-ui', (_event, data) => callback(data));
  },
  onRagStart: (callback: () => void) => {
    ipcRenderer.on('rag-started', () => callback());
  },
  runEmbeddings: () => ipcRenderer.invoke('run-embeddings'),
  loadUserGoals: () => ipcRenderer.invoke('load-user-goals'),
  saveUserGoals: (goals: string) => ipcRenderer.invoke('save-user-goals', goals),
  onIncrementalUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('incremental-update', (_event, data) => callback(data));
  },
} as ElectronAPI);

export {}; 