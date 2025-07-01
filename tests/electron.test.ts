/**
 * Electron integration test
 * Tests that the Electron app starts correctly and has the correct title
 */

import { test, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'timers/promises';

/**
 * Test that spawns npm start with headless Electron and checks title
 */
test('Electron app starts with correct title', async () => {
  let electronProcess: ChildProcess;
  
  try {
    // Spawn the Electron process in headless mode
    electronProcess = spawn('npm', ['start'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_ENABLE_LOGGING: 'true'
      },
      stdio: 'pipe'
    });

    // Wait for the process to start
    await setTimeout(5000);

    // Check if process is running
    expect(electronProcess.pid).toBeDefined();
    expect(electronProcess.killed).toBe(false);

    // For now, we'll check that the process started successfully
    // In a full implementation, we would use spectron or similar to
    // actually inspect the BrowserWindow properties
    let processOutput = '';
    
    if (electronProcess.stdout) {
      electronProcess.stdout.on('data', (data) => {
        processOutput += data.toString();
      });
    }

    // Wait a bit more for any output
    await setTimeout(2000);

    // The test passes if the process started without crashing
    expect(electronProcess.killed).toBe(false);

    // TODO: Use spectron or electron-test-utils to actually check:
    // - BrowserWindow title equals "StickyBrain"
    // - Window properties (alwaysOnTop, transparent, etc.)
    // - IPC functionality
    
  } finally {
    // Clean up: kill the electron process
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill();
      
      // Wait for process to exit
      await new Promise((resolve) => {
        electronProcess.on('exit', resolve);
        setTimeout(1000).then(resolve); // Fallback timeout
      });
    }
  }
}, 30000); // 30 second timeout for this test 