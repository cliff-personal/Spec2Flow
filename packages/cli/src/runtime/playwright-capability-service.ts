import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export interface PlaywrightCapabilitySummary {
  checkedAt: string;
  requestedCapture: boolean;
  moduleResolved: boolean;
  browserExecutablePresent: boolean;
  available: boolean;
  executablePath?: string;
  reason?: string;
}

export function probePlaywrightCapability(cwd: string, requestedCapture: boolean): PlaywrightCapabilitySummary {
  const checkedAt = new Date().toISOString();
  if (!requestedCapture) {
    return {
      checkedAt,
      requestedCapture: false,
      moduleResolved: false,
      browserExecutablePresent: false,
      available: false,
      reason: 'capture-not-requested'
    };
  }

  const result = spawnSync('node', ['-e', `
    const fs = require('node:fs');
    try {
      const { chromium } = require('playwright');
      const executablePath = typeof chromium.executablePath === 'function' ? chromium.executablePath() : '';
      const browserExecutablePresent = Boolean(executablePath) && fs.existsSync(executablePath);
      process.stdout.write(JSON.stringify({
        moduleResolved: true,
        browserExecutablePresent,
        executablePath: executablePath || undefined
      }));
      process.exit(0);
    } catch (error) {
      process.stdout.write(JSON.stringify({
        moduleResolved: false,
        browserExecutablePresent: false,
        reason: error instanceof Error ? error.message : String(error)
      }));
      process.exit(0);
    }
  `], {
    cwd,
    encoding: 'utf8'
  });

  try {
    const probe = JSON.parse((result.stdout ?? '').trim() || '{}') as {
      moduleResolved?: boolean;
      browserExecutablePresent?: boolean;
      executablePath?: string;
      reason?: string;
    };
    const moduleResolved = probe.moduleResolved === true;
    const browserExecutablePresent = probe.browserExecutablePresent === true;
    return {
      checkedAt,
      requestedCapture: true,
      moduleResolved,
      browserExecutablePresent,
      available: moduleResolved && browserExecutablePresent,
      ...(typeof probe.executablePath === 'string' && probe.executablePath.length > 0 ? { executablePath: probe.executablePath } : {}),
      ...(
        moduleResolved
          ? browserExecutablePresent
            ? {}
            : { reason: 'browser-executable-missing' }
          : { reason: probe.reason ?? 'playwright-module-missing' }
      )
    };
  } catch {
    return {
      checkedAt,
      requestedCapture: true,
      moduleResolved: false,
      browserExecutablePresent: false,
      available: false,
      reason: 'playwright-probe-parse-failed'
    };
  }
}
