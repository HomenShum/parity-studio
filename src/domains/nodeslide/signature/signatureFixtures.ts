import JSZip from 'jszip';

export interface SignatureFixtureOptions {
  slideCount?: number;
  layoutCount?: 1 | 2;
  reverseEntryOrder?: boolean;
  includeTheme?: boolean;
  includeMaster?: boolean;
  includeLayouts?: boolean;
  embeddedFont?: boolean;
  unknownAliases?: boolean;
  duplicateFontSlugs?: boolean;
  variedUsage?: boolean;
  malformedLayout?: boolean;
  pathTraversalEntry?: boolean;
  unsafeLayoutRelationship?: boolean;
  entityLikeText?: boolean;
  hugeAttributeLength?: number;
  themePaddingLength?: number;
  contentLabel?: string;
  extraShapesPerSlide?: number;
  extraRunsPerSlide?: number;
  distinctFontsPerSlide?: number;
  invalidOoxmlNamespaces?: boolean;
  invalidRelationshipTypeNamespace?: boolean;
  numericOverflow?: boolean;
  unsupportedColorTransform?: boolean;
  alphaDistinctColors?: boolean;
}

interface FixtureEntry {
  name: string;
  data: string | Uint8Array;
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
}

function relationships(values: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PACKAGE_REL_NS}">${values.join('')}</Relationships>`;
}

function themeXml(paddingLength: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<a:theme xmlns:a="${A_NS}" name="Fixture Theme"${paddingLength > 0 ? ` data-pad="${'x'.repeat(paddingLength)}"` : ''}>
  <a:themeElements>
    <a:clrScheme name="Fixture">
      <a:dk1><a:srgbClr val="101010"/></a:dk1>
      <a:lt1><a:srgbClr val="FAFAFA"/></a:lt1>
      <a:dk2><a:srgbClr val="202020"/></a:dk2>
      <a:lt2><a:srgbClr val="EFEFEF"/></a:lt2>
      <a:accent1><a:srgbClr val="112233"/></a:accent1>
      <a:accent2><a:srgbClr val="D45500"/></a:accent2>
      <a:accent3><a:srgbClr val="338855"/></a:accent3>
      <a:accent4><a:srgbClr val="7755AA"/></a:accent4>
      <a:accent5><a:srgbClr val="0099CC"/></a:accent5>
      <a:accent6><a:srgbClr val="CCAA00"/></a:accent6>
      <a:hlink><a:srgbClr val="0000EE"/></a:hlink>
      <a:folHlink><a:srgbClr val="551A8B"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Fixture">
      <a:majorFont><a:latin typeface="Display Sans"/></a:majorFont>
      <a:minorFont><a:latin typeface="Body Sans"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;
}

function masterXml(): string {
  return `<p:sldMaster xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}">
  <p:cSld><p:spTree><p:sp><p:spPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle></p:txStyles>
</p:sldMaster>`;
}

function layoutXml(index: number, malformed: boolean): string {
  const xml = `<p:sldLayout xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}">
  <p:cSld name="Fixture Layout ${index}"><p:spTree><p:sp><p:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr><p:txBody><a:p><a:pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr></a:p></p:txBody></p:sp></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
  return malformed ? xml.replace('</p:sldLayout>', '') : xml;
}

function slideXml(index: number, options: SignatureFixtureOptions): string {
  const variedColor = (0x220000 + index * 257)
    .toString(16)
    .padStart(6, '0')
    .slice(-6)
    .toUpperCase();
  const explicitColor = options.variedUsage ? variedColor : 'ABCDEF';
  const explicitFont = options.variedUsage ? `Usage Font ${index}` : 'Body Sans';
  const explicitSize = options.variedUsage ? 1_000 + index * 100 : 1_200;
  const unknown = options.unknownAliases
    ? `<a:r><a:rPr sz="1000"><a:solidFill><a:schemeClr val="missingScheme"/></a:solidFill><a:latin typeface="+unknown-lt"/></a:rPr><a:t>Unknown alias</a:t></a:r>`
    : '';
  const duplicateSlugs = options.duplicateFontSlugs
    ? `<a:r><a:rPr sz="1400"><a:latin typeface="A/B"/></a:rPr><a:t>Slash</a:t></a:r><a:r><a:rPr sz="1500"><a:latin typeface="A B"/></a:rPr><a:t>Space</a:t></a:r>`
    : '';
  const text = options.entityLikeText
    ? '&xxe; entity-like text remains inert'
    : `${options.contentLabel ?? 'Fixture'} slide ${index}`;
  const hugeAttribute =
    (options.hugeAttributeLength ?? 0) > 0
      ? ` data-huge="${'z'.repeat(options.hugeAttributeLength ?? 0)}"`
      : '';
  const extraShapes = Array.from(
    { length: options.extraShapesPerSlide ?? 0 },
    (_, offset) =>
      `<p:sp><p:spPr><a:solidFill><a:srgbClr val="${(0x330000 + offset).toString(16).padStart(6, '0').toUpperCase()}"/></a:solidFill></p:spPr></p:sp>`,
  ).join('');
  const extraRuns = Array.from(
    { length: options.extraRunsPerSlide ?? 0 },
    (_, offset) =>
      `<a:r><a:rPr sz="1100"><a:latin typeface="Body Sans"/></a:rPr><a:t>Extra ${offset}</a:t></a:r>`,
  ).join('');
  const distinctFonts = Array.from(
    { length: options.distinctFontsPerSlide ?? 0 },
    (_, offset) =>
      `<a:r><a:rPr sz="1200"><a:latin typeface="Bounded Font ${String(offset).padStart(6, '0')}"/></a:rPr><a:t>Bounded</a:t></a:r>`,
  ).join('');
  const unsupportedTransform = options.unsupportedColorTransform
    ? '<p:sp><p:spPr><a:solidFill><a:srgbClr val="654321"><a:hueMod val="50000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>'
    : '';
  const alphaDistinct = options.alphaDistinctColors
    ? '<p:sp><p:spPr><a:solidFill><a:srgbClr val="123456"><a:alpha val="50000"/></a:srgbClr></a:solidFill></p:spPr></p:sp><p:sp><p:spPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:spPr></p:sp>'
    : '';
  return `<p:sld xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}">
  <p:cSld name="Slide ${index}"${hugeAttribute}><p:spTree>
    <p:sp><p:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr><p:txBody><a:p>
      <a:r><a:rPr sz="2400"><a:solidFill><a:srgbClr val="${explicitColor}"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>${text}</a:t></a:r>
      <a:r><a:rPr sz="${explicitSize}"><a:solidFill><a:srgbClr val="445566"/></a:solidFill><a:latin typeface="${explicitFont}"/></a:rPr><a:t>Body</a:t></a:r>
      ${unknown}${duplicateSlugs}${extraRuns}${distinctFonts}
    </a:p></p:txBody></p:sp>
    ${extraShapes}${unsupportedTransform}${alphaDistinct}
  </p:spTree></p:cSld>
</p:sld>`;
}

export async function createSignatureFixture(
  options: SignatureFixtureOptions = {},
): Promise<Uint8Array> {
  const slideCount = options.slideCount ?? 3;
  const layoutCount = options.layoutCount ?? 2;
  const includeTheme = options.includeTheme ?? true;
  const includeMaster = options.includeMaster ?? true;
  const includeLayouts = options.includeLayouts ?? true;
  const slideWidth = options.numericOverflow ? '1.7976931348623157e308' : '12192000';
  const slideHeight = options.numericOverflow ? '1.7976931348623157e308' : '6858000';
  const entries: FixtureEntry[] = [];

  const presentation = `<p:presentation xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}">
    ${includeMaster ? '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>' : ''}
    <p:sldIdLst>${Array.from({ length: slideCount }, (_, offset) => `<p:sldId id="${256 + offset}" r:id="rIdSlide${offset + 1}"/>`).join('')}</p:sldIdLst>
    ${options.embeddedFont ? '<p:embeddedFontLst><p:embeddedFont><p:font typeface="Embedded Sans"/><p:regular r:id="rIdFont"/></p:embeddedFont></p:embeddedFontLst>' : ''}
    <p:sldSz cx="${slideWidth}" cy="${slideHeight}"/>
  </p:presentation>`;
  entries.push({ name: 'ppt/presentation.xml', data: presentation });

  const presentationRelationships = [
    ...(includeMaster
      ? [relationship('rIdMaster', 'slideMaster', 'slideMasters/slideMaster1.xml')]
      : []),
    ...Array.from({ length: slideCount }, (_, offset) =>
      relationship(`rIdSlide${offset + 1}`, 'slide', `slides/slide${offset + 1}.xml`),
    ),
    ...(includeTheme ? [relationship('rIdTheme', 'theme', 'theme/theme1.xml')] : []),
    ...(options.embeddedFont ? [relationship('rIdFont', 'font', 'fonts/font1.odttf')] : []),
  ];
  entries.push({
    name: 'ppt/_rels/presentation.xml.rels',
    data: relationships(presentationRelationships),
  });

  if (includeTheme) {
    entries.push({
      name: 'ppt/theme/theme1.xml',
      data: themeXml(options.themePaddingLength ?? 0),
    });
  }
  if (includeMaster) {
    entries.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: masterXml() });
    entries.push({
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: relationships([
        ...(includeLayouts
          ? Array.from({ length: layoutCount }, (_, offset) =>
              relationship(
                `rIdLayout${offset + 1}`,
                'slideLayout',
                `../slideLayouts/slideLayout${offset + 1}.xml`,
              ),
            )
          : []),
        ...(includeTheme ? [relationship('rIdTheme', 'theme', '../theme/theme1.xml')] : []),
      ]),
    });
  }
  if (includeLayouts) {
    for (let index = 1; index <= layoutCount; index += 1) {
      entries.push({
        name: `ppt/slideLayouts/slideLayout${index}.xml`,
        data: layoutXml(index, Boolean(options.malformedLayout && index === layoutCount)),
      });
      entries.push({
        name: `ppt/slideLayouts/_rels/slideLayout${index}.xml.rels`,
        data: relationships(
          includeMaster
            ? [relationship('rIdMaster', 'slideMaster', '../slideMasters/slideMaster1.xml')]
            : [],
        ),
      });
    }
  }

  for (let index = 1; index <= slideCount; index += 1) {
    const layoutIndex = layoutCount === 2 && index % 3 === 0 ? 2 : 1;
    entries.push({ name: `ppt/slides/slide${index}.xml`, data: slideXml(index, options) });
    entries.push({
      name: `ppt/slides/_rels/slide${index}.xml.rels`,
      data: relationships(
        options.unsafeLayoutRelationship && index === 1
          ? [
              '<Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="https://outside.example.test/layout.xml" TargetMode="External"/>',
            ]
          : [
              relationship(
                'rIdLayout',
                'slideLayout',
                `../slideLayouts/slideLayout${layoutIndex}.xml`,
              ),
            ],
      ),
    });
  }
  if (options.embeddedFont) {
    entries.push({
      name: 'ppt/fonts/font1.odttf',
      data: new Uint8Array([0x46, 0x4f, 0x4e, 0x54, 0xde, 0xad, 0xbe, 0xef]),
    });
  }
  if (options.pathTraversalEntry) {
    entries.push({ name: '../ppt/escape.xml', data: '<escape secret="never expose"/>' });
  }

  const zip = new JSZip();
  const orderedEntries = options.reverseEntryOrder ? [...entries].reverse() : entries;
  for (const entry of orderedEntries) {
    let data = entry.data;
    if (typeof data === 'string' && options.invalidRelationshipTypeNamespace) {
      data = data.replaceAll(`${REL_NS}/`, 'urn:nodeslide:invalid-relationship-type/');
    }
    if (typeof data === 'string' && options.invalidOoxmlNamespaces) {
      data = data
        .replaceAll(P_NS, 'urn:nodeslide:invalid-presentation')
        .replaceAll(A_NS, 'urn:nodeslide:invalid-drawing')
        .replaceAll(REL_NS, 'urn:nodeslide:invalid-office-relationships')
        .replaceAll(PACKAGE_REL_NS, 'urn:nodeslide:invalid-package-relationships');
    }
    zip.file(entry.name, data, { createFolders: false });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createZipWithoutPresentation(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('ppt/theme/theme1.xml', themeXml(0), { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export interface ForgedSizeAggregateFixture {
  bytes: Uint8Array;
  actualOptionalXmlBytes: number;
  forgedEntries: number;
}

export async function createForgedSizeAggregateFixture(
  forgedEntries = 10,
  paddingLength = 1_500,
): Promise<ForgedSizeAggregateFixture> {
  const base = await createSignatureFixture({
    slideCount: 0,
    includeTheme: false,
    includeMaster: false,
    includeLayouts: false,
  });
  const zip = await JSZip.loadAsync(base);
  const payload = themeXml(paddingLength);
  for (let index = 1; index <= forgedEntries; index += 1) {
    zip.file(`ppt/theme/theme${index}.xml`, payload, { createFolders: false });
  }
  const generated = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return {
    bytes: patchDeclaredUncompressedSizes(
      generated,
      (name) => /^ppt\/theme\/theme\d+\.xml$/.test(name),
      1,
    ),
    actualOptionalXmlBytes: new TextEncoder().encode(payload).byteLength * forgedEntries,
    forgedEntries,
  };
}

function patchDeclaredUncompressedSizes(
  bytes: Uint8Array,
  matches: (name: string) => boolean,
  declaredSize: number,
): Uint8Array {
  const patched = bytes.slice();
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  let endOffset = -1;
  for (
    let offset = patched.byteLength - 22;
    offset >= Math.max(0, patched.byteLength - 22 - 0xffff);
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Fixture ZIP has no end-of-central-directory record.');

  const entries = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('Fixture ZIP has a malformed central directory.');
    }
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const fileNameOffset = cursor + 46;
    const name = decoder.decode(patched.subarray(fileNameOffset, fileNameOffset + fileNameLength));
    if (matches(name)) {
      view.setUint32(cursor + 24, declaredSize, true);
      const localOffset = view.getUint32(cursor + 42, true);
      if (view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error('Fixture ZIP has a malformed local header.');
      }
      view.setUint32(localOffset + 22, declaredSize, true);
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return patched;
}
