import { describe, expect, it } from 'vitest';
import {
  blankSlide,
  isolatedSlide,
  knockoutSlide,
  ownershipSet,
  topLevelShapes,
} from '../lib/knockout-surgery.mjs';

/**
 * The verifier must carve the three decks out of the producer's baseline itself. These prove the
 * carving is right — and, above all, that a flattened duplicate is NOT swept into the chart's
 * ownership set, because that separation is the whole reason the knockout render can expose it.
 */

// A slide with: a real native chart (graphicFrame id 5), a flattened shape-drawn duplicate of it
// (id 6, a plain sp), a title (id 90), and a diagram elsewhere is out of scope here.
const CHART = `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/>`;
const slide = `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="90" name="Title 1"/></p:nvSpPr><a:t>A title</a:t></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="chart 5"/></p:nvGraphicFramePr><a:graphic><a:graphicData>${CHART}</a:graphicData></a:graphic></p:graphicFrame><p:sp><p:nvSpPr><p:cNvPr id="6" name="fake-bar-0"/></p:nvSpPr><p:spPr><a:solidFill/></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`;

describe('discovering the native ownership set', () => {
  it('sees the chart graphicFrame and NOT the flattened duplicate sp', () => {
    const { shapes } = topLevelShapes(slide);
    expect(shapes.map((s) => s.id)).toEqual(['90', '5', '6']);
    const chart = shapes.find((s) => s.id === '5');
    const fake = shapes.find((s) => s.id === '6');
    expect(chart.isChart).toBe(true);
    expect(fake.isChart).toBe(false); // the whole point — a duplicate drawn as sp is not a chart
    expect(ownershipSet(shapes, 'chart')).toEqual(['5']);
  });

  it('binds a diagram to its connectors and the shapes they join', () => {
    const diagram =
      '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="node-a"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="node-b"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="9" name="decorative"/></p:nvSpPr></p:sp><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="edge"/></p:nvCxnSpPr><p:spPr><a:stCxn id="2"/><a:endCxn id="3"/></p:spPr></p:cxnSp></p:spTree></p:cSld></p:sld>';
    const { shapes } = topLevelShapes(diagram);
    // owns the connector (4) and the two bound nodes (2,3), but not the decorative shape (9)
    expect(ownershipSet(shapes, 'diagram').sort()).toEqual(['2', '3', '4']);
  });
});

describe('carving the three decks — the verifier, not the producer', () => {
  const owned = ownershipSet(topLevelShapes(slide).shapes, 'chart'); // ['5']

  it('knockout removes the native chart and LEAVES the flattened duplicate', () => {
    const B = knockoutSlide(slide, owned);
    expect(B).not.toContain('id="5"'); // chart gone
    expect(B).toContain('id="6"'); // duplicate remains — this is what makes causal mask ~empty
    expect(B).toContain('id="90"'); // title untouched
    expect(topLevelShapes(B).shapes.map((s) => s.id)).toEqual(['90', '6']);
  });

  it('isolated keeps ONLY the native chart', () => {
    const C = isolatedSlide(slide, owned);
    expect(C).toContain('id="5"');
    expect(C).not.toContain('id="6"');
    expect(C).not.toContain('id="90"');
    expect(topLevelShapes(C).shapes.map((s) => s.id)).toEqual(['5']);
  });

  it('blank removes every content shape', () => {
    expect(topLevelShapes(blankSlide(slide)).shapes).toEqual([]);
  });

  it('leaves the spTree scaffold intact so the slide still renders', () => {
    for (const variant of [
      knockoutSlide(slide, owned),
      isolatedSlide(slide, owned),
      blankSlide(slide),
    ]) {
      expect(variant).toContain('<p:spTree>');
      expect(variant).toContain('<p:nvGrpSpPr/>');
      expect(variant).toContain('</p:sld>');
    }
  });
});

describe('honesty about what it cannot carve', () => {
  it('flags a grouped slide rather than silently mis-carving it', () => {
    const grouped = `<p:sld><p:cSld><p:spTree><p:grpSp><p:cNvPr id="1"/></p:grpSp></p:spTree></p:cSld></p:sld>`;
    expect(topLevelShapes(grouped).hasGroups).toBe(true);
  });

  it('returns an empty ownership set for an unknown kind rather than guessing', () => {
    expect(ownershipSet(topLevelShapes(slide).shapes, 'screenshot')).toEqual([]);
  });
});
