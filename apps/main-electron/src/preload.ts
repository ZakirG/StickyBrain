/**
 * Preload script for secure IPC communication
 * Exposes safe APIs to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

// Define the API interface
interface ElectronAPI {
  refreshRequest: () => Promise<{ snippets: any[]; summary: string }>;
  setInactive: () => void;
  onUpdate: (callback: (data: { snippets: any[]; summary: string }) => void) => void;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  refreshRequest: () => ipcRenderer.invoke('refresh-request'),
  setInactive: () => ipcRenderer.send('set-inactive'),
  onUpdate: (callback: (data: { snippets: any[]; summary: string }) => void) => {
    ipcRenderer.on('update-ui', (_event, data) => callback(data));
  },
} as ElectronAPI);

export {}; 