import { describe, expect, it } from 'vitest';

import { appendRequirementHistoryEntry } from './use-control-plane-projects-page';

describe('appendRequirementHistoryEntry', () => {
  it('adds the newest requirement at the front and trims whitespace', () => {
    expect(appendRequirementHistoryEntry(['older'], '  latest  ')).toEqual(['latest', 'older']);
  });

  it('deduplicates an existing requirement by moving it to the front', () => {
    expect(appendRequirementHistoryEntry(['latest', 'older'], 'older')).toEqual(['older', 'latest']);
  });

  it('enforces the configured history limit', () => {
    expect(appendRequirementHistoryEntry(['one', 'two', 'three'], 'four', 3)).toEqual(['four', 'one', 'two']);
  });
});