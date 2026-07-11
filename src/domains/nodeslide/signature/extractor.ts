import JSZip, { type JSZipObject } from 'jszip';
import {
  NODESLIDE_SIGNATURE_DEFAULT_BOUNDS,
  NODESLIDE_SIGNATURE_SCHEMA_VERSION,
  type SignatureBytes,
  type SignatureColorToken,
  type SignatureConfidence,
  type SignatureDiagnostics,
  type SignatureDimensionToken,
  type SignatureEvidence,
  type SignatureExtractionBounds,
  type SignatureExtractionErrorCode,
  type SignatureExtractionInput,
  type SignatureExtractionOptions,
  type SignatureExtractionResult,
  type SignatureFontFamilyToken,
  type SignatureNumericUsage,
  type SignatureProfile,
  type SignatureSourceRole,
  type SignatureUsage,
  type SignatureWarning,
  type SignatureWarningCode,
} from '../../../../shared/nodeslideSignature';
import {
  type CanonicalColor,
  type PackageRelationship,
  type RelationshipSet,
  type StylePartObservations,
  type ThemeDefinition,
  canonicalColorKey,
  parseColorMap,
  parsePresentationMetadata,
  parseRelationships,
  parseStylePart,
  parseTheme,
} from './parsers';
import { isSafePackagePath, relationshipPartName } from './xml';
import { type ZipDirectoryEntry, ZipMetadataFailure, readZipDirectory } from './zip';

const PRESENTATION_PART = 'ppt/presentation.xml';
const PRESENTATION_RELS_PART = 'ppt/_rels/presentation.xml.rels';
const EMU_PER_INCH = 914_400;

const DEFAULT_COLOR_MAP: Readonly<Record<string, string>> = Object.freeze({
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
});

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class ExtractionFailure extends Error {
  readonly code: SignatureExtractionErrorCode;

  constructor(code: SignatureExtractionErrorCode) {
    super(code);
    this.name = 'ExtractionFailure';
    this.code = code;
  }
}

class InflationLimitFailure extends Error {
  readonly limit: 'part' | 'aggregate';
  readonly inflatedBytes: number;

  constructor(limit: 'part' | 'aggregate', inflatedBytes: number) {
    super(limit);
    this.name = 'InflationLimitFailure';
    this.limit = limit;
    this.inflatedBytes = inflatedBytes;
  }
}

interface MutableDiagnostics {
  zipEntries: number;
  xmlBytesRead: number;
  partsRead: number;
  slidesDeclared: number;
  slidesProcessed: number;
  evidenceRetained: number;
  usageValuesRetained: {
    colors: number;
    fonts: number;
    fontSizes: number;
  };
}

interface Observation {
  key: string;
  kind: 'color' | 'font' | 'fontSize';
  normalizedValue: string;
  observedValue: string;
  role: SignatureSourceRole;
  locator: string;
  confidence: number;
  occurrences: number;
  suggestedKey: string;
  color?: CanonicalColor;
  points?: number;
}

interface UsageValue<T> {
  value: T;
  normalizedValue: string;
  occurrences: number;
}

interface MasterContext {
  theme: ThemeDefinition | undefined;
  colorMap: Record<string, string>;
}

interface LayoutContext extends MasterContext {
  masterPart: string | undefined;
}

interface InternalStreamHelper {
  on(event: 'data', callback: (chunk: Uint8Array) => void): InternalStreamHelper;
  on(event: 'error', callback: (error: unknown) => void): InternalStreamHelper;
  on(event: 'end', callback: () => void): InternalStreamHelper;
  pause(): InternalStreamHelper;
  resume(): InternalStreamHelper;
}

interface StreamableZipObject extends JSZipObject {
  internalStream(type: 'uint8array'): InternalStreamHelper;
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveBounds(
  overrides: Partial<SignatureExtractionBounds> | undefined,
): SignatureExtractionBounds {
  const result = { ...NODESLIDE_SIGNATURE_DEFAULT_BOUNDS };
  const mutable = result as Record<keyof SignatureExtractionBounds, number>;
  if (!overrides) return result;
  for (const key of Object.keys(result) as Array<keyof SignatureExtractionBounds>) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      mutable[key] = Math.floor(value);
    }
  }
  return result;
}

function emptyMutableDiagnostics(): MutableDiagnostics {
  return {
    zipEntries: 0,
    xmlBytesRead: 0,
    partsRead: 0,
    slidesDeclared: 0,
    slidesProcessed: 0,
    evidenceRetained: 0,
    usageValuesRetained: { colors: 0, fonts: 0, fontSizes: 0 },
  };
}

class WarningCollector {
  readonly #warnings = new Map<string, SignatureWarning>();

  add(code: SignatureWarningCode, message: string, locator?: string): void {
    const warning: SignatureWarning = { code, message, ...(locator ? { locator } : {}) };
    const key = `${code}\u0000${locator ?? ''}\u0000${message}`;
    this.#warnings.set(key, warning);
  }

  values(): SignatureWarning[] {
    return [...this.#warnings.values()].sort(
      (left, right) =>
        compareText(left.code, right.code) ||
        compareText(left.locator ?? '', right.locator ?? '') ||
        compareText(left.message, right.message),
    );
  }

  codes(): SignatureWarningCode[] {
    return [...new Set(this.values().map((warning) => warning.code))].sort(compareText);
  }
}

class ObservationStore {
  readonly #capacity: number;
  readonly #heap: Observation[] = [];
  readonly #indexByKey = new Map<string, number>();
  #truncated = false;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  add(value: Omit<Observation, 'key'>): void {
    const key = [value.kind, value.normalizedValue, value.role, value.locator].join('\u0000');
    const existingIndex = this.#indexByKey.get(key);
    if (existingIndex !== undefined) {
      const existing = this.#heap[existingIndex];
      if (!existing) return;
      existing.occurrences += value.occurrences;
      if (compareText(value.suggestedKey, existing.suggestedKey) < 0) {
        existing.suggestedKey = value.suggestedKey;
      }
      this.#siftDown(existingIndex);
      return;
    }

    const candidate: Observation = { key, ...value };
    if (this.#capacity === 0) {
      this.#truncated = true;
      return;
    }
    if (this.#heap.length < this.#capacity) {
      const index = this.#heap.push(candidate) - 1;
      this.#indexByKey.set(key, index);
      this.#siftUp(index);
      return;
    }

    this.#truncated = true;
    const worst = this.#heap[0];
    if (!worst || compareObservationRank(candidate, worst) >= 0) return;
    this.#indexByKey.delete(worst.key);
    this.#heap[0] = candidate;
    this.#indexByKey.set(key, 0);
    this.#siftDown(0);
  }

  values(): Observation[] {
    return [...this.#heap].sort((left, right) => compareText(left.key, right.key));
  }

  truncated(): boolean {
    return this.#truncated;
  }

  #swap(leftIndex: number, rightIndex: number): void {
    const left = this.#heap[leftIndex];
    const right = this.#heap[rightIndex];
    if (!left || !right) return;
    this.#heap[leftIndex] = right;
    this.#heap[rightIndex] = left;
    this.#indexByKey.set(left.key, rightIndex);
    this.#indexByKey.set(right.key, leftIndex);
  }

  #siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const value = this.#heap[index];
      const parent = this.#heap[parentIndex];
      if (!value || !parent || compareObservationRank(value, parent) <= 0) break;
      this.#swap(index, parentIndex);
      index = parentIndex;
    }
  }

  #siftDown(startIndex: number): void {
    let index = startIndex;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let worstIndex = index;
      const left = this.#heap[leftIndex];
      const currentWorst = this.#heap[worstIndex];
      if (left && currentWorst && compareObservationRank(left, currentWorst) > 0) {
        worstIndex = leftIndex;
      }
      const right = this.#heap[rightIndex];
      const selectedWorst = this.#heap[worstIndex];
      if (right && selectedWorst && compareObservationRank(right, selectedWorst) > 0) {
        worstIndex = rightIndex;
      }
      if (worstIndex === index) return;
      this.#swap(index, worstIndex);
      index = worstIndex;
    }
  }
}

function makeDiagnostics(
  bounds: SignatureExtractionBounds,
  state: MutableDiagnostics,
  warnings: WarningCollector,
  startedAt: number,
): SignatureDiagnostics {
  return {
    bounds: { ...bounds },
    elapsedMs: round(Math.max(0, monotonicNow() - startedAt), 3),
    zipEntries: state.zipEntries,
    xmlBytesRead: state.xmlBytesRead,
    partsRead: state.partsRead,
    slidesDeclared: state.slidesDeclared,
    slidesProcessed: state.slidesProcessed,
    evidenceRetained: state.evidenceRetained,
    usageValuesRetained: { ...state.usageValuesRetained },
    warningCodes: warnings.codes(),
  };
}

function errorMessage(code: SignatureExtractionErrorCode): string {
  switch (code) {
    case 'unsupported_input':
      return 'This signature input type is not supported in revision 1.';
    case 'input_too_large':
      return 'The compressed input exceeds the configured size limit.';
    case 'archive_too_large':
      return 'The presentation archive exceeds a configured extraction limit.';
    case 'slide_limit_exceeded':
      return 'The presentation declares more slides than the configured limit.';
    case 'timeout':
      return 'Signature extraction exceeded the configured time budget.';
    case 'invalid_zip':
      return 'The input is not a valid bounded ZIP archive.';
    case 'invalid_pptx':
      return 'The archive does not contain valid required presentation metadata.';
  }
}

function failureResult(
  code: SignatureExtractionErrorCode,
  bounds: SignatureExtractionBounds,
  state: MutableDiagnostics,
  warnings: WarningCollector,
  startedAt: number,
): SignatureExtractionResult {
  return {
    ok: false,
    error: { code, message: errorMessage(code) },
    diagnostics: makeDiagnostics(bounds, state, warnings, startedAt),
  };
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function sha256Fallback(bytes: Uint8Array): string {
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const bitLength = BigInt(bytes.byteLength) * 8n;
  for (let block = 0; block < paddedLength; block += 64) {
    for (let word = 0; word < 16; word += 1) {
      let value = 0;
      for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
        const absolute = block + word * 4 + byteIndex;
        let byte = 0;
        if (absolute < bytes.byteLength) byte = bytes[absolute] ?? 0;
        else if (absolute === bytes.byteLength) byte = 0x80;
        else if (absolute >= paddedLength - 8) {
          const shift = BigInt((paddedLength - 1 - absolute) * 8);
          byte = Number((bitLength >> shift) & 0xffn);
        }
        value = (value << 8) | byte;
      }
      words[word] = value >>> 0;
    }
    for (let word = 16; word < 64; word += 1) {
      const previous15 = words[word - 15] ?? 0;
      const previous2 = words[word - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[word] = ((words[word - 16] ?? 0) + sigma0 + (words[word - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temporary1 =
        ((h ?? 0) + sum1 + choice + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return [...hash].map((value) => value.toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const source = bytes.slice().buffer;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(bytes);
}

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.byteLength - 2);
    for (let index = 2; index + 1 < bytes.byteLength; index += 2) {
      swapped[index - 2] = bytes[index + 1] ?? 0;
      swapped[index - 1] = bytes[index] ?? 0;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

function inflateBounded(
  entry: JSZipObject,
  partLimit: number,
  aggregateRemaining: number,
  checkDeadline: () => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = (entry as StreamableZipObject).internalStream('uint8array');
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };
    stream
      .on('data', (chunk) => {
        if (settled) return;
        try {
          checkDeadline();
        } catch (error) {
          rejectOnce(error);
          return;
        }
        total += chunk.byteLength;
        if (total > aggregateRemaining) {
          rejectOnce(new InflationLimitFailure('aggregate', total));
          return;
        }
        if (total > partLimit) {
          rejectOnce(new InflationLimitFailure('part', total));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', rejectOnce)
      .on('end', () => {
        if (settled) return;
        settled = true;
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(result);
      })
      .resume();
  });
}

class PartReader {
  readonly #cache = new Map<string, string | undefined>();

  constructor(
    private readonly entries: ReadonlyMap<string, JSZipObject>,
    private readonly sizes: ReadonlyMap<string, number>,
    private readonly bounds: SignatureExtractionBounds,
    private readonly state: MutableDiagnostics,
    private readonly warnings: WarningCollector,
    private readonly checkDeadline: () => void,
  ) {}

  async readXml(partName: string, required = false): Promise<string | undefined> {
    if (this.#cache.has(partName)) {
      const cached = this.#cache.get(partName);
      if (required && cached === undefined) throw new ExtractionFailure('invalid_pptx');
      return cached;
    }
    this.checkDeadline();
    const entry = this.entries.get(partName);
    if (!entry) {
      this.#cache.set(partName, undefined);
      if (required) throw new ExtractionFailure('invalid_pptx');
      return undefined;
    }
    const declaredSize = this.sizes.get(partName);
    if (declaredSize === undefined) throw new ExtractionFailure('invalid_zip');
    if (declaredSize > this.bounds.maxXmlPartBytes) {
      this.warnings.add(
        'part_too_large',
        'An OOXML part exceeded the configured single-part limit and was skipped.',
        partName,
      );
      this.#cache.set(partName, undefined);
      if (required) throw new ExtractionFailure('invalid_pptx');
      return undefined;
    }
    const aggregateRemaining = this.bounds.maxAggregateXmlBytes - this.state.xmlBytesRead;
    if (declaredSize > aggregateRemaining) throw new ExtractionFailure('archive_too_large');

    let bytes: Uint8Array;
    try {
      bytes = await inflateBounded(
        entry,
        this.bounds.maxXmlPartBytes,
        aggregateRemaining,
        this.checkDeadline,
      );
    } catch (error) {
      if (error instanceof InflationLimitFailure) {
        this.state.xmlBytesRead += error.inflatedBytes;
      }
      if (error instanceof InflationLimitFailure && error.limit === 'part') {
        this.warnings.add(
          'part_too_large',
          'An OOXML part exceeded the configured single-part limit and was skipped.',
          partName,
        );
        this.#cache.set(partName, undefined);
        if (required) throw new ExtractionFailure('invalid_pptx');
        return undefined;
      }
      if (error instanceof InflationLimitFailure) throw new ExtractionFailure('archive_too_large');
      if (error instanceof ExtractionFailure) throw error;
      throw new ExtractionFailure('invalid_zip');
    }
    this.checkDeadline();
    this.state.xmlBytesRead += bytes.byteLength;
    this.state.partsRead += 1;
    const xml = decodeXml(bytes);
    this.#cache.set(partName, xml);
    return xml;
  }

  canonicalDigestBytes(extraMetadata: readonly string[]): Uint8Array {
    const material = [...this.#cache.entries()]
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([partName, xml]) => `${partName.length}:${partName}${xml.length}:${xml}`);
    for (const value of [...extraMetadata].sort(compareText)) {
      material.push(`${value.length}:${value}`);
    }
    return new TextEncoder().encode(material.join(''));
  }
}

function buildSafeEntryMaps(
  zip: JSZip,
  directory: readonly ZipDirectoryEntry[],
  warnings: WarningCollector,
): { entries: Map<string, JSZipObject>; sizes: Map<string, number> } {
  const sizes = new Map<string, number>();
  for (const metadata of directory) {
    if (metadata.directory) continue;
    if (!isSafePackagePath(metadata.originalName)) {
      warnings.add('unsafe_archive_entry', 'An unsafe archive entry name was ignored.');
      continue;
    }
    if (sizes.has(metadata.originalName)) throw new ExtractionFailure('invalid_zip');
    sizes.set(metadata.originalName, metadata.uncompressedSize);
  }

  const entries = new Map<string, JSZipObject>();
  for (const name of Object.keys(zip.files).sort(compareText)) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    const originalName = entry.unsafeOriginalName ?? entry.name;
    if (
      originalName !== entry.name ||
      !isSafePackagePath(originalName) ||
      !sizes.has(originalName)
    ) {
      warnings.add('unsafe_archive_entry', 'An unsafe archive entry name was ignored.');
      continue;
    }
    entries.set(originalName, entry);
  }
  return { entries, sizes };
}

function targetByType(
  relationships: RelationshipSet | undefined,
  type: string,
): PackageRelationship | undefined {
  return relationships
    ? [...relationships.byId.values()]
        .filter((relationship) => relationship.type === type)
        .sort(
          (left, right) =>
            compareText(left.target ?? '', right.target ?? '') || compareText(left.id, right.id),
        )[0]
    : undefined;
}

function addStyleObservations(
  store: ObservationStore,
  part: StylePartObservations,
  role: Exclude<SignatureSourceRole, 'theme' | 'inferred' | 'authored'>,
  locator: string,
): void {
  for (const [normalized, counted] of [...part.colors].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const keySuffix = slug(normalized, 'color');
    store.add({
      kind: 'color',
      normalizedValue: normalized,
      observedValue: normalized,
      role,
      locator: `${locator}#color/${keySuffix}`,
      confidence: 1,
      occurrences: counted.occurrences,
      suggestedKey: `color-${keySuffix}`,
      color: counted.color,
    });
  }
  for (const [normalized, counted] of [...part.fonts].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    store.add({
      kind: 'font',
      normalizedValue: normalized,
      observedValue: counted.value,
      role,
      locator: `${locator}#font/${slug(counted.value, 'family')}`,
      confidence: 1,
      occurrences: counted.occurrences,
      suggestedKey: counted.value,
    });
  }
  for (const [normalized, counted] of [...part.fontSizes].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    store.add({
      kind: 'fontSize',
      normalizedValue: normalized,
      observedValue: `${counted.value}pt`,
      role,
      locator: `${locator}#font-size/${normalized}`,
      confidence: 1,
      occurrences: counted.occurrences,
      suggestedKey: `size-${normalized}pt`,
      points: counted.value,
    });
  }
}

function addThemeObservations(
  store: ObservationStore,
  themePart: string,
  theme: ThemeDefinition,
): void {
  for (const [role, color] of [...theme.colors].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const normalized = canonicalColorKey(color);
    store.add({
      kind: 'color',
      normalizedValue: normalized,
      observedValue: normalized,
      role: 'theme',
      locator: `${themePart}#color-scheme/${role}`,
      confidence: 1,
      occurrences: 1,
      suggestedKey: role,
      color,
    });
  }
  if (theme.majorFont) {
    store.add({
      kind: 'font',
      normalizedValue: theme.majorFont.toLocaleLowerCase('en-US'),
      observedValue: theme.majorFont,
      role: 'theme',
      locator: `${themePart}#font-scheme/major-latin`,
      confidence: 1,
      occurrences: 1,
      suggestedKey: 'major-latin',
    });
  }
  if (theme.minorFont) {
    store.add({
      kind: 'font',
      normalizedValue: theme.minorFont.toLocaleLowerCase('en-US'),
      observedValue: theme.minorFont,
      role: 'theme',
      locator: `${themePart}#font-scheme/minor-latin`,
      confidence: 1,
      occurrences: 1,
      suggestedKey: 'minor-latin',
    });
  }
}

function mergeUsage<T>(
  target: Map<string, UsageValue<T>>,
  normalizedValue: string,
  value: T,
  occurrences: number,
): void {
  const existing = target.get(normalizedValue);
  if (existing) existing.occurrences += occurrences;
  else target.set(normalizedValue, { value, normalizedValue, occurrences });
}

function addSlideUsage(
  part: StylePartObservations,
  colors: Map<string, UsageValue<string>>,
  fonts: Map<string, UsageValue<string>>,
  fontSizes: Map<string, UsageValue<number>>,
): void {
  for (const [normalized, counted] of part.colors) {
    mergeUsage(colors, normalized, canonicalColorKey(counted.color), counted.occurrences);
  }
  for (const [normalized, counted] of part.fonts) {
    mergeUsage(fonts, normalized, counted.value, counted.occurrences);
  }
  for (const [normalized, counted] of part.fontSizes) {
    mergeUsage(fontSizes, normalized, counted.value, counted.occurrences);
  }
}

function rolePriority(role: SignatureSourceRole): number {
  switch (role) {
    case 'theme':
      return 6;
    case 'slide':
      return 5;
    case 'master':
      return 4;
    case 'layout':
      return 3;
    case 'authored':
      return 2;
    case 'inferred':
      return 1;
  }
}

function compareObservationRank(left: Observation, right: Observation): number {
  return (
    right.confidence - left.confidence ||
    right.occurrences - left.occurrences ||
    rolePriority(right.role) - rolePriority(left.role) ||
    compareText(left.key, right.key)
  );
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function evidenceIdsFor(
  observations: readonly Observation[],
  idByKey: ReadonlyMap<string, string>,
  retained: ReadonlySet<string>,
): string[] {
  return observations
    .map((observation) => idByKey.get(observation.key))
    .filter((id): id is string => Boolean(id && retained.has(id)))
    .sort(compareText);
}

function allocateStableKeys<T extends { normalizedValue: string; suggestedKey: string }>(
  candidates: readonly T[],
): Array<T & { key: string }> {
  const sorted = [...candidates].sort(
    (left, right) =>
      compareText(slug(left.suggestedKey, 'token'), slug(right.suggestedKey, 'token')) ||
      compareText(left.normalizedValue, right.normalizedValue),
  );
  const counts = new Map<string, number>();
  return sorted.map((candidate) => {
    const base = slug(candidate.suggestedKey, 'token');
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { ...candidate, key: count === 1 ? base : `${base}-${count}` };
  });
}

function groupObservations(
  observations: readonly Observation[],
  kind: Observation['kind'],
): Array<{ normalizedValue: string; suggestedKey: string; observations: Observation[] }> {
  const grouped = new Map<string, Observation[]>();
  for (const observation of observations) {
    if (observation.kind !== kind) continue;
    const group = grouped.get(observation.normalizedValue);
    if (group) group.push(observation);
    else grouped.set(observation.normalizedValue, [observation]);
  }
  return [...grouped.entries()].map(([normalizedValue, values]) => {
    values.sort(
      (left, right) =>
        rolePriority(right.role) - rolePriority(left.role) ||
        compareText(left.suggestedKey, right.suggestedKey) ||
        compareText(left.locator, right.locator),
    );
    return {
      normalizedValue,
      suggestedKey: values[0]?.suggestedKey ?? 'token',
      observations: values,
    };
  });
}

function extensionFor(
  observations: readonly Observation[],
  idByKey: ReadonlyMap<string, string>,
  retained: ReadonlySet<string>,
  originalPoints?: number,
) {
  const occurrences = observations.reduce(
    (total, observation) => total + observation.occurrences,
    0,
  );
  const confidence = Math.max(...observations.map((observation) => observation.confidence));
  const sourceRole =
    [...observations].sort(
      (left, right) =>
        rolePriority(right.role) - rolePriority(left.role) ||
        compareText(left.locator, right.locator),
    )[0]?.role ?? 'inferred';
  return {
    evidenceIds: evidenceIdsFor(observations, idByKey, retained),
    confidence: round(confidence),
    occurrences,
    sourceRole,
    ...(originalPoints === undefined ? {} : { originalPoints: round(originalPoints) }),
  };
}

function finalizeEvidenceAndTokens(
  store: ObservationStore,
  digest: string,
  warnings: WarningCollector,
  state: MutableDiagnostics,
  checkDeadline: () => void,
): {
  evidence: SignatureEvidence[];
  colors: Record<string, SignatureColorToken>;
  fontFamilies: Record<string, SignatureFontFamilyToken>;
  fontSizes: Record<string, SignatureDimensionToken>;
  idByKey: Map<string, string>;
  retained: Set<string>;
  observations: Observation[];
} {
  const observations = store.values();
  checkDeadline();
  const idByKey = new Map<string, string>();
  observations.forEach((observation, index) => {
    idByKey.set(observation.key, `evidence-${String(index + 1).padStart(6, '0')}`);
  });
  const retained = new Set(idByKey.values());
  if (store.truncated()) {
    warnings.add(
      'evidence_truncated',
      'Evidence records were deterministically truncated at the configured limit.',
    );
  }
  const evidence = observations
    .map((observation) => ({
      id: idByKey.get(observation.key) ?? '',
      sourceKind: 'pptx' as const,
      method: 'ooxml' as const,
      sourceDigest: digest,
      locator: observation.locator,
      observedValue: observation.observedValue,
      confidence: round(observation.confidence),
    }))
    .sort((left, right) => compareText(left.id, right.id));
  state.evidenceRetained = evidence.length;
  checkDeadline();

  const colorCandidates = allocateStableKeys(groupObservations(observations, 'color'));
  const colors: Record<string, SignatureColorToken> = {};
  for (const [index, candidate] of colorCandidates.entries()) {
    if ((index & 255) === 0) checkDeadline();
    const color = candidate.observations.find((observation) => observation.color)?.color;
    if (!color) continue;
    colors[candidate.key] = {
      $type: 'color',
      $value: { ...color, components: [...color.components] },
      $extensions: {
        'com.nodeslide.signature': extensionFor(candidate.observations, idByKey, retained),
      },
    };
  }

  const fontCandidates = allocateStableKeys(groupObservations(observations, 'font'));
  const fontFamilies: Record<string, SignatureFontFamilyToken> = {};
  for (const [index, candidate] of fontCandidates.entries()) {
    if ((index & 255) === 0) checkDeadline();
    const value = candidate.observations[0]?.observedValue;
    if (!value) continue;
    fontFamilies[candidate.key] = {
      $type: 'fontFamily',
      $value: value,
      $extensions: {
        'com.nodeslide.signature': extensionFor(candidate.observations, idByKey, retained),
      },
    };
  }

  const sizeCandidates = allocateStableKeys(groupObservations(observations, 'fontSize'));
  const fontSizes: Record<string, SignatureDimensionToken> = {};
  for (const [index, candidate] of sizeCandidates.entries()) {
    if ((index & 255) === 0) checkDeadline();
    const points = candidate.observations.find((observation) => observation.points)?.points;
    if (points === undefined) continue;
    fontSizes[candidate.key] = {
      $type: 'dimension',
      $value: { value: round((points * 4) / 3), unit: 'px' },
      $extensions: {
        'com.nodeslide.signature': extensionFor(candidate.observations, idByKey, retained, points),
      },
    };
  }

  return { evidence, colors, fontFamilies, fontSizes, idByKey, retained, observations };
}

function usageEvidenceIds(
  observations: readonly Observation[],
  kind: Observation['kind'],
  normalizedValue: string,
  idByKey: ReadonlyMap<string, string>,
  retained: ReadonlySet<string>,
): string[] {
  return evidenceIdsFor(
    observations.filter(
      (observation) =>
        observation.kind === kind &&
        observation.normalizedValue === normalizedValue &&
        observation.role === 'slide',
    ),
    idByKey,
    retained,
  );
}

function finalizeStringUsage(
  source: ReadonlyMap<string, UsageValue<string>>,
  kind: Extract<Observation['kind'], 'color' | 'font'>,
  bounds: SignatureExtractionBounds,
  warnings: WarningCollector,
  observations: readonly Observation[],
  idByKey: ReadonlyMap<string, string>,
  retained: ReadonlySet<string>,
  locator: string,
): SignatureUsage[] {
  const sorted = [...source.values()].sort(
    (left, right) =>
      right.occurrences - left.occurrences ||
      compareText(left.normalizedValue, right.normalizedValue),
  );
  if (sorted.length > bounds.maxUsageValuesPerCategory) {
    warnings.add(
      'usage_truncated',
      'Usage values were deterministically truncated at the configured category limit.',
      locator,
    );
  }
  return sorted.slice(0, bounds.maxUsageValuesPerCategory).map((usage) => ({
    value: usage.value,
    occurrences: usage.occurrences,
    evidenceIds: usageEvidenceIds(observations, kind, usage.normalizedValue, idByKey, retained),
  }));
}

function finalizeNumericUsage(
  source: ReadonlyMap<string, UsageValue<number>>,
  bounds: SignatureExtractionBounds,
  warnings: WarningCollector,
  observations: readonly Observation[],
  idByKey: ReadonlyMap<string, string>,
  retained: ReadonlySet<string>,
): SignatureNumericUsage[] {
  const sorted = [...source.values()].sort(
    (left, right) => right.occurrences - left.occurrences || left.value - right.value,
  );
  if (sorted.length > bounds.maxUsageValuesPerCategory) {
    warnings.add(
      'usage_truncated',
      'Usage values were deterministically truncated at the configured category limit.',
      'usage.fontSizes',
    );
  }
  return sorted.slice(0, bounds.maxUsageValuesPerCategory).map((usage) => ({
    value: usage.value,
    unit: 'pt',
    occurrences: usage.occurrences,
    evidenceIds: usageEvidenceIds(
      observations,
      'fontSize',
      usage.normalizedValue,
      idByKey,
      retained,
    ),
  }));
}

function weightedMedian(source: ReadonlyMap<string, UsageValue<number>>): number | undefined {
  const values = [...source.values()].sort((left, right) => left.value - right.value);
  const total = values.reduce((sum, value) => sum + value.occurrences, 0);
  if (total === 0) return undefined;
  const atRank = (rank: number): number => {
    let cumulative = 0;
    for (const value of values) {
      cumulative += value.occurrences;
      if (cumulative > rank) return value.value;
    }
    return values.at(-1)?.value ?? 0;
  };
  const left = atRank(Math.floor((total - 1) / 2));
  const right = atRank(Math.floor(total / 2));
  return round((left + right) / 2);
}

/**
 * Density is descriptive: sparse means <=4 shapes and <=6 text runs per slide; dense means >=15
 * shapes, >=24 text runs, or >=32 combined. Non-empty decks between those thresholds are balanced.
 */
function classifyDensity(
  slideCount: number,
  averageShapes: number,
  averageTextRuns: number,
): 'sparse' | 'balanced' | 'dense' | 'unknown' {
  if (slideCount === 0) return 'unknown';
  if (averageShapes <= 4 && averageTextRuns <= 6) return 'sparse';
  if (averageShapes >= 15 || averageTextRuns >= 24 || averageShapes + averageTextRuns >= 32) {
    return 'dense';
  }
  return 'balanced';
}

function profileConfidence(
  slideCount: number,
  tokenCount: number,
  parsedThemeCount: number,
  warnings: readonly SignatureWarning[],
): SignatureConfidence {
  if (slideCount === 0 || tokenCount === 0) return 'low';
  const degrading = new Set<SignatureWarningCode>([
    'part_too_large',
    'evidence_truncated',
    'usage_truncated',
    'unresolved_alias',
    'unresolved_color',
    'missing_theme',
    'missing_master',
    'missing_layout',
    'missing_slide',
    'malformed_optional_part',
    'unsafe_relationship',
    'embedded_font_unresolved',
  ]);
  return parsedThemeCount > 0 && !warnings.some((warning) => degrading.has(warning.code))
    ? 'high'
    : 'medium';
}

function sourceName(fileName: string | undefined, digest: string): string {
  const baseName = fileName
    ?.split(/[\\/]/)
    .at(-1)
    ?.replace(/\.pptx$/i, '')
    .trim();
  return baseName || `PPTX signature ${digest.slice(0, 8)}`;
}

async function readOptionalRelationships(
  reader: PartReader,
  sourcePart: string,
  warnings: WarningCollector,
  checkDeadline: () => void,
): Promise<RelationshipSet | undefined> {
  const relationshipPart = relationshipPartName(sourcePart);
  const xml = await reader.readXml(relationshipPart);
  if (!xml) return undefined;
  const relationships = parseRelationships(xml, sourcePart, checkDeadline);
  if (relationships.malformed || !relationships.validRoot) {
    warnings.add(
      'malformed_optional_part',
      'A malformed optional OOXML relationship part was ignored.',
      relationshipPart,
    );
    return undefined;
  }
  return relationships;
}

async function extractPptxInternal(
  bytes: Uint8Array,
  fileName: string | undefined,
  bounds: SignatureExtractionBounds,
  state: MutableDiagnostics,
  warnings: WarningCollector,
  startedAt: number,
): Promise<SignatureProfile> {
  const checkDeadline = (): void => {
    if (monotonicNow() - startedAt >= bounds.timeoutMs) throw new ExtractionFailure('timeout');
  };
  checkDeadline();
  let directory: ZipDirectoryEntry[];
  try {
    directory = readZipDirectory(bytes, bounds.maxZipEntries);
  } catch (error) {
    if (error instanceof ZipMetadataFailure) throw new ExtractionFailure(error.code);
    throw new ExtractionFailure('invalid_zip');
  }
  state.zipEntries = directory.length;
  checkDeadline();

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false, checkCRC32: false });
  } catch {
    throw new ExtractionFailure('invalid_zip');
  }
  checkDeadline();
  const safe = buildSafeEntryMaps(zip, directory, warnings);
  const reader = new PartReader(safe.entries, safe.sizes, bounds, state, warnings, checkDeadline);

  const presentationXml = await reader.readXml(PRESENTATION_PART, true);
  if (!presentationXml) throw new ExtractionFailure('invalid_pptx');
  const presentation = parsePresentationMetadata(presentationXml, checkDeadline);
  if (
    presentation.malformed ||
    !presentation.validRoot ||
    !Number.isFinite(presentation.slideWidthEmu) ||
    !Number.isFinite(presentation.slideHeightEmu) ||
    presentation.slideWidthEmu <= 0 ||
    presentation.slideHeightEmu <= 0 ||
    new Set(presentation.slideRelationshipIds).size !== presentation.slideRelationshipIds.length
  ) {
    throw new ExtractionFailure('invalid_pptx');
  }
  state.slidesDeclared = presentation.slideRelationshipIds.length;
  if (state.slidesDeclared > bounds.maxSlides) {
    throw new ExtractionFailure('slide_limit_exceeded');
  }

  const presentationRelsXml = await reader.readXml(PRESENTATION_RELS_PART);
  let presentationRels: RelationshipSet | undefined;
  if (presentationRelsXml) {
    const parsed = parseRelationships(presentationRelsXml, PRESENTATION_PART, checkDeadline);
    if (!parsed.validRoot || parsed.malformed) {
      if (state.slidesDeclared > 0) throw new ExtractionFailure('invalid_pptx');
      warnings.add(
        'malformed_optional_part',
        'A malformed optional OOXML relationship part was ignored.',
        PRESENTATION_RELS_PART,
      );
    } else {
      presentationRels = parsed;
    }
  } else if (state.slidesDeclared > 0) {
    throw new ExtractionFailure('invalid_pptx');
  }

  const orderedSlideParts = presentation.slideRelationshipIds.map((relationshipId) => {
    const relationship = presentationRels?.byId.get(relationshipId);
    if (
      !relationship ||
      relationship.type !== 'slide' ||
      relationship.unsafe ||
      !relationship.target?.match(/^ppt\/slides\/[^/]+\.xml$/)
    ) {
      throw new ExtractionFailure('invalid_pptx');
    }
    return relationship.target;
  });
  if (new Set(orderedSlideParts).size !== orderedSlideParts.length) {
    throw new ExtractionFailure('invalid_pptx');
  }

  const observations = new ObservationStore(bounds.maxEvidenceRecords);
  const themeParts = [...safe.entries.keys()]
    .filter((partName) => /^ppt\/theme\/theme[^/]*\.xml$/.test(partName))
    .sort(compareText);
  const themes = new Map<string, ThemeDefinition>();
  for (const themePart of themeParts) {
    const xml = await reader.readXml(themePart);
    if (!xml) continue;
    const parsed = parseTheme(xml, checkDeadline);
    if (parsed.malformed || !parsed.validRoot) {
      warnings.add(
        'malformed_optional_part',
        'A malformed optional theme part was ignored.',
        themePart,
      );
      continue;
    }
    themes.set(themePart, parsed.theme);
    addThemeObservations(observations, themePart, parsed.theme);
    if (parsed.unresolvedColors) {
      warnings.add(
        'unresolved_color',
        'An OOXML theme color used an unsupported or invalid color transform.',
        themePart,
      );
    }
  }
  if (themes.size === 0) {
    warnings.add('missing_theme', 'No usable OOXML theme part was available.');
  }

  const presentationThemeRelationship = targetByType(presentationRels, 'theme');
  if (presentationThemeRelationship?.unsafe) {
    warnings.add(
      'unsafe_relationship',
      'An unsafe theme relationship was ignored.',
      PRESENTATION_RELS_PART,
    );
  }
  const presentationTheme = presentationThemeRelationship?.target
    ? themes.get(presentationThemeRelationship.target)
    : undefined;

  const masterParts = [...safe.entries.keys()]
    .filter((partName) => /^ppt\/slideMasters\/[^/]+\.xml$/.test(partName))
    .sort(compareText);
  const masters = new Map<string, MasterContext>();
  for (const masterPart of masterParts) {
    const relationships = await readOptionalRelationships(
      reader,
      masterPart,
      warnings,
      checkDeadline,
    );
    const themeRelationship = targetByType(relationships, 'theme');
    if (themeRelationship?.unsafe) {
      warnings.add(
        'unsafe_relationship',
        'An unsafe theme relationship was ignored.',
        relationshipPartName(masterPart),
      );
    }
    const theme = themeRelationship?.target
      ? themes.get(themeRelationship.target)
      : presentationTheme;
    const xml = await reader.readXml(masterPart);
    if (!xml) {
      masters.set(masterPart, { theme, colorMap: { ...DEFAULT_COLOR_MAP } });
      continue;
    }
    const mapped = parseColorMap(xml, DEFAULT_COLOR_MAP, checkDeadline);
    const styled = parseStylePart(xml, {
      locator: masterPart,
      role: 'master',
      theme,
      colorMap: mapped.colorMap,
      countGeometry: false,
      warning: (code, locator) =>
        warnings.add(code, 'An OOXML color or font alias could not be resolved.', locator),
      checkDeadline,
    });
    if (mapped.malformed || styled.malformed || !styled.validRoot) {
      warnings.add(
        'malformed_optional_part',
        'A malformed optional slide-master part was ignored.',
        masterPart,
      );
    } else {
      addStyleObservations(observations, styled, 'master', masterPart);
    }
    masters.set(masterPart, { theme, colorMap: mapped.colorMap });
  }
  if (masterParts.length === 0) {
    warnings.add('missing_master', 'No slide-master part was available.');
  }

  const layoutParts = [...safe.entries.keys()]
    .filter((partName) => /^ppt\/slideLayouts\/[^/]+\.xml$/.test(partName))
    .sort(compareText);
  const layouts = new Map<string, LayoutContext>();
  for (const layoutPart of layoutParts) {
    const relationships = await readOptionalRelationships(
      reader,
      layoutPart,
      warnings,
      checkDeadline,
    );
    const masterRelationship = targetByType(relationships, 'slideMaster');
    if (masterRelationship?.unsafe) {
      warnings.add(
        'unsafe_relationship',
        'An unsafe slide-master relationship was ignored.',
        relationshipPartName(layoutPart),
      );
    }
    const masterPart = masterRelationship?.target;
    const master = masterPart ? masters.get(masterPart) : undefined;
    if (masterPart && !master) {
      warnings.add('missing_master', 'A referenced slide-master part was unavailable.', layoutPart);
    }
    const theme = master?.theme ?? presentationTheme;
    const baseColorMap = master?.colorMap ?? { ...DEFAULT_COLOR_MAP };
    const xml = await reader.readXml(layoutPart);
    if (!xml) {
      layouts.set(layoutPart, { theme, colorMap: { ...baseColorMap }, masterPart });
      continue;
    }
    const mapped = parseColorMap(xml, baseColorMap, checkDeadline);
    const styled = parseStylePart(xml, {
      locator: layoutPart,
      role: 'layout',
      theme,
      colorMap: mapped.colorMap,
      countGeometry: false,
      warning: (code, locator) =>
        warnings.add(code, 'An OOXML color or font alias could not be resolved.', locator),
      checkDeadline,
    });
    if (mapped.malformed || styled.malformed || !styled.validRoot) {
      warnings.add(
        'malformed_optional_part',
        'A malformed optional slide-layout part was ignored.',
        layoutPart,
      );
    } else {
      addStyleObservations(observations, styled, 'layout', layoutPart);
    }
    layouts.set(layoutPart, { theme, colorMap: mapped.colorMap, masterPart });
  }
  if (layoutParts.length === 0) {
    warnings.add('missing_layout', 'No slide-layout part was available.');
  }

  const embeddedFontFamilies = new Set<string>();
  const embeddedFontFamilyCounts = new Map<string, { family: string; occurrences: number }>();
  const fontBinaryParts = [...safe.entries.keys()].filter((partName) =>
    /^ppt\/fonts\/[^/]+$/.test(partName),
  );
  for (const declaration of presentation.embeddedFonts) {
    if (declaration.family) {
      embeddedFontFamilies.add(declaration.family);
      const normalized = declaration.family.toLocaleLowerCase('en-US');
      const existing = embeddedFontFamilyCounts.get(normalized);
      if (existing) existing.occurrences += 1;
      else embeddedFontFamilyCounts.set(normalized, { family: declaration.family, occurrences: 1 });
    }
    for (const relationshipId of declaration.relationshipIds) {
      const relationship = presentationRels?.byId.get(relationshipId);
      if (
        !relationship ||
        relationship.unsafe ||
        relationship.type !== 'font' ||
        !relationship.target?.match(/^ppt\/fonts\/[^/]+$/) ||
        !safe.entries.has(relationship.target)
      ) {
        warnings.add(
          'embedded_font_unresolved',
          'An embedded-font declaration did not resolve to package-local font metadata.',
          PRESENTATION_PART,
        );
      }
    }
  }
  for (const [normalized, counted] of [...embeddedFontFamilyCounts].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    observations.add({
      kind: 'font',
      normalizedValue: normalized,
      observedValue: counted.family,
      role: 'theme',
      locator: `${PRESENTATION_PART}#embedded-font/${slug(counted.family, 'family')}`,
      confidence: 1,
      occurrences: counted.occurrences,
      suggestedKey: `embedded-${counted.family}`,
    });
  }

  const colorUsage = new Map<string, UsageValue<string>>();
  const fontUsage = new Map<string, UsageValue<string>>();
  const sizeUsage = new Map<string, UsageValue<number>>();
  const layoutUsage = new Map<string, number>();
  const shapeCounts: number[] = [];
  const textRunCounts: number[] = [];

  for (const slidePart of orderedSlideParts) {
    checkDeadline();
    const slideXml = await reader.readXml(slidePart);
    if (!slideXml) {
      warnings.add('missing_slide', 'A declared slide part was unavailable.', slidePart);
      shapeCounts.push(0);
      textRunCounts.push(0);
      continue;
    }
    state.slidesProcessed += 1;
    const relationships = await readOptionalRelationships(
      reader,
      slidePart,
      warnings,
      checkDeadline,
    );
    const layoutRelationship = targetByType(relationships, 'slideLayout');
    let layout: LayoutContext | undefined;
    if (layoutRelationship?.unsafe) {
      warnings.add(
        'unsafe_relationship',
        'An unsafe slide-layout relationship was ignored.',
        relationshipPartName(slidePart),
      );
    } else if (layoutRelationship?.target) {
      layoutUsage.set(
        layoutRelationship.target,
        (layoutUsage.get(layoutRelationship.target) ?? 0) + 1,
      );
      layout = layouts.get(layoutRelationship.target);
      if (!layout) {
        warnings.add(
          'missing_layout',
          'A referenced slide-layout part was unavailable.',
          slidePart,
        );
      }
    } else {
      warnings.add('missing_layout', 'A slide did not declare a usable slide-layout.', slidePart);
    }
    const theme = layout?.theme ?? presentationTheme;
    const baseColorMap = layout?.colorMap ?? { ...DEFAULT_COLOR_MAP };
    const mapped = parseColorMap(slideXml, baseColorMap, checkDeadline);
    const styled = parseStylePart(slideXml, {
      locator: slidePart,
      role: 'slide',
      theme,
      colorMap: mapped.colorMap,
      countGeometry: true,
      warning: (code, locator) =>
        warnings.add(code, 'An OOXML color or font alias could not be resolved.', locator),
      checkDeadline,
    });
    if (mapped.malformed || styled.malformed || !styled.validRoot) {
      warnings.add('malformed_optional_part', 'A malformed slide part was ignored.', slidePart);
      shapeCounts.push(0);
      textRunCounts.push(0);
      continue;
    }
    addStyleObservations(observations, styled, 'slide', slidePart);
    addSlideUsage(styled, colorUsage, fontUsage, sizeUsage);
    shapeCounts.push(styled.shapeCount);
    textRunCounts.push(styled.textRunCount);
  }

  if (state.slidesDeclared === 0) {
    warnings.add('empty_deck', 'The presentation contains no declared slides.');
  }

  const digest = await sha256Hex(
    reader.canonicalDigestBytes(
      fontBinaryParts.map(
        (partName) => `embedded-font:${partName}:${safe.sizes.get(partName) ?? 0}`,
      ),
    ),
  );
  checkDeadline();
  const finalized = finalizeEvidenceAndTokens(observations, digest, warnings, state, checkDeadline);
  const usageColors = finalizeStringUsage(
    colorUsage,
    'color',
    bounds,
    warnings,
    finalized.observations,
    finalized.idByKey,
    finalized.retained,
    'usage.colors',
  );
  const usageFonts = finalizeStringUsage(
    fontUsage,
    'font',
    bounds,
    warnings,
    finalized.observations,
    finalized.idByKey,
    finalized.retained,
    'usage.fonts',
  );
  const usageFontSizes = finalizeNumericUsage(
    sizeUsage,
    bounds,
    warnings,
    finalized.observations,
    finalized.idByKey,
    finalized.retained,
  );
  state.usageValuesRetained = {
    colors: usageColors.length,
    fonts: usageFonts.length,
    fontSizes: usageFontSizes.length,
  };

  const averageShapes =
    state.slidesDeclared === 0
      ? 0
      : round(shapeCounts.reduce((sum, count) => sum + count, 0) / state.slidesDeclared);
  const averageTextRuns =
    state.slidesDeclared === 0
      ? 0
      : round(textRunCounts.reduce((sum, count) => sum + count, 0) / state.slidesDeclared);
  const widthInches = round(presentation.slideWidthEmu / EMU_PER_INCH);
  const heightInches = round(presentation.slideHeightEmu / EMU_PER_INCH);
  const medianFontSizePoints = weightedMedian(sizeUsage);
  const warningValues = warnings.values();
  const tokenCount =
    Object.keys(finalized.colors).length +
    Object.keys(finalized.fontFamilies).length +
    Object.keys(finalized.fontSizes).length;

  const profile: SignatureProfile = {
    schemaVersion: NODESLIDE_SIGNATURE_SCHEMA_VERSION,
    id: `nodeslide-signature-${digest.slice(0, 24)}`,
    name: sourceName(fileName, digest),
    source: {
      kind: 'pptx',
      digest,
      ...(fileName ? { fileName } : {}),
    },
    tokens: {
      colors: finalized.colors,
      fontFamilies: finalized.fontFamilies,
      fontSizes: finalized.fontSizes,
    },
    usage: {
      colors: usageColors,
      fonts: usageFonts,
      fontSizes: usageFontSizes,
    },
    layout: {
      slideWidthInches: widthInches,
      slideHeightInches: heightInches,
      aspectRatio: round(widthInches / heightInches),
      slideCount: state.slidesDeclared,
      masterCount: masterParts.length,
      layoutCount: layoutParts.length,
      layoutUsage: [...layoutUsage.entries()]
        .map(([partName, occurrences]) => ({ partName, occurrences }))
        .sort(
          (left, right) =>
            right.occurrences - left.occurrences || compareText(left.partName, right.partName),
        ),
      averageShapesPerSlide: averageShapes,
      maximumShapesPerSlide: Math.max(0, ...shapeCounts),
      averageTextRunsPerSlide: averageTextRuns,
      ...(medianFontSizePoints === undefined ? {} : { medianFontSizePoints }),
      density: classifyDensity(state.slidesDeclared, averageShapes, averageTextRuns),
      embeddedFontsPresent: presentation.embeddedFonts.length > 0 || fontBinaryParts.length > 0,
      embeddedFontFamilies: [...embeddedFontFamilies].sort(compareText),
    },
    evidence: finalized.evidence,
    confidence: profileConfidence(state.slidesDeclared, tokenCount, themes.size, warningValues),
    warnings: warningValues,
  };
  checkDeadline();
  return profile;
}

export async function extractPptxSignature(
  inputBytes: SignatureBytes,
  options: SignatureExtractionOptions = {},
): Promise<SignatureExtractionResult> {
  const startedAt = monotonicNow();
  const bounds = resolveBounds(options.bounds);
  const state = emptyMutableDiagnostics();
  const warnings = new WarningCollector();
  try {
    const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
    if (bytes.byteLength > bounds.maxCompressedBytes) {
      return failureResult('input_too_large', bounds, state, warnings, startedAt);
    }
    const profile = await extractPptxInternal(
      bytes,
      options.fileName,
      bounds,
      state,
      warnings,
      startedAt,
    );
    return {
      ok: true,
      profile,
      diagnostics: makeDiagnostics(bounds, state, warnings, startedAt),
    };
  } catch (error) {
    const code = error instanceof ExtractionFailure ? error.code : 'invalid_pptx';
    return failureResult(code, bounds, state, warnings, startedAt);
  }
}

export async function extractSignature(
  input: SignatureExtractionInput,
  options: SignatureExtractionOptions = {},
): Promise<SignatureExtractionResult> {
  if (input.kind !== 'pptx') {
    const startedAt = monotonicNow();
    const bounds = resolveBounds(options.bounds);
    return failureResult(
      'unsupported_input',
      bounds,
      emptyMutableDiagnostics(),
      new WarningCollector(),
      startedAt,
    );
  }
  return extractPptxSignature(input.bytes, {
    ...options,
    ...(input.fileName ? { fileName: input.fileName } : {}),
  });
}

function stableJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Signature profiles must contain finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const properties = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${properties.join(',')}}`;
  }
  throw new TypeError('Signature profiles must contain only JSON-compatible values.');
}

export function stableSerializeSignature(profile: SignatureProfile): string {
  return stableJson(profile);
}
