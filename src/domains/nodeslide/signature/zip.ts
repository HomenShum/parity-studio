export type ZipMetadataFailureCode = 'invalid_zip' | 'archive_too_large';

export class ZipMetadataFailure extends Error {
  readonly code: ZipMetadataFailureCode;

  constructor(code: ZipMetadataFailureCode) {
    super(code);
    this.name = 'ZipMetadataFailure';
    this.code = code;
  }
}

export interface ZipDirectoryEntry {
  originalName: string;
  compressedSize: number;
  uncompressedSize: number;
  directory: boolean;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_LOCATOR = 0x07064b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP64_EXTRA_FIELD = 0x0001;

function fail(code: ZipMetadataFailureCode): never {
  throw new ZipMetadataFailure(code);
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) fail('invalid_zip');
  return Number(value);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  return fail('invalid_zip');
}

function readZip64Directory(
  view: DataView,
  endOffset: number,
): { entries: number; offset: number; size: number } {
  const locatorOffset = endOffset - 20;
  if (locatorOffset < 0 || view.getUint32(locatorOffset, true) !== ZIP64_END_LOCATOR) {
    return fail('invalid_zip');
  }
  if (view.getUint32(locatorOffset + 4, true) !== 0) return fail('invalid_zip');
  const zip64Offset = safeNumber(view.getBigUint64(locatorOffset + 8, true));
  if (zip64Offset + 56 > view.byteLength) return fail('invalid_zip');
  if (view.getUint32(zip64Offset, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
    return fail('invalid_zip');
  }
  if (
    view.getUint32(zip64Offset + 16, true) !== 0 ||
    view.getUint32(zip64Offset + 20, true) !== 0
  ) {
    return fail('invalid_zip');
  }
  const entriesOnDisk = view.getBigUint64(zip64Offset + 24, true);
  const entries = view.getBigUint64(zip64Offset + 32, true);
  if (entriesOnDisk !== entries) return fail('invalid_zip');
  return {
    entries: safeNumber(entries),
    size: safeNumber(view.getBigUint64(zip64Offset + 40, true)),
    offset: safeNumber(view.getBigUint64(zip64Offset + 48, true)),
  };
}

function readDirectoryLocation(
  view: DataView,
  endOffset: number,
): { entries: number; offset: number; size: number } {
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entries = view.getUint16(endOffset + 10, true);
  const size = view.getUint32(endOffset + 12, true);
  const offset = view.getUint32(endOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) return fail('invalid_zip');
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    return readZip64Directory(view, endOffset);
  }
  return { entries, offset, size };
}

function findZip64Extra(
  view: DataView,
  offset: number,
  length: number,
): { offset: number; length: number } | undefined {
  const end = offset + length;
  let cursor = offset;
  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    const valueOffset = cursor + 4;
    if (valueOffset + fieldLength > end) return undefined;
    if (id === ZIP64_EXTRA_FIELD) return { offset: valueOffset, length: fieldLength };
    cursor = valueOffset + fieldLength;
  }
  return undefined;
}

function readEntrySizes(
  view: DataView,
  entryOffset: number,
  extraOffset: number,
  extraLength: number,
): { compressedSize: number; uncompressedSize: number } {
  const compressed32 = view.getUint32(entryOffset + 20, true);
  const uncompressed32 = view.getUint32(entryOffset + 24, true);
  if (compressed32 !== 0xffffffff && uncompressed32 !== 0xffffffff) {
    return { compressedSize: compressed32, uncompressedSize: uncompressed32 };
  }

  const zip64 = findZip64Extra(view, extraOffset, extraLength);
  if (!zip64) return fail('invalid_zip');
  let cursor = zip64.offset;
  const end = zip64.offset + zip64.length;
  let uncompressedSize = uncompressed32;
  let compressedSize = compressed32;
  if (uncompressed32 === 0xffffffff) {
    if (cursor + 8 > end) return fail('invalid_zip');
    uncompressedSize = safeNumber(view.getBigUint64(cursor, true));
    cursor += 8;
  }
  if (compressed32 === 0xffffffff) {
    if (cursor + 8 > end) return fail('invalid_zip');
    compressedSize = safeNumber(view.getBigUint64(cursor, true));
  }
  return { compressedSize, uncompressedSize };
}

/** Reads only ZIP directory metadata, before JSZip is allowed to inflate any entry. */
export function readZipDirectory(bytes: Uint8Array, maxEntries: number): ZipDirectoryEntry[] {
  if (bytes.byteLength < 22) return fail('invalid_zip');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const directory = readDirectoryLocation(view, endOffset);
  if (directory.entries > maxEntries) return fail('archive_too_large');
  if (directory.offset + directory.size > bytes.byteLength) return fail('invalid_zip');

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: ZipDirectoryEntry[] = [];
  let cursor = directory.offset;
  const centralEnd = directory.offset + directory.size;
  for (let index = 0; index < directory.entries; index += 1) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY) {
      return fail('invalid_zip');
    }
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const fileNameOffset = cursor + 46;
    const extraOffset = fileNameOffset + fileNameLength;
    const next = extraOffset + extraLength + commentLength;
    if (next > centralEnd) return fail('invalid_zip');
    const originalName = decoder.decode(bytes.subarray(fileNameOffset, extraOffset));
    const sizes = readEntrySizes(view, cursor, extraOffset, extraLength);
    entries.push({
      originalName,
      compressedSize: sizes.compressedSize,
      uncompressedSize: sizes.uncompressedSize,
      directory: originalName.endsWith('/'),
    });
    cursor = next;
  }
  if (cursor > centralEnd) return fail('invalid_zip');
  return entries;
}
