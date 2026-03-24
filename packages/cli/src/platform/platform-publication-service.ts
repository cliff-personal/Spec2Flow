import { insertPlatformEvents, insertPlatformPublications } from './platform-repository.js';
import type { PlatformEventRecord, PlatformPublicationRecord } from '../types/platform-persistence.js';
import type { ArtifactRef } from '../types/execution-state.js';
import type { PublicationRecord } from '../types/stage-deliverables.js';
import { randomUUID } from 'node:crypto';
import { readStructuredFileFrom } from '../shared/fs-utils.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import type { SqlExecutor } from './platform-database.js';
import { PLATFORM_EVENT_TYPES } from './platform-event-taxonomy.js';

export interface ReconcilePlatformPublicationsOptions {
  runId: string;
  taskId: string;
  artifactBaseDir: string;
  newArtifacts: ArtifactRef[];
}

export interface ReconcilePlatformPublicationsResult {
  publicationsInserted: number;
  eventsWritten: number;
}

function normalizeArtifactSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function isPublicationRecordArtifact(artifact: ArtifactRef): boolean {
  return [artifact.id, artifact.path]
    .map((value) => normalizeArtifactSearchValue(String(value)))
    .some((value) => value.includes('publication-record'));
}

function mapPublicationRecord(runId: string, publicationRecord: PublicationRecord): PlatformPublicationRecord {
  return {
    publicationId: publicationRecord.publicationId,
    runId,
    branchName: publicationRecord.branchName ?? null,
    commitSha: publicationRecord.commitSha ?? null,
    prUrl: null,
    publishMode: publicationRecord.publishMode,
    status: publicationRecord.status,
    metadata: {
      taskId: publicationRecord.taskId,
      summary: publicationRecord.summary,
      handoffType: publicationRecord.handoffType,
      approvalRequired: publicationRecord.approvalRequired,
      autoCommitEnabled: publicationRecord.autoCommitEnabled,
      commitMessage: publicationRecord.commitMessage ?? null,
      prTitle: publicationRecord.prTitle ?? null,
      prDraftPath: publicationRecord.prDraftPath ?? null,
      gateReason: publicationRecord.gateReason ?? null,
      artifactRefs: publicationRecord.artifactRefs,
      nextActions: publicationRecord.nextActions
    }
  };
}

export async function reconcilePlatformPublications(
  executor: SqlExecutor,
  schema: string,
  options: ReconcilePlatformPublicationsOptions
): Promise<ReconcilePlatformPublicationsResult> {
  const publicationArtifacts = options.newArtifacts.filter(isPublicationRecordArtifact);
  if (publicationArtifacts.length === 0) {
    return {
      publicationsInserted: 0,
      eventsWritten: 0
    };
  }

  const validators = getSchemaValidators();
  const publications: PlatformPublicationRecord[] = [];
  const events: PlatformEventRecord[] = [];

  for (const artifact of publicationArtifacts) {
    const payload = readStructuredFileFrom(options.artifactBaseDir, artifact.path);
    if (!validators.publicationRecord(payload)) {
      throw new Error(`invalid publication-record payload: ${JSON.stringify(validators.publicationRecord.errors ?? [])}`);
    }

    const publicationRecord = payload as PublicationRecord;
    publications.push(mapPublicationRecord(options.runId, publicationRecord));
    events.push({
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: publicationRecord.status === 'published'
        ? PLATFORM_EVENT_TYPES.PUBLICATION_PUBLISHED
        : PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED,
      payload: {
        publicationId: publicationRecord.publicationId,
        branchName: publicationRecord.branchName ?? null,
        commitSha: publicationRecord.commitSha ?? null,
        publishMode: publicationRecord.publishMode,
        status: publicationRecord.status,
        gateReason: publicationRecord.gateReason ?? null,
        prDraftPath: publicationRecord.prDraftPath ?? null
      }
    });
  }

  await insertPlatformPublications(executor, schema, publications);
  await insertPlatformEvents(executor, schema, events);

  return {
    publicationsInserted: publications.length,
    eventsWritten: events.length
  };
}
