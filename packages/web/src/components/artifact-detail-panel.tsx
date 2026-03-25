import { useEffect, useState } from 'react';
import { getTaskArtifactCatalog, type PlatformArtifactRecord, type PlatformTaskRecord, type TaskArtifactCatalogArtifact } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';

function stringifyMetadata(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : '{}';
}

export function ArtifactDetailPanel(
  props: Readonly<{
    artifacts: PlatformArtifactRecord[];
    tasks: PlatformTaskRecord[];
  }>
): JSX.Element {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(props.artifacts[0]?.artifactId ?? null);
  const [artifactCatalogEntry, setArtifactCatalogEntry] = useState<TaskArtifactCatalogArtifact | null>(null);

  useEffect(() => {
    if (!selectedArtifactId && props.artifacts[0]) {
      setSelectedArtifactId(props.artifacts[0].artifactId);
      return;
    }

    if (selectedArtifactId && !props.artifacts.some((artifact) => artifact.artifactId === selectedArtifactId)) {
      setSelectedArtifactId(props.artifacts[0]?.artifactId ?? null);
    }
  }, [props.artifacts, selectedArtifactId]);

  const selectedArtifact = props.artifacts.find((artifact) => artifact.artifactId === selectedArtifactId) ?? null;
  const taskTitle = selectedArtifact?.taskId
    ? props.tasks.find((task) => task.taskId === selectedArtifact.taskId)?.title ?? selectedArtifact.taskId
    : 'Run-level artifact';
  const originalArtifactId = typeof selectedArtifact?.metadata?.['originalArtifactId'] === 'string'
    ? selectedArtifact.metadata['originalArtifactId']
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadArtifactCatalogEntry(): Promise<void> {
      if (!selectedArtifact?.taskId || !selectedArtifact.runId || !originalArtifactId) {
        setArtifactCatalogEntry(null);
        return;
      }

      try {
        const catalog = await getTaskArtifactCatalog(selectedArtifact.runId, selectedArtifact.taskId);
        if (cancelled) {
          return;
        }

        setArtifactCatalogEntry(catalog.catalog.artifacts.find((artifact) => artifact.id === originalArtifactId) ?? null);
      } catch {
        if (!cancelled) {
          setArtifactCatalogEntry(null);
        }
      }
    }

    void loadArtifactCatalogEntry();

    return () => {
      cancelled = true;
    };
  }, [originalArtifactId, selectedArtifact?.runId, selectedArtifact?.taskId]);

  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Artifact Detail</p>
          <h3>Produced evidence and outputs</h3>
        </div>
        <span className="panel__hint">{props.artifacts.length} artifacts</span>
      </div>

      {props.artifacts.length === 0 ? (
        <p>No artifacts have been recorded for this run yet.</p>
      ) : (
        <div className="detail-split-panel">
          <div className="detail-split-panel__list">
            {props.artifacts.map((artifact) => (
              <button
                key={artifact.artifactId}
                className={`detail-selector ${artifact.artifactId === selectedArtifactId ? 'detail-selector--active' : ''}`}
                onClick={() => setSelectedArtifactId(artifact.artifactId)}
                type="button"
              >
                <strong>{artifact.kind}</strong>
                <span>{artifact.path}</span>
              </button>
            ))}
          </div>

          <div className="detail-split-panel__body">
            {selectedArtifact ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>Artifact ID</dt>
                    <dd>{selectedArtifact.artifactId}</dd>
                  </div>
                  <div>
                    <dt>Kind</dt>
                    <dd>{selectedArtifact.kind}</dd>
                  </div>
                  <div>
                    <dt>Task</dt>
                    <dd>{taskTitle}</dd>
                  </div>
                  <div>
                    <dt>Schema</dt>
                    <dd>{selectedArtifact.schemaType ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatTimestamp(selectedArtifact.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{selectedArtifact.path}</dd>
                  </div>
                </dl>

                <div className="panel-subsection">
                  <h4>Metadata</h4>
                  <pre className="detail-code-block">{stringifyMetadata(selectedArtifact.metadata)}</pre>
                </div>

                {artifactCatalogEntry ? (
                  <div className="panel-subsection">
                    <h4>Catalog-backed retrieval</h4>
                    <dl className="detail-list">
                      <div>
                        <dt>Upload status</dt>
                        <dd>{artifactCatalogEntry.upload?.status ?? 'n/a'}</dd>
                      </div>
                      <div>
                        <dt>Remote URL</dt>
                        <dd>
                          {artifactCatalogEntry.storage?.remoteUrl ? (
                            <a className="detail-link" href={artifactCatalogEntry.storage.remoteUrl} rel="noreferrer" target="_blank">
                              {artifactCatalogEntry.storage.remoteUrl}
                            </a>
                          ) : 'n/a'}
                        </dd>
                      </div>
                      <div>
                        <dt>Object key</dt>
                        <dd>{artifactCatalogEntry.storage?.objectKey ?? 'n/a'}</dd>
                      </div>
                      <div>
                        <dt>Provider</dt>
                        <dd>{artifactCatalogEntry.storage?.provider ?? 'local-fs'}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}
