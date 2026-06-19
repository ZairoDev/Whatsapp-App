import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeRegExp, formatListDate, getInitials } from '../conversationListScreen.utils';

describe('conversation list pure helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getInitials', () => {
    it('L60: uses first and last word initials when name has two or more parts', () => {
      expect(getInitials('Alice Bob')).toBe('AB');
      expect(getInitials('  Alice   Carol   Bob  ')).toBe('AB');
    });

    it('L63: uses first two characters for single-word names', () => {
      expect(getInitials('Alice')).toBe('AL');
    });

    it('L63: returns ? when name is empty after trim', () => {
      expect(getInitials('   ')).toBe('?');
      expect(getInitials('')).toBe('?');
    });
  });

  describe('formatListDate', () => {
    it('L67: returns empty string when timestamp is missing', () => {
      expect(formatListDate()).toBe('');
      expect(formatListDate(undefined)).toBe('');
    });

    it('L71-L72: omits year for dates in the current calendar year', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));
      const ts = new Date('2026-03-10T10:00:00Z').getTime();
      const formatted = formatListDate(ts);
      expect(formatted).toContain('10');
      expect(formatted).toContain('Mar');
      expect(formatted).not.toMatch(/\d{2}$/);
    });

    it('L74: includes two-digit year for other calendar years', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));
      const ts = new Date('2024-12-01T10:00:00Z').getTime();
      expect(formatListDate(ts)).toMatch(/24/);
    });
  });

  describe('escapeRegExp', () => {
    it('L78: escapes regex metacharacters', () => {
      expect(escapeRegExp('a+b*c?')).toBe('a\\+b\\*c\\?');
      expect(escapeRegExp('(test)')).toBe('\\(test\\)');
    });
  });
});
