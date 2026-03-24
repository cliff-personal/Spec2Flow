export interface SubmissionFormState {
  repositoryRootPath: string;
  requirement: string;
  requirementPath: string;
  changedFiles: string;
}

export type TaskActionType = 'retry' | 'approve' | 'reject';