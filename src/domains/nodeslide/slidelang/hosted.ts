import type { ValidationIssue, ValidationResult } from '../../../../shared/nodeslide';
import { stableHash } from './utils';

export const DEFAULT_SLIDELANG_API_BASE_URL = 'https://slidelang.ai';
export const DEFAULT_SLIDELANG_DECKS_DATA_ROOT = 'slidelang-projects';
export const DEFAULT_SLIDELANG_IMAGE_JOB_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_SLIDELANG_IMAGE_JOB_POLL_INTERVAL_MS = 2000;
export const HOSTED_SLIDELANG_TOOLCHAIN_VERSION = 'slidelang-skill/0.1.1';

export interface SlideLangEnvironment {
  SLIDELANG_API_BASE_URL?: string;
  EDITOR_BASE_URL?: string;
  DECKS_DATA_ROOT?: string;
  SLIDELANG_IMAGE_JOB_TIMEOUT_MS?: string;
}

export interface HostedSlideLangConfig {
  apiBaseUrl: string;
  decksDataRoot: string;
  imageJobTimeoutMs: number;
  imageJobPollIntervalMs: number;
}

export interface SlideLangProjectFile {
  path: string;
  encoding: 'utf8' | 'base64';
  content: string;
}

export type HostedSlideLangResponse = Record<string, unknown>;

interface ProjectRequest {
  project: string;
  workflow?: string | null;
}

export interface HostedCheckRequest extends ProjectRequest {
  files: SlideLangProjectFile[];
}

export interface HostedBudgetRequest extends ProjectRequest {
  workflow: string;
  slide?: string | null;
  files: SlideLangProjectFile[];
}

export interface HostedRepairPlanRequest extends ProjectRequest {
  workflow: string;
  slide?: string | null;
}

export interface HostedPublishRequest extends ProjectRequest {
  files: SlideLangProjectFile[];
  expectedPublishedRevisionId?: string | null;
  includeArtifactFiles?: boolean;
}

export interface HostedPullRequest extends ProjectRequest {}

export interface HostedImageGenerationRequest extends ProjectRequest {
  files: SlideLangProjectFile[];
  slide?: string | null;
  asset?: string | null;
  retry?: boolean;
}

export interface HostedMediaUploadRequest extends ProjectRequest {
  workflow: string;
  assetId: string;
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface HostedValidationContext {
  deckId: string;
  deckVersion: number;
  checkedAt?: number;
}

export interface HostedSlideLangAdapterOptions {
  environment?: SlideLangEnvironment;
  fetch?: typeof globalThis.fetch;
  imageJobPollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Opt-in adapter for the public SlideLang 0.1.1 thin-client contract. It works with official
 * project file bundles, not canonical NodeSlide snapshots. There is intentionally no hosted
 * PPTX method because the documented service exposes no PPTX endpoint.
 */
export interface HostedSlideLangAdapter {
  readonly mode: 'hosted';
  readonly config: HostedSlideLangConfig;
  check(request: HostedCheckRequest): Promise<HostedSlideLangResponse>;
  budget(request: HostedBudgetRequest): Promise<HostedSlideLangResponse>;
  repairPlan(request: HostedRepairPlanRequest): Promise<HostedSlideLangResponse>;
  publish(request: HostedPublishRequest): Promise<HostedSlideLangResponse>;
  pull(request: HostedPullRequest): Promise<HostedSlideLangResponse>;
  startImageGeneration(request: HostedImageGenerationRequest): Promise<HostedSlideLangResponse>;
  getImageJob(project: string, jobId: string): Promise<HostedSlideLangResponse>;
  waitForImageJob(project: string, jobId: string): Promise<HostedSlideLangResponse>;
  generateImages(request: HostedImageGenerationRequest): Promise<HostedSlideLangResponse>;
  uploadMedia(request: HostedMediaUploadRequest): Promise<HostedSlideLangResponse>;
  presenterUrl(project: string, workflow: string): string;
  mapValidationSummary(
    response: HostedSlideLangResponse,
    context: HostedValidationContext,
  ): ValidationResult;
}

function runtimeEnvironment(): SlideLangEnvironment {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env ?? {};
}

function trimmed(value: string | undefined): string {
  return String(value ?? '').trim();
}

export function resolveHostedSlideLangConfig(
  environment: SlideLangEnvironment = runtimeEnvironment(),
  imageJobPollIntervalMs = DEFAULT_SLIDELANG_IMAGE_JOB_POLL_INTERVAL_MS,
): HostedSlideLangConfig {
  const apiBaseUrl =
    trimmed(environment.SLIDELANG_API_BASE_URL) ||
    trimmed(environment.EDITOR_BASE_URL) ||
    DEFAULT_SLIDELANG_API_BASE_URL;
  const timeout = Number(environment.SLIDELANG_IMAGE_JOB_TIMEOUT_MS ?? '');
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    decksDataRoot: trimmed(environment.DECKS_DATA_ROOT) || DEFAULT_SLIDELANG_DECKS_DATA_ROOT,
    imageJobTimeoutMs:
      Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SLIDELANG_IMAGE_JOB_TIMEOUT_MS,
    imageJobPollIntervalMs:
      Number.isFinite(imageJobPollIntervalMs) && imageJobPollIntervalMs >= 0
        ? imageJobPollIntervalMs
        : DEFAULT_SLIDELANG_IMAGE_JOB_POLL_INTERVAL_MS,
  };
}

function asRecord(value: unknown): HostedSlideLangResponse {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as HostedSlideLangResponse)
    : {};
}

function responseSummary(response: HostedSlideLangResponse): HostedSlideLangResponse {
  const workflowSummary = asRecord(response['workflow_summary']);
  if (Object.keys(workflowSummary).length > 0) return workflowSummary;
  const summary = asRecord(response['summary']);
  if (Object.keys(summary).length > 0) return summary;
  return response;
}

function booleanField(record: HostedSlideLangResponse, primary: string, alias?: string): boolean {
  if (record[primary] === true || record[primary] === false) return record[primary] === true;
  if (alias && (record[alias] === true || record[alias] === false)) return record[alias] === true;
  return false;
}

function hostedIssueCode(kind: string): ValidationIssue['code'] {
  if (/text_fit|overflow|density|boundary|page_fit/i.test(kind)) return 'overflow';
  if (/overlap|clearance|connector_obstacle/i.test(kind)) return 'collision';
  if (/export/i.test(kind)) return 'export';
  return 'schema';
}

function hostedIssueSeverity(record: HostedSlideLangResponse): ValidationIssue['severity'] {
  const issueClass = String(record['class'] ?? '').toLowerCase();
  if (issueClass === 'blocking') return 'error';
  if (issueClass === 'repairable') return 'warning';
  return 'info';
}

function hostedIssues(
  response: HostedSlideLangResponse,
  context: HostedValidationContext,
): ValidationIssue[] {
  const summary = responseSummary(response);
  const rawIssues = Array.isArray(summary['issues'])
    ? summary['issues']
    : Array.isArray(response['issues'])
      ? response['issues']
      : [];
  return rawIssues.map((rawIssue, index) => {
    const record = asRecord(rawIssue);
    const kind = String(record['kind'] ?? record['code'] ?? 'hosted');
    const message = String(
      record['message'] ?? record['recommended_action'] ?? `Hosted SlideLang issue: ${kind}`,
    );
    const slideId = trimmed(String(record['slide_id'] ?? record['slideId'] ?? ''));
    const elementId = trimmed(
      String(
        record['element_id'] ?? record['elementId'] ?? record['node_id'] ?? record['nodeId'] ?? '',
      ),
    );
    return {
      id: `hosted-issue:${context.deckId}:${stableHash(`${index}:${kind}:${message}:${slideId}:${elementId}`)}`,
      severity: hostedIssueSeverity(record),
      code: hostedIssueCode(kind),
      message,
      ...(slideId ? { slideId } : {}),
      ...(elementId ? { elementId } : {}),
    };
  });
}

export function mapHostedValidationSummary(
  response: HostedSlideLangResponse,
  context: HostedValidationContext,
): ValidationResult {
  const summary = responseSummary(response);
  const issues = hostedIssues(response, context);
  const ok = booleanField(summary, 'ok');
  const publishOk = booleanField(summary, 'publish_ok', 'blocking_ok');
  const cleanOk = booleanField(summary, 'clean_ok', 'repairable_ok');
  return {
    id: `hosted-validation:${context.deckId}:v${context.deckVersion}:${stableHash(`${ok}:${publishOk}:${cleanOk}:${issues.map((issue) => issue.id).join('|')}`)}`,
    deckId: context.deckId,
    deckVersion: context.deckVersion,
    ok,
    publishOk,
    cleanOk,
    issues,
    checkedAt: context.checkedAt ?? 0,
    toolchainVersion: HOSTED_SLIDELANG_TOOLCHAIN_VERSION,
  };
}

async function readResponse(response: Response): Promise<HostedSlideLangResponse> {
  const bodyText = await response.text();
  if (!bodyText.trim()) return {};
  try {
    return asRecord(JSON.parse(bodyText));
  } catch {
    if (!response.ok) throw new Error(bodyText || response.statusText || `HTTP ${response.status}`);
    throw new Error('Hosted SlideLang returned a non-JSON response.');
  }
}

function responseDetail(response: Response, data: HostedSlideLangResponse): string {
  return trimmed(String(data['detail'] ?? '')) || response.statusText || `HTTP ${response.status}`;
}

export function createHostedSlideLangAdapter(
  options: HostedSlideLangAdapterOptions = {},
): HostedSlideLangAdapter {
  const config = resolveHostedSlideLangConfig(
    options.environment ?? runtimeEnvironment(),
    options.imageJobPollIntervalMs,
  );
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) throw new Error('A Fetch API implementation is required.');
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));

  const postJson = async (path: string, payload: unknown): Promise<HostedSlideLangResponse> => {
    const response = await fetchImplementation(`${config.apiBaseUrl}${path}`, {
      method: 'POST',
      // The official 0.1.1 client sends only content-type. There is no API-key environment.
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await readResponse(response);
    if (!response.ok) throw new Error(responseDetail(response, data));
    return data;
  };

  const getImageJob = async (project: string, jobId: string): Promise<HostedSlideLangResponse> => {
    const url = new URL('/api/images/job', config.apiBaseUrl);
    url.searchParams.set('project', project);
    url.searchParams.set('job_id', jobId);
    const response = await fetchImplementation(url.toString());
    const data = await readResponse(response);
    if (!response.ok) throw new Error(responseDetail(response, data));
    return data;
  };

  const waitForImageJob = async (
    project: string,
    jobId: string,
  ): Promise<HostedSlideLangResponse> => {
    const deadline = Date.now() + config.imageJobTimeoutMs;
    while (Date.now() <= deadline) {
      const result = await getImageJob(project, jobId);
      const status = String(result['status'] ?? '');
      if (status === 'succeeded') return result;
      if (status === 'failed') {
        throw new Error(String(result['error'] ?? result['message'] ?? 'Image generation failed.'));
      }
      await sleep(config.imageJobPollIntervalMs);
    }
    throw new Error(`Timed out waiting for image job ${jobId}.`);
  };

  const startImageGeneration = (
    request: HostedImageGenerationRequest,
  ): Promise<HostedSlideLangResponse> =>
    postJson('/api/images/generate', {
      project: request.project,
      workflow: request.workflow ?? null,
      slide: request.slide ?? null,
      asset: request.asset ?? null,
      retry: request.retry === true,
      files: request.files,
    });

  return {
    mode: 'hosted',
    config,
    check: (request) =>
      postJson('/api/projects/check', {
        project: request.project,
        workflow: request.workflow ?? null,
        files: request.files,
      }),
    budget: (request) =>
      postJson('/api/projects/budget', {
        project: request.project,
        workflow: request.workflow,
        slide: request.slide ?? null,
        files: request.files,
      }),
    repairPlan: (request) =>
      postJson('/api/projects/repair-plan', {
        project: request.project,
        workflow: request.workflow,
        slide: request.slide ?? null,
      }),
    publish: (request) =>
      postJson('/api/projects/publish', {
        project: request.project,
        workflow: request.workflow ?? null,
        files: request.files,
        expected_published_revision_id: request.expectedPublishedRevisionId ?? null,
        include_artifact_files: request.includeArtifactFiles ?? true,
      }),
    pull: (request) =>
      postJson('/api/projects/pull', {
        project: request.project,
        workflow: request.workflow ?? null,
      }),
    startImageGeneration,
    getImageJob,
    waitForImageJob,
    generateImages: async (request) => {
      const started = await startImageGeneration(request);
      const jobId = trimmed(String(started['job_id'] ?? ''));
      if (!jobId) throw new Error('Image generation API did not return a job_id.');
      return waitForImageJob(request.project, jobId);
    },
    uploadMedia: (request) =>
      postJson('/api/media/upload', {
        project: request.project,
        workflow: request.workflow,
        asset_id: request.assetId,
        filename: request.filename,
        content_type: request.contentType,
        content_base64: request.contentBase64,
      }),
    presenterUrl: (project, workflow) =>
      new URL(
        `/present/${encodeURIComponent(project)}/${encodeURIComponent(workflow)}/`,
        config.apiBaseUrl,
      ).toString(),
    mapValidationSummary: mapHostedValidationSummary,
  };
}
