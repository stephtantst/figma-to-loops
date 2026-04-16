// ---------------------------------------------------------------------------
// code.ts — runs in the Figma sandbox (no browser APIs)
// ---------------------------------------------------------------------------

/// <reference path="../node_modules/@figma/plugin-typings/index.d.ts" />

import type {
  SerializedNode,
  FillInfo,
  TextStyleInfo,
  ImageExport,
  ExportPayload,
  ProgressMessage,
  ErrorMessage,
  FrameInfo,
  FrameListMessage,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
}

function getFontWeight(style: string): number {
  const s = style.toLowerCase();
  if (s.includes('thin')) return 100;
  if (s.includes('extralight') || s.includes('ultra light')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('medium')) return 500;
  if (s.includes('semibold') || s.includes('demi')) return 600;
  if (s.includes('extrabold') || s.includes('ultra bold')) return 800;
  if (s.includes('bold')) return 700;
  if (s.includes('black') || s.includes('heavy')) return 900;
  return 400;
}

// ---------------------------------------------------------------------------
// Determine whether a node should be flattened to a raster image
// ---------------------------------------------------------------------------

function childrenOverlap(children: readonly SceneNode[]): boolean {
  const arr = children as SceneNode[];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i];
      const b = arr[j];
      const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
      const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlapsX && overlapsY) return true;
    }
  }
  return false;
}

function hasBlurEffect(node: SceneNode): boolean {
  if (!('effects' in node)) return false;
  return (node.effects as Effect[]).some(
    (e) => e.visible !== false && (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR'),
  );
}

function hasImageOrGradientFill(node: SceneNode): boolean {
  if (!('fills' in node) || node.fills === figma.mixed) return false;
  return (node.fills as Paint[]).some(
    (f) =>
      f.visible !== false &&
      (f.type === 'IMAGE' ||
        f.type === 'GRADIENT_LINEAR' ||
        f.type === 'GRADIENT_RADIAL' ||
        f.type === 'GRADIENT_ANGULAR' ||
        f.type === 'GRADIENT_DIAMOND'),
  );
}

/**
 * Returns true if this node should be exported as a flat PNG instead of
 * being decomposed into MJML elements.
 * @param depth 0 = root frame, 1 = section, 2+ = content
 */
function shouldRasterize(node: SceneNode, depth: number): boolean {
  // Always rasterize pure vector / shape types
  if (
    node.type === 'VECTOR' ||
    node.type === 'STAR' ||
    node.type === 'POLYGON' ||
    node.type === 'BOOLEAN_OPERATION'
  ) {
    return true;
  }

  // Ellipses (logos etc.)
  if (node.type === 'ELLIPSE') return true;

  // Blur effects
  if (hasBlurEffect(node)) return true;

  // Image or gradient fills at any depth > 0
  if (depth > 0 && hasImageOrGradientFill(node)) return true;

  // Overlapping children at section level → rasterize to avoid z-index issues
  if (
    depth > 0 &&
    'children' in node &&
    (node as FrameNode | GroupNode).children.length > 1 &&
    childrenOverlap((node as FrameNode | GroupNode).children)
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Extract fills and strokes
// ---------------------------------------------------------------------------

function extractFills(node: SceneNode): FillInfo[] {
  if (!('fills' in node) || node.fills === figma.mixed) return [];
  const result: FillInfo[] = [];
  for (const fill of node.fills as Paint[]) {
    if (fill.visible === false) continue;
    if (fill.type === 'SOLID') {
      result.push({
        type: 'SOLID',
        color: rgbToHex(fill.color.r, fill.color.g, fill.color.b),
        opacity: fill.opacity ?? 1,
      });
    } else if (fill.type === 'IMAGE') {
      result.push({ type: 'IMAGE', imageHash: fill.imageHash ?? undefined });
    } else if (fill.type.startsWith('GRADIENT')) {
      result.push({ type: 'GRADIENT' });
    } else {
      result.push({ type: 'OTHER' });
    }
  }
  return result;
}

function extractTextStyle(node: TextNode): TextStyleInfo {
  const fontName = node.fontName === figma.mixed
    ? { family: 'Arial', style: 'Regular' }
    : (node.fontName as FontName);

  const fontSize = node.fontSize === figma.mixed ? 14 : (node.fontSize as number);

  // Color from first visible solid fill
  let color = '#000000';
  if (node.fills !== figma.mixed) {
    const solid = (node.fills as Paint[]).find(
      (f) => f.type === 'SOLID' && f.visible !== false,
    ) as SolidPaint | undefined;
    if (solid) color = rgbToHex(solid.color.r, solid.color.g, solid.color.b);
  }

  // Line height → pixels
  let lineHeight: number | 'AUTO' = 'AUTO';
  if (node.lineHeight !== figma.mixed) {
    const lh = node.lineHeight as LineHeight;
    if (lh.unit === 'PIXELS') lineHeight = lh.value;
    else if (lh.unit === 'PERCENT') lineHeight = (fontSize * lh.value) / 100;
  }

  // Letter spacing → pixels
  let letterSpacing = 0;
  if (node.letterSpacing !== figma.mixed) {
    const ls = node.letterSpacing as LetterSpacing;
    if (ls.unit === 'PIXELS') letterSpacing = ls.value;
    else if (ls.unit === 'PERCENT') letterSpacing = (fontSize * ls.value) / 100;
  }

  const style = fontName.style.toLowerCase();
  const textDecoration = node.textDecoration === figma.mixed
    ? 'NONE'
    : (node.textDecoration as string);

  return {
    fontFamily: fontName.family,
    fontSize,
    fontWeight: getFontWeight(fontName.style),
    color,
    italic: style.includes('italic'),
    underline: textDecoration === 'UNDERLINE',
    lineHeight,
    letterSpacing,
    textAlignHorizontal: (node.textAlignHorizontal as any) ?? 'LEFT',
  };
}

// ---------------------------------------------------------------------------
// Image collection (accumulated during traversal)
// ---------------------------------------------------------------------------

const imageExports: ImageExport[] = [];

async function rasterizeNode(node: SceneNode): Promise<string> {
  const bytes = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: 4 },
  });

  const filename = 'img/' + safeName(node.name) + '_' + node.id.replace(/[^a-z0-9]/gi, '_') + '.png';

  imageExports.push({
    nodeId: node.id,
    name: node.name,
    filename,
    data: Array.from(bytes),
    format: 'PNG',
    width: node.width,
    height: node.height,
  });

  return filename;
}

// ---------------------------------------------------------------------------
// Node serialization
// ---------------------------------------------------------------------------

async function serializeNode(node: SceneNode, depth: number): Promise<SerializedNode | null> {
  // Skip hidden nodes
  if (!node.visible) return null;

  const base: SerializedNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    visible: node.visible,
    opacity: ('opacity' in node ? node.opacity : 1) ?? 1,
    fills: extractFills(node),
  };

  // Strokes
  if ('strokes' in node && node.strokes) {
    const weight = 'strokeWeight' in node
      ? (node.strokeWeight === figma.mixed ? 1 : (node.strokeWeight as number))
      : 1;
    base.strokes = (node.strokes as Paint[])
      .filter((s) => s.type === 'SOLID' && s.visible !== false)
      .map((s) => ({
        color: rgbToHex((s as SolidPaint).color.r, (s as SolidPaint).color.g, (s as SolidPaint).color.b),
        weight,
      }));
    base.strokeWeight = weight;
  }

  // Corner radius
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
    base.cornerRadius = node.cornerRadius;
  }

  // ── TEXT ──────────────────────────────────────────────────────────────────
  if (node.type === 'TEXT') {
    base.characters = node.characters;
    base.textStyle = extractTextStyle(node);
    return base;
  }

  // ── RASTERIZE? ────────────────────────────────────────────────────────────
  if (shouldRasterize(node, depth)) {
    base.isExportedAsImage = true;
    base.exportedImageFilename = await rasterizeNode(node);
    return base;
  }

  // ── CONTAINER (Frame, Group, Component, Instance) ─────────────────────────
  if ('children' in node) {
    const frame = node as FrameNode;

    if ('layoutMode' in frame) {
      base.layoutMode = frame.layoutMode as any;
      base.primaryAxisAlignItems = frame.primaryAxisAlignItems;
      base.counterAxisAlignItems = frame.counterAxisAlignItems;
      base.itemSpacing = frame.itemSpacing;
      base.paddingLeft = frame.paddingLeft;
      base.paddingRight = frame.paddingRight;
      base.paddingTop = frame.paddingTop;
      base.paddingBottom = frame.paddingBottom;
    }

    base.children = [];
    for (const child of frame.children) {
      const serialized = await serializeNode(child, depth + 1);
      if (serialized) base.children.push(serialized);
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

figma.showUI(__html__, { width: 360, height: 520, title: 'Figma to Loops' });

// Any node type that makes sense as an email frame root
const EXPORTABLE_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP', 'SECTION']);

// ---------------------------------------------------------------------------
// Frame scanning helpers
// ---------------------------------------------------------------------------

/** Returns all visible top-level exportable frames on the current page. */
function getPageFrames(): FrameInfo[] {
  return (figma.currentPage.children as SceneNode[])
    .filter((n) => EXPORTABLE_TYPES.has(n.type) && n.visible)
    .map((n) => ({ id: n.id, name: n.name, width: n.width, height: n.height }));
}

/**
 * Walks the selection ancestry upward until we find a direct child of the
 * current page that is an exportable type. Returns null if nothing qualifies.
 * This handles the common case where the user has a text layer or sub-element
 * selected inside a frame rather than the frame itself.
 */
function getSelectedTopLevelFrame(): SceneNode | null {
  const sel = figma.currentPage.selection;
  if (!sel.length) return null;

  let node: (SceneNode | PageNode) | null = sel[0];
  while (node && node.type !== 'PAGE') {
    if (node.parent && node.parent.type === 'PAGE' && EXPORTABLE_TYPES.has(node.type)) {
      return node as SceneNode;
    }
    node = node.parent ?? null;
  }
  return null;
}

/** Broadcasts the full frame list plus the currently-active selection. */
function broadcastFrames(): void {
  try {
    const selected = getSelectedTopLevelFrame();
    const msg: FrameListMessage = {
      type: 'FRAMES_LIST',
      frames: getPageFrames(),
      selectedId: selected ? selected.id : null,
    };
    figma.ui.postMessage(msg);
  } catch (e: any) {
    // Send an empty list so the UI doesn't stay stuck on "Scanning page…"
    figma.ui.postMessage({ type: 'FRAMES_LIST', frames: [], selectedId: null } as FrameListMessage);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function runExport(frameId: string): Promise<void> {
  const node = figma.getNodeById(frameId) as SceneNode | null;

  if (!node) {
    const err: ErrorMessage = { type: 'ERROR', message: 'Frame not found. Please re-select and try again.' };
    figma.ui.postMessage(err);
    return;
  }

  try {
    figma.ui.postMessage({ type: 'PROGRESS', message: 'Analyzing frame\u2026' } as ProgressMessage);

    // Clear previous image exports
    imageExports.length = 0;

    const serialized = await serializeNode(node, 0);
    if (!serialized) {
      const err: ErrorMessage = { type: 'ERROR', message: 'Failed to serialize the frame.' };
      figma.ui.postMessage(err);
      return;
    }

    figma.ui.postMessage({ type: 'PROGRESS', message: 'Exporting ' + imageExports.length + ' image(s)\u2026' } as ProgressMessage);

    const payload: ExportPayload = {
      type: 'EXPORT_DATA',
      frameName: node.name,
      frameWidth: node.width,
      frame: serialized,
      images: imageExports.slice(),
    };

    figma.ui.postMessage(payload);
  } catch (e: any) {
    const err: ErrorMessage = { type: 'ERROR', message: (e && e.message) ? e.message : String(e) };
    figma.ui.postMessage(err);
  }
}

// Register the message handler FIRST — before any figma.on() calls that
// might throw, so the UI can always reach code.ts.
figma.ui.onmessage = function(msg) {
  if (msg.type === 'GET_FRAMES') {
    broadcastFrames();
    return;
  }

  if (msg.type === 'FIND_NODE') {
    const node = figma.getNodeById(msg.nodeId);
    if (!node) {
      figma.ui.postMessage({ type: 'ERROR', message: 'Node not found — make sure the link is from this file.' } as ErrorMessage);
      return;
    }
    if (!EXPORTABLE_TYPES.has(node.type)) {
      figma.ui.postMessage({ type: 'ERROR', message: 'That node is a ' + node.type + '. Link to a frame instead.' } as ErrorMessage);
      return;
    }

    // Walk up to find the page that owns this node, then switch to it
    let ancestor: (BaseNode) | null = node;
    while (ancestor && ancestor.type !== 'PAGE') {
      ancestor = ancestor.parent;
    }
    if (ancestor && ancestor.type === 'PAGE') {
      figma.currentPage = ancestor as PageNode;
    }

    // Select the node and scroll it into view
    figma.currentPage.selection = [node as SceneNode];
    figma.viewport.scrollAndZoomIntoView([node as SceneNode]);

    // Broadcast the refreshed frame list — the new selection will be highlighted
    broadcastFrames();
    return;
  }

  if (msg.type === 'EXPORT_FRAME') {
    if (!msg.frameId) {
      figma.ui.postMessage({ type: 'ERROR', message: 'No frame selected.' } as ErrorMessage);
      return;
    }
    runExport(msg.frameId);
  }
};

// Re-broadcast whenever the user changes the selection.
// currentpagechange is wrapped in try/catch because older Figma builds
// may not support the event and would otherwise crash the plugin.
figma.on('selectionchange', broadcastFrames);
try {
  figma.on('currentpagechange' as any, broadcastFrames);
} catch (_) {
  // not supported in this Figma version — silently skip
}
