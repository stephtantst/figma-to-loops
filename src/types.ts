// ---------------------------------------------------------------------------
// Shared types between code.ts (Figma sandbox) and ui.ts (browser context)
// ---------------------------------------------------------------------------

export type TextAlignHorizontal = 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';

export interface TextStyleInfo {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;       // hex e.g. "#333333"
  italic: boolean;
  underline: boolean;
  lineHeight: number | 'AUTO';   // pixel value or AUTO
  letterSpacing: number;          // pixels
  textAlignHorizontal: TextAlignHorizontal;
}

export interface FillInfo {
  type: 'SOLID' | 'IMAGE' | 'GRADIENT' | 'OTHER';
  color?: string;      // hex, for SOLID fills
  imageHash?: string;  // for IMAGE fills
  opacity?: number;    // 0–1
}

export interface StrokeInfo {
  color: string;
  weight: number;
}

export interface SerializedNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  opacity: number;

  // Children (Frame, Group, Component, Instance)
  children?: SerializedNode[];

  // Text
  characters?: string;
  textStyle?: TextStyleInfo;

  // Fills / strokes
  fills?: FillInfo[];
  strokes?: StrokeInfo[];
  strokeWeight?: number;

  // Auto-layout (Frame only)
  layoutMode?: LayoutMode;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;

  // Corners
  cornerRadius?: number;

  // Link on a frame (prototype interaction)
  linkUrl?: string;

  // Export metadata set by code.ts when this node is rendered as a raster image
  isExportedAsImage?: boolean;
  exportedImageFilename?: string; // e.g. "images/hero_123.png"
}

// ---------------------------------------------------------------------------
// Messages sent from code.ts → ui.ts
// ---------------------------------------------------------------------------

export interface ExportPayload {
  type: 'EXPORT_DATA';
  frameName: string;
  frameWidth: number;
  frame: SerializedNode;
  images: ImageExport[];
}

export interface ProgressMessage {
  type: 'PROGRESS';
  message: string;
}

export interface ErrorMessage {
  type: 'ERROR';
  message: string;
}

// A single frame entry in the page frame list
export interface FrameInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

// Message sent from code.ts → ui.ts: full list of top-level frames + which one
// is currently active in the Figma canvas selection
export interface FrameListMessage {
  type: 'FRAMES_LIST';
  frames: FrameInfo[];
  selectedId: string | null;
}

// Messages sent from ui.ts → code.ts
export interface StartExportMessage {
  type: 'EXPORT_FRAME';
  frameId: string;
}

export interface FindNodeMessage {
  type: 'FIND_NODE';
  nodeId: string; // Figma API format: "1234:567"
}

// ---------------------------------------------------------------------------
// Image export record
// ---------------------------------------------------------------------------

export interface ImageExport {
  nodeId: string;
  name: string;
  filename: string;     // relative path used in MJML, e.g. "images/hero.png"
  data: number[];       // Uint8Array serialized as plain number[] for postMessage
  format: 'PNG' | 'JPG';
  width: number;
  height: number;
}
