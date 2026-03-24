import type { SubmissionFormState } from '../lib/control-plane-ui-types';

export function RunSubmissionPanel(
  props: Readonly<{
    submissionState: SubmissionFormState;
    onFieldChange: <K extends keyof SubmissionFormState>(field: K, value: SubmissionFormState[K]) => void;
    onSubmit: () => void;
    isPending: boolean;
    errorMessage: string | null;
  }>
): JSX.Element {
  return (
    <article className="panel panel--accent">
      <div className="panel__header">
        <div>
          <p className="eyebrow">POST /api/runs</p>
          <h3>Run Submission</h3>
        </div>
        <span className="panel__hint">Real backend mutation</span>
      </div>

      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <label>
          <span>Repository Root</span>
          <input
            value={props.submissionState.repositoryRootPath}
            onChange={(event) => props.onFieldChange('repositoryRootPath', event.target.value)}
            placeholder="/Users/cliff/workspace/Synapse-Network"
          />
        </label>

        <label>
          <span>Requirement Path</span>
          <input
            value={props.submissionState.requirementPath}
            onChange={(event) => props.onFieldChange('requirementPath', event.target.value)}
            placeholder="docs/provider_service/api/web3-sentiment-index.md"
          />
        </label>

        <label className="form-grid__full">
          <span>Requirement Text Override</span>
          <textarea
            value={props.submissionState.requirement}
            onChange={(event) => props.onFieldChange('requirement', event.target.value)}
            placeholder="Optional inline requirement summary"
            rows={5}
          />
        </label>

        <label className="form-grid__full">
          <span>Changed Files</span>
          <textarea
            value={props.submissionState.changedFiles}
            onChange={(event) => props.onFieldChange('changedFiles', event.target.value)}
            placeholder="One path per line"
            rows={5}
          />
        </label>

        <div className="form-grid__full form-grid__actions">
          <button disabled={props.isPending} type="submit">
            {props.isPending ? 'Submitting...' : 'Create Platform Run'}
          </button>
          <p>Uses existing planner and PostgreSQL initialization services, not a parallel web-only intake model.</p>
        </div>

        {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      </form>
    </article>
  );
}