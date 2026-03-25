export interface SubmissionFormState {
  requirement: string;
  requirementPath: string;
  changedFiles: string;
}

export interface ProjectRegistrationFormState {
  projectName: string;
  repositoryRootPath: string;
  workspaceRootPath: string;
  projectPath: string;
  topologyPath: string;
  riskPath: string;
  defaultBranch: string;
  branchPrefix: string;
  allowedWriteGlobs: string;
}

export type TaskActionType = 'retry' | 'approve' | 'reject';
