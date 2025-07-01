/* @vitest-environment jsdom */
// @ts-nocheck
import { test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import App from '../apps/renderer/src/App';

// Mock Electron preload API
const refreshMock = vi.fn().mockResolvedValue({ snippets: [], summary: '' });
const setInactiveMock = vi.fn();
const onUpdateMock = vi.fn();

// Attach mock API to jsdom window
Object.defineProperty(window, 'electronAPI', {
  value: {
    refreshRequest: refreshMock,
    setInactive: setInactiveMock,
    onUpdate: onUpdateMock,
  },
  writable: true,
});

test('Refresh button invokes ipc once', async () => {
  const { getByTestId } = render(<App />);

  const btn = getByTestId('refresh-btn');
  await fireEvent.click(btn);

  expect(refreshMock).toHaveBeenCalledTimes(1);
}); 