import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Writes a PowerPoint file (`.pptx`, Office Open XML) in which every slide is one picture (#266). The package holds
 * what PowerPoint and Keynote expect of a presentation and nothing else: one blank layout, one master, the Office
 * theme, and a notes page for each slide that has speaker notes.
 */
export interface PptxSlide {
  /** The name of the slide; it becomes the name and the alternative text of the picture. */
  name: string;
  png: Uint8Array;
  /** Size of the picture in any unit; only the proportion counts. */
  width: number;
  height: number;
  /** Speaker notes, empty for none. Line breaks separate paragraphs. */
  notes: string;
}

export interface PptxOptions {
  title: string;
  /** Language of the notes, e.g. `de-DE`. */
  language: string;
  /** Written into the file as the time of creation, and as the time of every entry of the package. */
  created: Date;
}

/** English Metric Units: 914 400 to the inch. PowerPoint accepts slide edges between 1 and 56 inches. */
const EMU_LONG_EDGE = 12_192_000;
const EMU_MIN_EDGE = 914_400;

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE = 'application/vnd.openxmlformats-officedocument';
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const COLOR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

/** XML 1.0 allows tab, line feed and carriage return below U+0020 and no lone surrogates; everything else is dropped. */
function escapeXml(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function relationships(entries: ReadonlyArray<readonly [type: string, target: string]>): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([type, target], index) => `<Relationship Id="rId${index + 1}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`;
}

/** The slide takes the proportion of the first picture, so a deck of equal frames fills every slide. */
export function pptxSlideSize(width: number, height: number): { cx: number; cy: number } {
  const ratio = Number.isFinite(width / height) && width > 0 && height > 0 ? width / height : 16 / 9;
  const cx = ratio >= 1 ? EMU_LONG_EDGE : Math.max(EMU_MIN_EDGE, Math.round(EMU_LONG_EDGE * ratio));
  const cy = ratio >= 1 ? Math.max(EMU_MIN_EDGE, Math.round(EMU_LONG_EDGE / ratio)) : EMU_LONG_EDGE;
  return { cx, cy };
}

/** Where a picture of another proportion sits: as large as the slide allows, in its middle. */
function placed(slide: { cx: number; cy: number }, width: number, height: number): { x: number; y: number; cx: number; cy: number } {
  const usable = width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height);
  const scale = usable ? Math.min(slide.cx / width, slide.cy / height) : 0;
  const cx = usable ? Math.max(1, Math.round(width * scale)) : slide.cx;
  const cy = usable ? Math.max(1, Math.round(height * scale)) : slide.cy;
  return { x: Math.round((slide.cx - cx) / 2), y: Math.round((slide.cy - cy) / 2), cx, cy };
}

function theme(name: string): string {
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (width: number) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const font = (latin: string) => `<a:latin typeface="${latin}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements>`
    + '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
    + `<a:fontScheme name="Office"><a:majorFont>${font('Calibri Light')}</a:majorFont><a:minorFont>${font('Calibri')}</a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Office"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme>`
    + '</a:themeElements></a:theme>';
}

function notesMaster(): string {
  const placeholder = (id: number, name: string, type: string, extra: string, y: number, height: number, body: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"${type === 'sldImg' ? ' noRot="1" noChangeAspect="1"' : ''}/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${extra} idx="${id}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="5486400" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${type === 'sldImg' ? '<a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln>' : ''}</p:spPr>${body}</p:sp>`;
  return `${XML}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}`
    + placeholder(2, 'Slide Image Placeholder 1', 'sldImg', '', 1_143_000, 3_086_100, '')
    + placeholder(3, 'Notes Placeholder 2', 'body', ' sz="quarter"', 4_400_550, 3_600_450, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:endParaRPr/></a:p></p:txBody>')
    + `</p:spTree></p:cSld>${COLOR_MAP}<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}

function notesSlide(notes: string, language: string): string {
  const paragraphs = notes.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => (line ? `<a:p><a:r><a:rPr lang="${escapeXml(language)}" dirty="0"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr/></a:p>')).join('');
  return `${XML}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}

/** The package as bytes. Throws for a deck without slides: PowerPoint opens such a file, but there is nothing to show. */
export function buildPptx(slides: readonly PptxSlide[], options: PptxOptions): Uint8Array {
  if (!slides.length) throw new Error('A presentation needs at least one slide.');
  const size = pptxSlideSize(slides[0]!.width, slides[0]!.height);
  const withNotes = slides.some((slide) => slide.notes.trim());
  const files: Zippable = {};
  const text = (path: string, contents: string): void => { files[path] = strToU8(contents); };
  const stamp = options.created.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const overrides: Array<[part: string, type: string]> = [
    ['/ppt/presentation.xml', `${TYPE}.presentationml.presentation.main+xml`],
    ['/ppt/slideMasters/slideMaster1.xml', `${TYPE}.presentationml.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${TYPE}.presentationml.slideLayout+xml`],
    ['/ppt/theme/theme1.xml', `${TYPE}.theme+xml`],
    ['/ppt/presProps.xml', `${TYPE}.presentationml.presProps+xml`],
    ['/ppt/viewProps.xml', `${TYPE}.presentationml.viewProps+xml`],
    ['/ppt/tableStyles.xml', `${TYPE}.presentationml.tableStyles+xml`],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', `${TYPE}.extended-properties+xml`],
  ];

  text('_rels/.rels', relationships([['officeDocument', 'ppt/presentation.xml'], ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['extended-properties', 'docProps/app.xml']]));
  text('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(options.title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`);
  text('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Sketchdraw</Application><Slides>${slides.length}</Slides><Notes>${slides.filter((slide) => slide.notes.trim()).length}</Notes></Properties>`);

  // The relationships of the presentation, in the order their ids are used below.
  const parts: Array<readonly [string, string]> = [['slideMaster', 'slideMasters/slideMaster1.xml'], ['presProps', 'presProps.xml'], ['viewProps', 'viewProps.xml'], ['theme', 'theme/theme1.xml'], ['tableStyles', 'tableStyles.xml']];
  if (withNotes) parts.push(['notesMaster', 'notesMasters/notesMaster1.xml']);
  const notesMasterId = parts.length;
  const firstSlideId = parts.length + 1;
  slides.forEach((_, index) => parts.push(['slide', `slides/slide${index + 1}.xml`]));
  text('ppt/_rels/presentation.xml.rels', relationships(parts));
  text('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + (withNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId${notesMasterId}"/></p:notesMasterIdLst>` : '')
    + `<p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${firstSlideId + index}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  text('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`);
  text('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}/>`);
  text('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BB5E4BF5F6}"/>`);
  text('ppt/theme/theme1.xml', theme('Sketchdraw'));

  text('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>${COLOR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  text('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['theme', '../theme/theme1.xml']]));
  text('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  text('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([['slideMaster', '../slideMasters/slideMaster1.xml']]));

  if (withNotes) {
    overrides.push(['/ppt/notesMasters/notesMaster1.xml', `${TYPE}.presentationml.notesMaster+xml`], ['/ppt/theme/theme2.xml', `${TYPE}.theme+xml`]);
    text('ppt/notesMasters/notesMaster1.xml', notesMaster());
    text('ppt/notesMasters/_rels/notesMaster1.xml.rels', relationships([['theme', '../theme/theme2.xml']]));
    text('ppt/theme/theme2.xml', theme('Sketchdraw Notes'));
  }

  slides.forEach((slide, index) => {
    const number = index + 1;
    const at = placed(size, slide.width, slide.height);
    const name = escapeXml(slide.name);
    const rels: Array<readonly [string, string]> = [['slideLayout', '../slideLayouts/slideLayout1.xml'], ['image', `../media/image${number}.png`]];
    if (slide.notes.trim()) {
      rels.push(['notesSlide', `../notesSlides/notesSlide${number}.xml`]);
      overrides.push([`/ppt/notesSlides/notesSlide${number}.xml`, `${TYPE}.presentationml.notesSlide+xml`]);
      text(`ppt/notesSlides/notesSlide${number}.xml`, notesSlide(slide.notes, options.language));
      text(`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`, relationships([['notesMaster', '../notesMasters/notesMaster1.xml'], ['slide', `../slides/slide${number}.xml`]]));
    }
    overrides.push([`/ppt/slides/slide${number}.xml`, `${TYPE}.presentationml.slide+xml`]);
    text(`ppt/slides/slide${number}.xml`, `${XML}<p:sld ${NS}><p:cSld name="${name}"><p:spTree>${GROUP}<p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}" descr="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${at.x}" y="${at.y}"/><a:ext cx="${at.cx}" cy="${at.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    text(`ppt/slides/_rels/slide${number}.xml.rels`, relationships(rels));
    // A PNG is compressed already; storing it keeps the export fast.
    files[`ppt/media/image${number}.png`] = [slide.png, { level: 0 }];
  });

  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`;
  // The content types come first in the package, as Office writes them.
  return zipSync({ '[Content_Types].xml': strToU8(contentTypes), ...files }, { level: 6, mtime: options.created });
}

/** The bytes as base64, in pieces: one call with a large file would exceed the argument limit of the engine. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
