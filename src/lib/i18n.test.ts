import { describe, expect, it } from 'vitest';
import { normalizeLocale, translate } from './i18n';

describe('i18n', () => {
  it('normalizes supported locale aliases', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh_CN')).toBe('zh-CN');
  });

  it('serves translated strings for app chrome', () => {
    expect(translate('en', 'header.exportDraft')).toBe('Export draft');
    expect(translate('zh-CN', 'header.exportDraft')).toBe('导出草稿');
    expect(translate('zh-CN', 'history.newRun')).toBe('新建运行');
  });

  it('interpolates params', () => {
    expect(translate('en', 'app.exportWarning', { passCount: 4, totalChecks: 16 })).toContain(
      '4/16',
    );
    expect(translate('zh-CN', 'app.exportWarning', { passCount: 4, totalChecks: 16 })).toContain(
      '4/16',
    );
  });
});
