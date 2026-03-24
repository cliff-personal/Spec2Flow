export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'Not started';
  }

  return new Date(value).toLocaleString();
}

export function formatStage(value: string | null | undefined): string {
  if (!value) {
    return 'unassigned';
  }

  return value.replaceAll('-', ' ');
}

export function parseChangedFiles(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}