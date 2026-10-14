export interface ModelDisplay {
  label: string;
  isLegacy: boolean;
}

const LEGACY_MODEL_PATTERNS: RegExp[] = [
  /(?:^|[/.])claude-sonnet-4[-.]5(?:$|[-.])/,
  /(?:^|[/.])claude-opus-4[-.]1(?:$|[-.])/,
  /(?:^|[/.])claude-opus-4[-.]5(?:$|[-.])/,
  /(?:^|[/.])claude-opus-4[-.]6(?:$|[-.])/,
  /(?:^|[/.])claude-sonnet-4[-.]6(?:$|[-.])/,
  /(?:^|[/.])claude-opus-4[-.]7(?:$|[-.])/,
  /(?:^|[/.])claude-opus-4[-.]8(?:$|[-.])/,
  /(?:^|[/.])claude-haiku-4[-.]5(?:$|[-.])/,
];

export function modelDisplay(modelId: string | null | undefined): ModelDisplay | null {
  const value = modelId?.trim();
  if (!value) return null;
  const isLegacy = LEGACY_MODEL_PATTERNS.some((pattern) => pattern.test(value));
  if (!isLegacy) return { label: value, isLegacy: false };
  return {
    label: `legacy ${value}`,
    isLegacy: true,
  };
}
