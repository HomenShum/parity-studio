import type { NormalizedPresentationElement, NormalizedPresentationSlide } from '../syncContracts';

export interface GoogleDimension {
  magnitude?: number;
  unit?: 'EMU' | 'PT' | 'PX' | 'UNIT_UNSPECIFIED' | string;
}

export interface GoogleSize {
  width?: GoogleDimension;
  height?: GoogleDimension;
}

export interface GoogleAffineTransform {
  scaleX?: number;
  scaleY?: number;
  shearX?: number;
  shearY?: number;
  translateX?: number;
  translateY?: number;
  unit?: 'EMU' | 'PT' | 'PX' | 'UNIT_UNSPECIFIED' | string;
}

export interface GoogleRgbColor {
  red?: number;
  green?: number;
  blue?: number;
}

export interface GoogleOpaqueColor {
  rgbColor?: GoogleRgbColor;
  themeColor?: string;
}

export interface GoogleOptionalColor {
  opaqueColor?: GoogleOpaqueColor;
}

export interface GoogleSolidFill {
  color?: GoogleOpaqueColor;
  alpha?: number;
}

export interface GoogleTextStyle {
  foregroundColor?: GoogleOptionalColor;
  backgroundColor?: GoogleOptionalColor;
  fontFamily?: string;
  fontSize?: GoogleDimension;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface GoogleParagraphStyle {
  alignment?: 'START' | 'CENTER' | 'END' | 'JUSTIFIED' | string;
}

export interface GoogleTextElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: { content?: string; style?: GoogleTextStyle };
  paragraphMarker?: { style?: GoogleParagraphStyle };
}

export interface GoogleShape {
  shapeType?: string;
  text?: { textElements?: GoogleTextElement[] };
  shapeProperties?: {
    shapeBackgroundFill?: { solidFill?: GoogleSolidFill };
    outline?: { outlineFill?: { solidFill?: GoogleSolidFill }; weight?: GoogleDimension };
  };
  placeholder?: { type?: string; index?: number };
}

export interface GoogleImage {
  contentUrl?: string;
  sourceUrl?: string;
  imageProperties?: unknown;
}

export interface GoogleVideo {
  url?: string;
  source?: string;
  id?: string;
}

export interface GooglePageElement {
  objectId?: string;
  size?: GoogleSize;
  transform?: GoogleAffineTransform;
  title?: string;
  description?: string;
  elementGroup?: { children?: GooglePageElement[] };
  shape?: GoogleShape;
  image?: GoogleImage;
  video?: GoogleVideo;
  line?: Record<string, unknown>;
  table?: Record<string, unknown>;
  wordArt?: { renderedText?: string };
  sheetsChart?: Record<string, unknown>;
  speakerSpotlight?: Record<string, unknown>;
}

export interface GooglePage {
  objectId?: string;
  pageType?: string;
  pageElements?: GooglePageElement[];
  pageProperties?: {
    pageBackgroundFill?: { solidFill?: GoogleSolidFill };
  };
  slideProperties?: {
    layoutObjectId?: string;
    masterObjectId?: string;
    notesPage?: GooglePage;
    isSkipped?: boolean;
  };
  notesProperties?: { speakerNotesObjectId?: string };
}

export interface GoogleSlidesPresentation {
  presentationId?: string;
  pageSize?: GoogleSize;
  slides?: GooglePage[];
  title?: string;
  masters?: GooglePage[];
  layouts?: GooglePage[];
  locale?: string;
  revisionId?: string;
  notesMaster?: GooglePage;
}

export interface GoogleSlidesNormalizationContext {
  presentation: GoogleSlidesPresentation;
  slide: GooglePage;
  slideIndex: number;
}

export interface GoogleSlidesElementNormalizationContext extends GoogleSlidesNormalizationContext {
  element: GooglePageElement;
  elementIndex: number;
}

export interface GoogleSlidesNormalizationHooks {
  normalizeSlideTitle?: (context: GoogleSlidesNormalizationContext, defaultTitle: string) => string;
  normalizeSpeakerNotes?: (
    context: GoogleSlidesNormalizationContext,
    defaultNotes: string | undefined,
  ) => string | undefined;
  normalizeSlide?: (
    context: GoogleSlidesNormalizationContext,
    normalized: NormalizedPresentationSlide,
  ) => NormalizedPresentationSlide;
  normalizeElement?: (
    context: GoogleSlidesElementNormalizationContext,
    normalized: NormalizedPresentationElement,
  ) => NormalizedPresentationElement | null;
}

export type GoogleSlidesRequest =
  | { createSlide: { objectId: string; insertionIndex: number } }
  | {
      createShape: {
        objectId: string;
        shapeType: string;
        elementProperties: GooglePageElementProperties;
      };
    }
  | {
      createImage: {
        objectId: string;
        url: string;
        elementProperties: GooglePageElementProperties;
      };
    }
  | { deleteObject: { objectId: string } }
  | { deleteText: { objectId: string; textRange: { type: 'ALL' } } }
  | { insertText: { objectId: string; insertionIndex: number; text: string } }
  | {
      updatePageElementTransform: {
        objectId: string;
        transform: Required<GoogleAffineTransform>;
        applyMode: 'ABSOLUTE';
      };
    }
  | { updateSlidesPosition: { slideObjectIds: string[]; insertionIndex: number } }
  | {
      updateTextStyle: {
        objectId: string;
        style: GoogleTextStyle;
        textRange: { type: 'ALL' };
        fields: string;
      };
    }
  | {
      updatePageElementAltText: { objectId: string; title?: string; description?: string };
    }
  | { replaceImage: { imageObjectId: string; url: string; imageReplaceMethod: 'CENTER_CROP' } }
  | {
      updatePageProperties: {
        objectId: string;
        pageProperties: { pageBackgroundFill: { solidFill: GoogleSolidFill } };
        fields: 'pageBackgroundFill';
      };
    };

export interface GooglePageElementProperties {
  pageObjectId: string;
  size: Required<GoogleSize>;
  transform: Required<GoogleAffineTransform>;
}

export interface GoogleSlidesBatchUpdateBody {
  requests: GoogleSlidesRequest[];
  writeControl: { requiredRevisionId: string };
}

export interface GoogleSlidesBatchUpdateResponse {
  presentationId?: string;
  replies?: unknown[];
  writeControl?: { requiredRevisionId?: string };
}

export interface GoogleSlidesBatchUpdatePlan {
  kind: 'google_slides_batch_update';
  provider: 'google_slides';
  presentationId: string;
  requiredRevisionId?: string;
  requests: GoogleSlidesRequest[];
  body?: GoogleSlidesBatchUpdateBody;
  blocked: boolean;
  blockedReasons: string[];
}

export interface GoogleSlidesHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type GoogleSlidesFetch = (
  input: string,
  init?: RequestInit,
) => Promise<GoogleSlidesHttpResponse>;

export type GoogleSlidesAuth = () => Promise<Record<string, string>> | Record<string, string>;
