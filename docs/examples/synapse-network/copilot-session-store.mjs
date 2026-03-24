import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SESSION_PERSIST_MODE = 'auto';

function normalizePersistMode(mode) {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (normalized === 'always' || normalized === 'never') {
    return normalized;
  }

  return DEFAULT_SESSION_PERSIST_MODE;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function persistSessionRecord(sessionStoreDir, sessionKey, now) {
  const sessionRecordPath = buildSessionRecordPath(sessionStoreDir, sessionKey);
  const existingRecord = readJsonIfExists(sessionRecordPath);
  const sessionId = existingRecord?.sessionId ?? randomUUID();

  ensureDirForFile(sessionRecordPath);
  fs.writeFileSync(
    sessionRecordPath,
    `${JSON.stringify({
      sessionKey,
      sessionId,
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now
    }, null, 2)}\n`,
    'utf8'
  );

  return {
    sessionId,
    sessionKey,
    source: existingRecord ? 'stored' : 'generated',
    sessionRecordPath
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toIsoString(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return fallback;
  }

  return new Date(timestamp).toISOString();
}

function toTimestamp(value) {
  const timestamp = Date.parse(typeof value === 'string' ? value : '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function buildSessionRecordPath(sessionStoreDir, sessionKey) {
  return path.join(sessionStoreDir, `${Buffer.from(sessionKey).toString('base64url')}.json`);
}

export function classifySessionKey(sessionKey) {
  const parts = typeof sessionKey === 'string'
    ? sessionKey.split('::').map((part) => part.trim()).filter(Boolean)
    : [];
  const specialistSessionKey = parts.at(-1) ?? '';

  return {
    sessionKey,
    parts,
    specialistSessionKey,
    isStableSpecialist: parts.length === 1 && Boolean(specialistSessionKey),
    isDynamic: parts.length > 1
  };
}

export function loadSessionStoreRecords(sessionStoreDir) {
  if (!fs.existsSync(sessionStoreDir)) {
    return [];
  }

  return fs
    .readdirSync(sessionStoreDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => {
      const filePath = path.join(sessionStoreDir, fileName);
      const record = readJsonIfExists(filePath);
      const sessionKey = record?.sessionKey ?? '';
      return {
        fileName,
        filePath,
        record,
        sessionKey,
        sessionId: record?.sessionId ?? '',
        createdAt: record?.createdAt ?? null,
        updatedAt: record?.updatedAt ?? null,
        classification: classifySessionKey(sessionKey)
      };
    })
    .filter((entry) => entry.record && entry.sessionKey && entry.sessionId);
}

export function planSessionStoreMigration(records, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const persistentByKey = new Map();
  const dynamicBySpecialist = new Map();
  const deleteRecords = [];

  for (const record of records) {
    if (record.classification.isStableSpecialist) {
      persistentByKey.set(record.sessionKey, record);
      continue;
    }

    if (record.classification.isDynamic && record.classification.specialistSessionKey) {
      const entries = dynamicBySpecialist.get(record.classification.specialistSessionKey) ?? [];
      entries.push(record);
      dynamicBySpecialist.set(record.classification.specialistSessionKey, entries);
      deleteRecords.push(record);
    }
  }

  const writes = [];
  const actions = [];

  for (const [specialistSessionKey, entries] of dynamicBySpecialist.entries()) {
    const sortedEntries = [...entries].sort((left, right) => toTimestamp(right.updatedAt ?? right.createdAt) - toTimestamp(left.updatedAt ?? left.createdAt));
    const latestEntry = sortedEntries[0];
    const existingPersistent = persistentByKey.get(specialistSessionKey);

    if (!existingPersistent && latestEntry) {
      writes.push({
        sessionKey: specialistSessionKey,
        filePath: buildSessionRecordPath(options.sessionStoreDir ?? '', specialistSessionKey),
        record: {
          sessionKey: specialistSessionKey,
          sessionId: latestEntry.sessionId,
          createdAt: toIsoString(latestEntry.createdAt, now),
          updatedAt: toIsoString(latestEntry.updatedAt ?? latestEntry.createdAt, now),
          migratedFrom: latestEntry.sessionKey
        }
      });
      actions.push({
        type: 'create-persistent',
        sessionKey: specialistSessionKey,
        sessionId: latestEntry.sessionId,
        fromSessionKey: latestEntry.sessionKey
      });
      continue;
    }

    if (existingPersistent && latestEntry) {
      actions.push({
        type: 'keep-existing-persistent',
        sessionKey: specialistSessionKey,
        sessionId: existingPersistent.sessionId,
        fromSessionKey: latestEntry.sessionKey
      });
    }
  }

  for (const record of deleteRecords) {
    actions.push({
      type: 'delete-legacy-record',
      sessionKey: record.sessionKey,
      sessionId: record.sessionId,
      filePath: record.filePath
    });
  }

  return {
    writes,
    deleteRecords,
    actions,
    summary: {
      persistentCount: persistentByKey.size,
      dynamicCount: deleteRecords.length,
      createdPersistentCount: writes.length,
      deletedLegacyCount: deleteRecords.length
    }
  };
}

export function applySessionStoreMigration(plan, options = {}) {
  const dryRun = options.dryRun === true;

  if (!dryRun) {
    for (const write of plan.writes) {
      ensureDirForFile(write.filePath);
      fs.writeFileSync(write.filePath, `${JSON.stringify(write.record, null, 2)}\n`, 'utf8');
    }

    for (const record of plan.deleteRecords) {
      fs.rmSync(record.filePath, { force: true });
    }
  }

  return {
    dryRun,
    writesApplied: plan.writes.length,
    deletesApplied: plan.deleteRecords.length
  };
}

export function resolveCopilotSession(options) {
  const explicitSessionId = typeof options.explicitSessionId === 'string' ? options.explicitSessionId.trim() : '';
  if (explicitSessionId) {
    return {
      sessionId: explicitSessionId,
      sessionKey: '',
      source: 'explicit',
      persistence: 'explicit',
      sessionRecordPath: null,
      legacyRecordRemoved: false
    };
  }

  const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey.trim() : '';
  if (!sessionKey) {
    return null;
  }

  const sessionStoreDir = options.sessionStoreDir;
  const persistMode = normalizePersistMode(options.persistMode);
  const classification = classifySessionKey(sessionKey);
  const sessionRecordPath = buildSessionRecordPath(sessionStoreDir, sessionKey);
  const now = new Date().toISOString();

  if (persistMode === 'auto' && classification.isDynamic && classification.specialistSessionKey) {
    const legacyRecordRemoved = fs.existsSync(sessionRecordPath);
    if (legacyRecordRemoved) {
      fs.rmSync(sessionRecordPath, { force: true });
    }

    const persistedSession = persistSessionRecord(sessionStoreDir, classification.specialistSessionKey, now);

    return {
      sessionId: persistedSession.sessionId,
      sessionKey: persistedSession.sessionKey,
      source: persistedSession.source,
      persistence: 'persistent',
      sessionRecordPath: persistedSession.sessionRecordPath,
      legacyRecordRemoved
    };
  }

  const shouldPersist = persistMode === 'always' || (persistMode === 'auto' && classification.isStableSpecialist);

  if (!shouldPersist) {
    const legacyRecordRemoved = fs.existsSync(sessionRecordPath);
    if (legacyRecordRemoved) {
      fs.rmSync(sessionRecordPath, { force: true });
    }

    return {
      sessionId: randomUUID(),
      sessionKey,
      source: 'generated',
      persistence: 'ephemeral',
      sessionRecordPath: null,
      legacyRecordRemoved
    };
  }

  const persistedSession = persistSessionRecord(sessionStoreDir, sessionKey, now);

  return {
    sessionId: persistedSession.sessionId,
    sessionKey: persistedSession.sessionKey,
    source: persistedSession.source,
    persistence: 'persistent',
    sessionRecordPath: persistedSession.sessionRecordPath,
    legacyRecordRemoved: false
  };
}