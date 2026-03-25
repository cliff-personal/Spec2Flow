import type { SubmissionFormState } from '../lib/control-plane-ui-types';
import type { ProjectListItem } from '../lib/control-plane-api';

export function RunSubmissionPanel(
  props: Readonly<{
    selectedProject: ProjectListItem | null;
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
          <p className="eyebrow">New Requirement</p>
          <h3>Launch One Autonomous Run</h3>
        </div>
        <span className="panel__hint">{props.selectedProject ? 'Project-scoped intake' : 'Select a project first'}</span>
      </div>

      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <label>
          <span>Project</span>
          <input
            value={props.selectedProject?.projectName ?? ''}
            disabled
            placeholder="Select a project"
          />
        </label>

        <label>
          <span>Workspace Root</span>
          <input
            value={props.selectedProject?.workspaceRootPath ?? ''}
            disabled
            placeholder="/Users/cliff/workspace/Spec2Flow"
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
            placeholder="Describe the feature, acceptance criteria, constraints, and any operator notes."
            rows={7}
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
          <button disabled={props.isPending || !props.selectedProject} type="submit">
            {props.isPending ? 'Submitting...' : 'Create Autonomous Run'}
          </button>
          <p>Spec2Flow will branch, plan, implement, test, execute, repair bounded defects, and prepare a review-ready handoff inside the selected workspace boundary.</p>
        </div>

        {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      </form>
    </article>
  );
}
