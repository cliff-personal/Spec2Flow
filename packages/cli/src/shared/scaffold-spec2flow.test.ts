import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildValidatorResult } from '../onboarding/validator-service.js';
import { readStructuredFileFrom } from './fs-utils.js';
import { scaffoldSpec2flowFiles } from './scaffold-spec2flow.js';

const tempDirectories: string[] = [];

function createTempRepository(prefix: string): string {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirectories.push(tempDirectory);
  return tempDirectory;
}

afterEach(() => {
  for (const tempDirectory of tempDirectories.splice(0, tempDirectories.length)) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

describe('scaffold-spec2flow', () => {
  it('infers a monorepo project and topology when the repository exposes cli, docs, and schemas surfaces', () => {
    const repositoryRoot = createTempRepository('spec2flow-monorepo-');
    fs.mkdirSync(path.join(repositoryRoot, 'packages', 'cli'), { recursive: true });
    fs.mkdirSync(path.join(repositoryRoot, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(repositoryRoot, 'schemas'), { recursive: true });
    fs.mkdirSync(path.join(repositoryRoot, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repositoryRoot, 'README.md'), '# Demo\n', 'utf8');
    fs.writeFileSync(path.join(repositoryRoot, 'AGENTS.md'), '# Agents\n', 'utf8');
    fs.writeFileSync(path.join(repositoryRoot, '.github', 'copilot-instructions.md'), '# Instructions\n', 'utf8');
    fs.writeFileSync(path.join(repositoryRoot, 'docs', 'architecture.md'), '# Architecture\n', 'utf8');
    fs.writeFileSync(path.join(repositoryRoot, 'docs', 'structure.md'), '# Structure\n', 'utf8');
    fs.writeFileSync(path.join(repositoryRoot, 'package.json'), JSON.stringify({
      name: 'spec2flow',
      workspaces: ['packages/*'],
      scripts: {
        build: 'tsc -p tsconfig.build.json',
        'test:unit': 'vitest run',
        'validate:docs': 'spec2flow validate-docs',
      },
    }, null, 2), 'utf8');

    scaffoldSpec2flowFiles(repositoryRoot, 'Spec2Flow');

    const projectYaml = fs.readFileSync(path.join(repositoryRoot, '.spec2flow', 'project.yaml'), 'utf8');
    const topologyYaml = fs.readFileSync(path.join(repositoryRoot, '.spec2flow', 'topology.yaml'), 'utf8');

    expect(projectYaml).toContain('type: monorepo');
    expect(projectYaml).toContain('cli:');
    expect(projectYaml).toContain('docs:');
    expect(projectYaml).toContain('schemas:');
    expect(projectYaml).toContain('npm run validate:docs');
    expect(topologyYaml).toContain('name: docs-governance');
    expect(topologyYaml).toContain('name: cli-runtime');
    expect(topologyYaml).toContain('name: schema-contracts');
  });

  it('falls back to the generic single-app scaffold when workspace signals are absent', () => {
    const repositoryRoot = createTempRepository('spec2flow-single-app-');
    fs.writeFileSync(path.join(repositoryRoot, 'README.md'), '# Demo\n', 'utf8');

    scaffoldSpec2flowFiles(repositoryRoot, 'Demo App');

    const projectYaml = fs.readFileSync(path.join(repositoryRoot, '.spec2flow', 'project.yaml'), 'utf8');
    const topologyYaml = fs.readFileSync(path.join(repositoryRoot, '.spec2flow', 'topology.yaml'), 'utf8');
    const runtimeJson = fs.readFileSync(path.join(repositoryRoot, '.spec2flow', 'runtime', 'model-adapter-runtime.json'), 'utf8');

    expect(projectYaml).toContain('type: single-app');
    expect(projectYaml).toContain('app:');
    expect(topologyYaml).toContain('name: default');
    expect(runtimeJson).toContain('example-command-adapter.mjs');
  });

  it('keeps scaffolded onboarding files valid for docs-only repositories without a readme', () => {
    const repositoryRoot = createTempRepository('spec2flow-docs-only-');
    fs.mkdirSync(path.join(repositoryRoot, 'docs', 'provider_service', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryRoot, 'docs', 'provider_service', 'api', 'oss-security-healthcheck.md'),
      '# OSS security healthcheck\n',
      'utf8'
    );

    scaffoldSpec2flowFiles(repositoryRoot, 'Docs Only');

    const projectYaml = fs.readFileSync(path.join(repositoryRoot, '.spec2flow', 'project.yaml'), 'utf8');
    const validatorResult = buildValidatorResult(
      readStructuredFileFrom(repositoryRoot, '.spec2flow/project.yaml') as Parameters<typeof buildValidatorResult>[0],
      readStructuredFileFrom(repositoryRoot, '.spec2flow/topology.yaml') as Parameters<typeof buildValidatorResult>[1],
      readStructuredFileFrom(repositoryRoot, '.spec2flow/policies/risk.yaml') as Parameters<typeof buildValidatorResult>[2],
      {
        project: '.spec2flow/project.yaml',
        topology: '.spec2flow/topology.yaml',
        risk: '.spec2flow/policies/risk.yaml',
      }
    );

    expect(projectYaml).toContain('docs/provider_service/api/oss-security-healthcheck.md');
    expect(validatorResult.validatorResult.status).toBe('passed');
  });

  it('can write the runtime scaffold into a separate control-plane root', () => {
    const repositoryRoot = createTempRepository('spec2flow-target-repo-');
    const runtimeRoot = createTempRepository('spec2flow-runtime-root-');
    fs.writeFileSync(path.join(repositoryRoot, 'README.md'), '# Demo\n', 'utf8');

    scaffoldSpec2flowFiles(
      repositoryRoot,
      'Demo App',
      '.spec2flow/project.yaml',
      '.spec2flow/topology.yaml',
      '.spec2flow/policies/risk.yaml',
      runtimeRoot
    );

    expect(fs.existsSync(path.join(repositoryRoot, '.spec2flow', 'project.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(repositoryRoot, '.spec2flow', 'runtime', 'model-adapter-runtime.json'))).toBe(false);
    expect(fs.existsSync(path.join(runtimeRoot, '.spec2flow', 'runtime', 'model-adapter-runtime.json'))).toBe(true);
  });
});