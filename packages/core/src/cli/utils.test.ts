import { describe, it, expect } from 'vitest';
import { extractFlag, extractBoolFlag, formatUptime, formatTable } from './utils.js';

describe('extractFlag', () => {
  it('should extract flag with value', () => {
    const { value, rest } = extractFlag(['--port', '3001', '--json'], 'port');
    expect(value).toBe('3001');
    expect(rest).toEqual(['--json']);
  });

  it('should extract flag by alias', () => {
    const { value, rest } = extractFlag(['-p', '3001'], 'port', 'p');
    expect(value).toBe('3001');
    expect(rest).toEqual([]);
  });

  it('should return undefined when flag not present', () => {
    const { value, rest } = extractFlag(['--json'], 'port');
    expect(value).toBeUndefined();
    expect(rest).toEqual(['--json']);
  });
});

describe('extractBoolFlag', () => {
  it('should detect boolean flag', () => {
    const { value, rest } = extractBoolFlag(['--json', '--url', 'http://x'], 'json');
    expect(value).toBe(true);
    expect(rest).toEqual(['--url', 'http://x']);
  });

  it('should detect alias', () => {
    const { value } = extractBoolFlag(['-h'], 'help', 'h');
    expect(value).toBe(true);
  });

  it('should return false when not present', () => {
    const { value } = extractBoolFlag(['--url', 'x'], 'json');
    expect(value).toBe(false);
  });
});

describe('formatUptime', () => {
  it('should format seconds only', () => {
    expect(formatUptime(45_000)).toBe('45s');
  });

  it('should format minutes and seconds', () => {
    expect(formatUptime(135_000)).toBe('2m 15s');
  });

  it('should format hours, minutes, seconds', () => {
    expect(formatUptime(8_103_000)).toBe('2h 15m 3s');
  });

  it('should handle zero', () => {
    expect(formatUptime(0)).toBe('0s');
  });
});

describe('formatTable', () => {
  it('should format rows with aligned columns', () => {
    const result = formatTable([
      { id: '1', name: 'foo' },
      { id: '22', name: 'bar' },
    ]);
    expect(result).toContain('ID');
    expect(result).toContain('NAME');
    expect(result).toContain('foo');
    expect(result).toContain('bar');
  });

  it('should return message for empty rows', () => {
    expect(formatTable([])).toBe('(no results)');
  });

  it('should respect column order', () => {
    const result = formatTable(
      [{ a: '1', b: '2' }],
      ['b', 'a'],
    );
    const headerLine = result.split('\n')[0];
    expect(headerLine.indexOf('B')).toBeLessThan(headerLine.indexOf('A'));
  });
});
