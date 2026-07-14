import JSZip from 'jszip';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${OR}/${type}" Target="${target}"/>`;
}

function relationships(...items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}">${items.join('')}</Relationships>`;
}

function textShape(input: {
  id: number;
  name: string;
  text: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  placeholder?: string;
}): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${input.id}" name="${input.name}"/><p:cNvSpPr/><p:nvPr>${
    input.placeholder ? `<p:ph type="${input.placeholder}"/>` : ''
  }</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${input.x}" y="${input.y}"/><a:ext cx="${input.cx}" cy="${input.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>${input.text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function slideDocument(contents: string, background = ''): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}" xmlns:c="${C}" xmlns:m="${M}"><p:cSld>${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${contents}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function createPptxImportFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rIdSlide2"/><p:sldId id="257" r:id="rIdSlide1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    relationships(
      relationship('rIdSlide1', 'slide', 'slides/slide1.xml'),
      relationship('rIdSlide2', 'slide', 'slides/slide2.xml'),
      relationship('rIdTheme', 'theme', 'theme/theme1.xml'),
    ),
  );
  zip.file(
    'ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="${A}" name="Fixture Theme"><a:themeElements><a:clrScheme name="Fixture"><a:dk1><a:srgbClr val="172033"/></a:dk1><a:lt1><a:srgbClr val="F8FAFC"/></a:lt1><a:dk2><a:srgbClr val="475569"/></a:dk2><a:lt2><a:srgbClr val="E2E8F0"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="7C3AED"/></a:accent2><a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="0891B2"/></a:accent4><a:accent5><a:srgbClr val="EA580C"/></a:accent5><a:accent6><a:srgbClr val="DB2777"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Fixture"/></a:themeElements></a:theme>`,
  );

  zip.file(
    'ppt/slides/slide2.xml',
    slideDocument(
      textShape({
        id: 2,
        name: 'deck:roundtrip:second-title',
        text: 'Second slide comes first',
        x: 914400,
        y: 685800,
        cx: 7315200,
        cy: 914400,
        placeholder: 'title',
      }),
    ),
  );
  zip.file('ppt/slides/_rels/slide2.xml.rels', relationships());

  const directBackground = `<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  const detailedSlide = [
    textShape({
      id: 2,
      name: 'deck:roundtrip:title',
      text: 'Detailed fixture',
      x: 914400,
      y: 457200,
      cx: 7315200,
      cy: 685800,
      placeholder: 'title',
    }),
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="deck:roundtrip:shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="3657600" cy="1828800"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="172033"/></a:solidFill></a:ln></p:spPr></p:sp>`,
    textShape({
      id: 4,
      name: 'deck:roundtrip:shape:text',
      text: 'Merged shape copy',
      x: 914400,
      y: 1600200,
      cx: 3657600,
      cy: 1828800,
    }),
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="deck:roundtrip:connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="4572000" y="2514600"/><a:ext cx="1828800" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="25400"><a:solidFill><a:srgbClr val="172033"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`,
    `<p:pic><p:nvPicPr><p:cNvPr id="6" name="deck:roundtrip:image" descr="One pixel fixture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/><a:srcRect l="1000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="6858000" y="1600200"/><a:ext cx="1828800" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="deck:roundtrip:chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="4114800"/><a:ext cx="5486400" cy="2286000"/></p:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>`,
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="Unsupported Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>${textShape({ id: 9, name: 'Grouped child', text: 'Do not detach', x: 0, y: 0, cx: 100, cy: 100 })}</p:grpSp>`,
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="SmartArt 10"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><a:relIds/></a:graphicData></a:graphic></p:graphicFrame>`,
    `<p:sp><p:nvSpPr><p:cNvPr id="11" name="Equation 11"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></a:p></p:txBody></p:sp>`,
  ].join('');
  zip.file(
    'ppt/slides/slide1.xml',
    slideDocument(detailedSlide, directBackground).replace(
      '</p:sld>',
      '<p:timing><p:tnLst/></p:timing></p:sld>',
    ),
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    relationships(
      relationship('rIdImage', 'image', '../media/image1.png'),
      relationship('rIdChart', 'chart', '../charts/chart1.xml'),
      relationship('rIdNotes', 'notesSlide', '../notesSlides/notesSlide1.xml'),
      relationship('rIdVideo', 'video', '../media/video1.mp4'),
    ),
  );
  zip.file('ppt/media/image1.png', ONE_PIXEL_PNG, { base64: true });
  zip.file('ppt/media/video1.mp4', new Uint8Array([0, 1, 2, 3]));
  zip.file(
    'ppt/charts/chart1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>18</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${textShape({ id: 2, name: 'Notes body', text: 'Private speaker note', x: 0, y: 0, cx: 100, cy: 100, placeholder: 'body' })}${textShape({ id: 3, name: 'Slide number', text: '2', x: 0, y: 0, cx: 100, cy: 100, placeholder: 'sldNum' })}</p:spTree></p:cSld></p:notes>`,
  );
  zip.file('ppt/vbaProject.bin', new Uint8Array([1, 2, 3]));
  zip.file(
    'docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture deck title</dc:title></cp:coreProperties>',
  );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
