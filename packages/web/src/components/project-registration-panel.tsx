import type { ProjectRegistrationFormState } from '../lib/control-plane-ui-types';

export function ProjectRegistrationPanel(
  props: Readonly<{
    formState: ProjectRegistrationFormState;
    onFieldChange: <K extends keyof ProjectRegistrationFormState>(field: K, value: ProjectRegistrationFormState[K]) => void;
    onSubmit: () => void;
    isPending: boolean;
    errorMessage: string | null;
  }>
): JSX.Element {
  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Project Setup</p>
          <h3>Register Workspace Boundary</h3>
        </div>
        <span className="panel__hint">Project-first setup</span>
      </div>

      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <label>
          <span>Project Name</span>
          <input
            value={props.formState.projectName}
            onChange={(event) => props.onFieldChange('projectName', event.target.value)}
            placeholder="Spec2Flow"
          />
        </label>

        <label>
          <span>Repository Root</span>
          <input
            value={props.formState.repositoryRootPath}
            onChange={(event) => props.onFieldChange('repositoryRootPath', event.target.value)}
            placeholder="/Users/cliff/workspace/Spec2Flow"
          />
        </label>

        <label>
          <span>Workspace Root</span>
          <input
            value={props.formState.workspaceRootPath}
            onChange={(event) => props.onFieldChange('workspaceRootPath', event.target.value)}
            placeholder="/Users/cliff/workspace/Spec2Flow"
          />
        </label>

        <label>
          <span>Default Branch</span>
          <input
            value={props.formState.defaultBranch}
            onChange={(event) => props.onFieldChange('defaultBranch', event.target.value)}
            placeholder="main"
          />
        </label>

        <label>
          <span>Project Config</span>
          <input
            value={props.formState.projectPath}
            onChange={(event) => props.onFieldChange('projectPath', event.target.value)}
            placeholder=".spec2flow/project.yaml"
          />
        </label>

        <label>
          <span>Topology Config</span>
          <input
            value={props.formState.topologyPath}
            onChange={(event) => props.onFieldChange('topologyPath', event.target.value)}
            placeholder=".spec2flow/topology.yaml"
          />
        </label>

        <label>
          <span>Risk Config</span>
          <input
            value={props.formState.riskPath}
            onChange={(event) => props.onFieldChange('riskPath', event.target.value)}
            placeholder=".spec2flow/policies/risk.yaml"
          />
        </label>

        <label>
          <span>Branch Prefix</span>
          <input
            value={props.formState.branchPrefix}
            onChange={(event) => props.onFieldChange('branchPrefix', event.target.value)}
            placeholder="spec2flow/"
          />
        </label>

        <label className="form-grid__full">
          <span>Allowed Write Globs</span>
          <input
            value={props.formState.allowedWriteGlobs}
            onChange={(event) => props.onFieldChange('allowedWriteGlobs', event.target.value)}
            placeholder="src/**,tests/**,docs/**,.spec2flow/**"
          />
        </label>

        <div className="form-grid__full form-grid__actions">
          <button disabled={props.isPending} type="submit">
            {props.isPending ? 'Registering...' : 'Register Project'}
          </button>
          <p>Make the workspace policy explicit once. Every later run inherits this project context instead of freelancing against arbitrary paths.</p>
        </div>

        {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      </form>
    </article>
  );
}
