// ---------------------------------------------------------------------------
// mjml-generator.ts — converts a serialized Figma node tree into MJML markup
// ---------------------------------------------------------------------------

import type { SerializedNode, FillInfo } from './types';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function solidColor(fills: FillInfo[] | undefined): string | null {
  const f = fills?.find((f) => f.type === 'SOLID' && f.color);
  return f?.color ?? null;
}

function attr(key: string, value: string | number | undefined | null): string {
  if (value === null || value === undefined || value === '') return '';
  return ` ${key}="${value}"`;
}

function px(n: number | undefined): string {
  return n !== undefined ? `${Math.round(n)}px` : '0px';
}

function mjmlTextAlign(align: string | undefined): string {
  switch (align) {
    case 'CENTER': return 'center';
    case 'RIGHT': return 'right';
    case 'JUSTIFIED': return 'justify';
    default: return 'left';
  }
}

// ---------------------------------------------------------------------------
// Node classification helpers
// ---------------------------------------------------------------------------

/**
 * A button is a small rounded frame containing a single text child with a
 * solid background fill.
 */
function isButton(node: SerializedNode): boolean {
  if (node.type !== 'FRAME' && node.type !== 'INSTANCE' && node.type !== 'COMPONENT') return false;
  const hasBg = solidColor(node.fills) !== null;
  const hasRound = (node.cornerRadius ?? 0) >= 4;
  const hasText = node.children?.some((c) => c.type === 'TEXT') ?? false;
  const isSmall = node.height < 80;
  return hasBg && hasRound && hasText && isSmall;
}

/**
 * A divider is a very thin rectangle relative to its width.
 */
function isDivider(node: SerializedNode): boolean {
  if (node.type !== 'RECTANGLE') return false;
  return node.height <= 4 && node.width > 40;
}

/**
 * Returns true when a container's direct children are arranged horizontally
 * (auto-layout HORIZONTAL, or positionally side-by-side).
 */
function isHorizontal(node: SerializedNode): boolean {
  if (node.layoutMode === 'HORIZONTAL') return true;
  if (node.layoutMode === 'VERTICAL') return false;

  // Infer from positions: children at roughly the same Y → horizontal
  const kids = node.children;
  if (!kids || kids.length < 2) return false;
  const avgY = kids.reduce((s, c) => s + c.y, 0) / kids.length;
  return kids.every((c) => Math.abs(c.y - avgY) < node.height * 0.4);
}

// ---------------------------------------------------------------------------
// Element generators
// ---------------------------------------------------------------------------

function genTextEl(node: SerializedNode): string {
  const s = node.textStyle;
  if (!s) return '';

  const fontStack = `${escapeXml(s.fontFamily)}, Arial, sans-serif`;
  const lh = typeof s.lineHeight === 'number' ? px(s.lineHeight) : '1.5';

  const attrs = [
    `font-family="${fontStack}"`,
    `font-size="${px(s.fontSize)}"`,
    `color="${s.color}"`,
    `align="${mjmlTextAlign(s.textAlignHorizontal)}"`,
    `line-height="${lh}"`,
    s.fontWeight !== 400 ? `font-weight="${s.fontWeight}"` : '',
    s.italic ? `font-style="italic"` : '',
    s.letterSpacing !== 0 ? `letter-spacing="${s.letterSpacing}px"` : '',
  ].filter(Boolean).join(' ');

  const content = escapeXml(node.characters ?? '');
  const inner = s.underline ? `<u>${content}</u>` : content;

  return `<mj-text ${attrs}>${inner}</mj-text>`;
}

function genImageEl(node: SerializedNode, maxWidth: number): string {
  const src = node.exportedImageFilename ?? ('img/' + node.name + '.png');
  const w = Math.min(Math.round(node.width), maxWidth);
  return `<mj-image src="${src}"${attr('width', px(w))}${attr('alt', escapeXml(node.name))} padding="0" />`;
}

function genButtonEl(node: SerializedNode): string {
  const bg = solidColor(node.fills) ?? '#000000';
  const textNode = node.children?.find((c) => c.type === 'TEXT');
  const label = textNode?.characters ?? 'Click Here';
  const textColor = textNode?.textStyle?.color ?? '#ffffff';
  const radius = px(node.cornerRadius ?? 4);
  const pv = px((node.paddingTop ?? 12));
  const ph = px((node.paddingLeft ?? 24));

  return `<mj-button background-color="${bg}" color="${textColor}" border-radius="${radius}" inner-padding="${pv} ${ph}" href="#">${escapeXml(label)}</mj-button>`;
}

function genDividerEl(node: SerializedNode): string {
  const fillColor = solidColor(node.fills);
  const strokeColor = node.strokes?.[0]?.color ?? null;
  const color = fillColor ?? strokeColor ?? '#e0e0e0';
  return `<mj-divider border-color="${color}" border-width="${px(node.height)}" padding="0" />`;
}

function genSpacerEl(h: number): string {
  return `<mj-spacer height="${px(h)}" />`;
}

// ---------------------------------------------------------------------------
// Column content — recursively turns leaf nodes into MJML elements
// ---------------------------------------------------------------------------

function genColumnContent(node: SerializedNode, maxWidth: number, depth: number): string[] {
  const lines: string[] = [];

  if (!node.visible) return lines;

  // TEXT
  if (node.type === 'TEXT') {
    const el = genTextEl(node);
    if (el) lines.push(el);
    return lines;
  }

  // Rasterized image
  if (node.isExportedAsImage) {
    lines.push(genImageEl(node, maxWidth));
    return lines;
  }

  // Divider
  if (isDivider(node)) {
    lines.push(genDividerEl(node));
    return lines;
  }

  // Button
  if (isButton(node)) {
    lines.push(genButtonEl(node));
    return lines;
  }

  // Recurse into children (Frame, Group, Component, Instance)
  const kids = node.children;
  if (!kids || kids.length === 0) return lines;

  const spacing = node.itemSpacing ?? 0;

  for (let i = 0; i < kids.length; i++) {
    const childLines = genColumnContent(kids[i], maxWidth, depth + 1);
    lines.push(...childLines);

    // Add spacer between siblings when auto-layout has itemSpacing
    if (spacing > 0 && i < kids.length - 1 && childLines.length > 0) {
      lines.push(genSpacerEl(spacing));
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Section generator — each direct child of the root frame becomes a section
// ---------------------------------------------------------------------------

function genSection(node: SerializedNode, frameWidth: number): string {
  const lines: string[] = [];

  const bg = solidColor(node.fills);
  const pt = node.paddingTop ?? 0;
  const pb = node.paddingBottom ?? 0;
  const pl = node.paddingLeft ?? 0;
  const pr = node.paddingRight ?? 0;
  const padding = (pt || pb || pl || pr)
    ? `${pt}px ${pr}px ${pb}px ${pl}px`
    : '0';

  const sectionAttrs = [
    bg ? `background-color="${bg}"` : '',
    `padding="${padding}"`,
  ].filter(Boolean).join(' ');

  lines.push(`<mj-section ${sectionAttrs}>`);

  // ── Entire section is a flat image ────────────────────────────────────────
  if (node.isExportedAsImage) {
    lines.push(`  <mj-column>`);
    lines.push(`    ${genImageEl(node, frameWidth)}`);
    lines.push(`  </mj-column>`);
    lines.push(`</mj-section>`);
    return lines.join('\n');
  }

  const kids = node.children ?? [];

  // ── Multi-column layout ───────────────────────────────────────────────────
  if (isHorizontal(node) && kids.length > 1) {
    const colWidth = Math.floor(frameWidth / kids.length);
    for (const kid of kids) {
      const kidBg = solidColor(kid.fills);
      const colAttr = kidBg ? ` background-color="${kidBg}"` : '';
      lines.push(`  <mj-column${colAttr}>`);
      const content = genColumnContent(kid, colWidth, 0);
      for (const line of content) lines.push(`    ${line}`);
      lines.push(`  </mj-column>`);
    }

  // ── Single-column layout ─────────────────────────────────────────────────
  } else {
    lines.push(`  <mj-column>`);
    for (const kid of kids) {
      const content = genColumnContent(kid, frameWidth - pl - pr, 0);
      for (const line of content) lines.push(`    ${line}`);

      // Spacer between vertically stacked siblings
      if ((node.itemSpacing ?? 0) > 0) {
        lines.push(`    ${genSpacerEl(node.itemSpacing!)}`);
      }
    }
    lines.push(`  </mj-column>`);
  }

  lines.push(`</mj-section>`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateMJML(frame: SerializedNode, frameName: string): string {
  const width = Math.round(frame.width) || 600;
  const bg = solidColor(frame.fills) ?? '#ffffff';
  const sections = frame.children ?? [];

  // Collect unique Google Fonts referenced
  const webSafeFonts = new Set(['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS']);
  const googleFonts = new Set<string>();
  function collectFonts(node: SerializedNode) {
    if (node.textStyle) {
      const family = node.textStyle.fontFamily;
      if (!webSafeFonts.has(family)) {
        googleFonts.add(family);
      }
    }
    node.children?.forEach(collectFonts);
  }
  sections.forEach(collectFonts);

  const fontDecls = [...googleFonts]
    .map((f) => `    <mj-font name="${f}" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}:wght@400;700&display=swap" />`)
    .join('\n');

  const lines: string[] = [
    `<mjml>`,
    `  <mj-head>`,
    fontDecls,
    `    <mj-attributes>`,
    `      <mj-all font-family="Arial, Helvetica, sans-serif" />`,
    `      <mj-text font-size="14px" color="#333333" line-height="1.5" padding="8px 0" />`,
    `      <mj-image padding="0" />`,
    `      <mj-section padding="0" />`,
    `      <mj-body width="${width}px" />`,
    `    </mj-attributes>`,
    `    <mj-style>`,
    `      a { color: inherit; }`,
    `    </mj-style>`,
    `  </mj-head>`,
    `  <mj-body background-color="${bg}" width="${width}px">`,
  ];

  for (const section of sections) {
    const sectionMjml = genSection(section, width);
    // Indent the section
    for (const line of sectionMjml.split('\n')) {
      lines.push(`    ${line}`);
    }
  }

  lines.push(`  </mj-body>`);
  lines.push(`</mjml>`);

  return lines.filter((l) => l.trim() !== '').join('\n');
}
