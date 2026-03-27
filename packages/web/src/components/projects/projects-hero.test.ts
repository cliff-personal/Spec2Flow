import { describe, expect, it } from 'vitest';

import { resolveRequirementHistoryNavigation } from './projects-hero';

describe('resolveRequirementHistoryNavigation', () => {
  it('navigates to the most recent history entry on ArrowUp from a fresh draft', () => {
    expect(resolveRequirementHistoryNavigation({
      history: ['latest', 'older'],
      currentValue: 'draft',
      currentIndex: null,
      draftValue: '',
      direction: 'previous',
    })).toEqual({
      nextValue: 'latest',
      nextIndex: 0,
      nextDraftValue: 'draft',
      didNavigate: true,
    });
  });

  it('restores the draft when ArrowDown exits history navigation', () => {
    expect(resolveRequirementHistoryNavigation({
      history: ['latest', 'older'],
      currentValue: 'latest',
      currentIndex: 0,
      draftValue: 'draft',
      direction: 'next',
    })).toEqual({
      nextValue: 'draft',
      nextIndex: null,
      nextDraftValue: '',
      didNavigate: true,
    });
  });

  it('does not navigate past the oldest entry', () => {
    expect(resolveRequirementHistoryNavigation({
      history: ['latest', 'older'],
      currentValue: 'older',
      currentIndex: 1,
      draftValue: 'draft',
      direction: 'previous',
    })).toEqual({
      nextValue: 'older',
      nextIndex: 1,
      nextDraftValue: 'draft',
      didNavigate: false,
    });
  });
});