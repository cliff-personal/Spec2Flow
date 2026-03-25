import fs from 'node:fs';
import path from 'node:path';
import { resolveFromBaseDir } from '../shared/fs-utils.js';
import type { DeterministicRepositoryGap, DeterministicServiceSummary } from './service-orchestration-service.js';
import type { BrowserAutomationSummary } from './browser-automation-service.js';

export interface ExecutionEvidenceIndexArtifactInput {
  id: string;
  path: string;
  kind: 'log' | 'trace' | 'screenshot' | 'video' | 'report' | 'other';
  category:
    | 'service-startup'
    | 'service-health'
    | 'verification-command'
    | 'browser-check'
    | 'browser-screenshot'
    | 'browser-trace'
    | 'browser-video'
    | 'artifact-index'
    | 'other';
  contentType?: string;
}

export interface BuildExecutionEvidenceIndexOptions {
  cwd: string;
  taskId: string;
  summary: string;
  artifacts: ExecutionEvidenceIndexArtifactInput[];
  services: DeterministicServiceSummary[];
  browserChecks: BrowserAutomationSummary[];
  repositoryGaps: DeterministicRepositoryGap[];
}

function inferContentType(filePath: string, fallback?: string): string | undefined {
  if (fallback) {
    return fallback;
  }

  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.json':
      return 'application/json';
    case '.log':
    case '.txt':
      return 'text/plain';
    case '.html':
      return 'text/html';
    case '.png':
      return 'image/png';
    case '.zip':
      return 'application/zip';
    case '.webm':
      return 'video/webm';
    default:
      return undefined;
  }
}

export function buildExecutionEvidenceIndex(options: BuildExecutionEvidenceIndexOptions): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    taskId: options.taskId,
    stage: 'automated-execution',
    summary: options.summary,
    artifacts: options.artifacts.map((artifact) => {
      const resolvedPath = resolveFromBaseDir(options.cwd, artifact.path);
      const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
      return {
        id: artifact.id,
        path: artifact.path,
        kind: artifact.kind,
        category: artifact.category,
        ...(stat ? { sizeBytes: stat.size } : {}),
        ...(inferContentType(artifact.path, artifact.contentType) ? { contentType: inferContentType(artifact.path, artifact.contentType) } : {})
      };
    }),
    services: options.services.map((service) => ({
      name: service.name,
      status: service.status,
      ...(service.healthTarget ? { healthTarget: service.healthTarget } : {}),
      ...(service.logPath ? { logPath: service.logPath } : {})
    })),
    browserChecks: options.browserChecks.map((check) => ({
      id: check.id,
      url: check.url,
      status: check.status,
      ...(check.htmlSnapshotPath ? { htmlSnapshotPath: check.htmlSnapshotPath } : {}),
      ...(check.screenshotPath ? { screenshotPath: check.screenshotPath } : {}),
      ...(check.tracePath ? { tracePath: check.tracePath } : {}),
      ...(check.videoPath ? { videoPath: check.videoPath } : {})
    })),
    repositoryGaps: options.repositoryGaps
  };
}
