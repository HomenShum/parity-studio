import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
  normalizeNodeSlideDataAttachment,
} from './nodeslideDataAttachment';

describe('NodeSlide uploaded data normalization', () => {
  it('normalizes BOM and CRLF while preserving row structure', () => {
    expect(normalizeNodeSlideDataAttachment('\uFEFFmetric,value\r\ngoals,172\r\n', 'csv')).toBe(
      'metric,value\ngoals,172',
    );
  });

  it('accepts valid JSON and rejects malformed JSON', () => {
    expect(normalizeNodeSlideDataAttachment('{"goals":172}', 'json')).toBe('{"goals":172}');
    expect(() => normalizeNodeSlideDataAttachment('{goals:172}', 'json')).toThrow(
      'Uploaded JSON is malformed.',
    );
  });

  it.each(['', '  \r\n  '])('rejects empty input', (value) => {
    expect(() => normalizeNodeSlideDataAttachment(value, 'txt')).toThrow(
      'Uploaded data file is empty.',
    );
  });

  it('rejects NUL-containing input', () => {
    expect(() => normalizeNodeSlideDataAttachment('safe\u0000unsafe', 'txt')).toThrow(
      'Uploaded data contains invalid NUL bytes.',
    );
  });

  it('enforces the UTF-8 byte limit', () => {
    const oversized = 'é'.repeat(Math.floor(NODESLIDE_DATA_ATTACHMENT_MAX_BYTES / 2) + 1);
    expect(() => normalizeNodeSlideDataAttachment(oversized, 'txt')).toThrow(
      'Uploaded data exceeds 24,000 bytes.',
    );
  });
});
