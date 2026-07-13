export type ByokProvider = 'anthropic' | 'openai' | 'google' | 'openrouter';

export interface SessionByokKey {
  provider: ByokProvider;
  label: string;
  envVar: string;
  placeholder: string;
}

export const SESSION_BYOK_KEYS: SessionByokKey[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-...',
  },
  { provider: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY', placeholder: 'AI...' },
  { provider: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', placeholder: 'sk-...' },
];

const STORAGE_PREFIX = 'parity.studio.byok.';
const MODEL_KEY = `${STORAGE_PREFIX}NODESLIDE_BYOK_MODEL`;
const BASE_URL_KEY = `${STORAGE_PREFIX}NODESLIDE_BYOK_BASE_URL`;

export function readSessionByok(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const out: Record<string, string> = {};
  for (const key of SESSION_BYOK_KEYS) {
    const value = window.sessionStorage.getItem(`${STORAGE_PREFIX}${key.envVar}`);
    if (value) out[key.envVar] = value;
  }
  return out;
}

export function writeSessionByok(values: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  for (const key of SESSION_BYOK_KEYS) {
    const value = values[key.envVar]?.trim() ?? '';
    const storageKey = `${STORAGE_PREFIX}${key.envVar}`;
    if (value) window.sessionStorage.setItem(storageKey, value);
    else window.sessionStorage.removeItem(storageKey);
  }
}

export function clearSessionByok(): void {
  if (typeof window === 'undefined') return;
  for (const key of SESSION_BYOK_KEYS) {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${key.envVar}`);
  }
  window.sessionStorage.removeItem(MODEL_KEY);
  window.sessionStorage.removeItem(BASE_URL_KEY);
}

export function readSessionByokRouting(): { model: string; baseUrl: string } {
  if (typeof window === 'undefined') return { model: 'z-ai/glm-5.2', baseUrl: '' };
  return {
    model: window.sessionStorage.getItem(MODEL_KEY) || 'z-ai/glm-5.2',
    baseUrl: window.sessionStorage.getItem(BASE_URL_KEY) || '',
  };
}

export function writeSessionByokRouting(values: { model: string; baseUrl: string }): void {
  if (typeof window === 'undefined') return;
  const model = values.model.trim();
  const baseUrl = values.baseUrl.trim();
  if (model) window.sessionStorage.setItem(MODEL_KEY, model);
  else window.sessionStorage.removeItem(MODEL_KEY);
  if (baseUrl) window.sessionStorage.setItem(BASE_URL_KEY, baseUrl);
  else window.sessionStorage.removeItem(BASE_URL_KEY);
}

export function maskKey(value: string | undefined, t?: (key: string) => string): string {
  if (!value) return t ? t('byok.notSet') : 'not set';
  if (value.length <= 4) return t ? t('byok.set') : 'set';
  return `•••• ${value.slice(-4)}`;
}
