/**
 * Excalidraw Scene Builder (Phase 117)
 *
 * Pure functions for building, validating, and patching Excalidraw scenes.
 * No side effects, no API calls.
 */

import type {
  ExcalidrawElementSpec,
  ExcalidrawElement,
  ExcalidrawScene,
  PatchOperation,
  ValidationIssue,
} from '@secureyeoman/shared';

// ─── Helpers ────────────────────────────────────────────────────────────────

let idCounter = 0;

function generateId(): string {
  return `el_${Date.now().toString(36)}_${(idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

const DEFAULT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  rectangle: { width: 120, height: 60 },
  ellipse: { width: 120, height: 80 },
  diamond: { width: 100, height: 100 },
  text: { width: 100, height: 25 },
  line: { width: 200, height: 0 },
  arrow: { width: 200, height: 0 },
  freedraw: { width: 100, height: 100 },
  image: { width: 200, height: 200 },
};

// ─── specToElement ──────────────────────────────────────────────────────────

export function specToElement(spec: ExcalidrawElementSpec, _index: number): ExcalidrawElement {
  const defaults = DEFAULT_DIMENSIONS[spec.type] ?? { width: 100, height: 60 };
  const isLinear = spec.type === 'line' || spec.type === 'arrow';
  const isText = spec.type === 'text';

  const element: ExcalidrawElement = {
    id: spec.id ?? generateId(),
    type: spec.type,
    x: spec.x,
    y: spec.y,
    width: spec.width ?? defaults.width,
    height: spec.height ?? defaults.height,
    angle: 0,
    strokeColor: spec.strokeColor ?? '#1e1e1e',
    backgroundColor: spec.backgroundColor ?? 'transparent',
    fillStyle: spec.fillStyle ?? 'solid',
    strokeWidth: spec.strokeWidth ?? 2,
    strokeStyle: 'solid',
    roughness: spec.roughness ?? 1,
    opacity: 100,
    groupIds: spec.groupId ? [spec.groupId] : [],
    frameId: null,
    roundness: spec.roundness ?? (isLinear || isText ? null : { type: 3 }),
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };

  // Text-specific
  if (isText) {
    element.text = spec.label ?? '';
    element.originalText = spec.label ?? '';
    element.fontSize = spec.fontSize ?? 20;
    element.fontFamily = spec.fontFamily ?? 1;
    element.textAlign = spec.textAlign ?? 'center';
    element.verticalAlign = 'middle';
    element.autoResize = true;
    element.lineHeight = 1.25;
    if (spec.containerId) {
      element.containerId = spec.containerId;
    }
  }

  // Arrow/line-specific
  if (isLinear) {
    element.points = spec.points ?? [
      [0, 0],
      [element.width, 0],
    ];
    element.startBinding = null;
    element.endBinding = null;
    if (spec.type === 'arrow') {
      element.startArrowhead = null;
      element.endArrowhead = 'arrow';
    }
  }

  return element;
}

// ─── buildScene ─────────────────────────────────────────────────────────────

export interface BuildSceneOptions {
  /** Background color (default: #ffffff). */
  viewBackgroundColor?: string;
  /** Theme (default: light). */
  theme?: 'light' | 'dark';
  /** Grid size (null = no grid). */
  gridSize?: number | null;
}

export function buildScene(
  _title: string,
  specs: ExcalidrawElementSpec[],
  options?: BuildSceneOptions
): ExcalidrawScene {
  const elements: ExcalidrawElement[] = [];
  // Map spec IDs to generated IDs for arrow binding resolution
  const idMap = new Map<string, string>();

  // First pass: assign IDs
  for (let idx = 0; idx < specs.length; idx++) {
    const spec = specs[idx]!;
    const specId = spec.id ?? generateId();
    if (spec.id) {
      idMap.set(spec.id, specId);
    }
    idMap.set(`__idx_${idx}`, specId);
  }

  // Second pass: convert specs
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const assignedId = idMap.get(spec.id ?? `__idx_${i}`) ?? generateId();
    const el = specToElement({ ...spec, id: assignedId }, i);
    elements.push(el);

    // Auto-create bound text for shapes with labels (except text type)
    if (spec.label && spec.type !== 'text') {
      const textId = generateId();
      const textEl = specToElement(
        {
          type: 'text',
          x: el.x + 10,
          y: el.y + el.height / 2 - 12,
          width: el.width - 20,
          height: 25,
          label: spec.label,
          fontSize: spec.fontSize,
          fontFamily: spec.fontFamily,
          textAlign: spec.textAlign ?? 'center',
          containerId: el.id,
        },
        elements.length
      );
      textEl.id = textId;
      elements.push(textEl);
      // Add bound element reference to parent
      el.boundElements = [...(el.boundElements ?? []), { type: 'text', id: textId }];
    }
  }

  // Third pass: resolve arrow bindings
  for (const el of elements) {
    if (el.type !== 'arrow') continue;
    const spec = specs.find((s) => (s.id && idMap.get(s.id) === el.id) || s.id === el.id);
    if (!spec) continue;

    if (spec.startId) {
      const targetId = idMap.get(spec.startId) ?? spec.startId;
      const target = elements.find((e) => e.id === targetId);
      if (target) {
        el.startBinding = {
          elementId: targetId,
          focus: 0,
          gap: 8,
        };
        target.boundElements = [...(target.boundElements ?? []), { type: 'arrow', id: el.id }];
      }
    }

    if (spec.endId) {
      const targetId = idMap.get(spec.endId) ?? spec.endId;
      const target = elements.find((e) => e.id === targetId);
      if (target) {
        el.endBinding = {
          elementId: targetId,
          focus: 0,
          gap: 8,
        };
        target.boundElements = [...(target.boundElements ?? []), { type: 'arrow', id: el.id }];
      }
    }
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'secureyeoman',
    elements,
    appState: {
      gridSize: options?.gridSize ?? null,
      viewBackgroundColor: options?.viewBackgroundColor ?? '#ffffff',
      theme: options?.theme ?? 'light',
    },
    files: {},
  };
}

// ─── validateScene ──────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  suggestions: string[];
}

function boxesOverlap(a: ExcalidrawElement, b: ExcalidrawElement): boolean {
  // Allow 5px tolerance
  const t = 5;
  return (
    a.x < b.x + b.width - t &&
    a.x + a.width > b.x + t &&
    a.y < b.y + b.height - t &&
    a.y + a.height > b.y + t
  );
}

function relativeLuminance(hex: string): number {
  const rgb = hex.replace('#', '');
  if (rgb.length < 6) return 0.5;
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateScene(scene: ExcalidrawScene): ValidationResult {
  const issues: ValidationIssue[] = [];
  const suggestions: string[] = [];
  const nonDeletedElements = scene.elements.filter((e) => !e.isDeleted);
  const shapes = nonDeletedElements.filter(
    (e) => e.type !== 'text' && e.type !== 'line' && e.type !== 'arrow' && e.type !== 'freedraw'
  );
  const arrows = nonDeletedElements.filter((e) => e.type === 'arrow');
  const textElements = nonDeletedElements.filter((e) => e.type === 'text');

  // Check overlapping bounding boxes (shapes only)
  for (let i = 0; i < shapes.length; i++) {
    const a = shapes[i]!;
    for (let j = i + 1; j < shapes.length; j++) {
      const b = shapes[j]!;
      // Skip if in the same group
      if (a.groupIds.length > 0 && a.groupIds.some((g) => b.groupIds.includes(g))) continue;
      if (boxesOverlap(a, b)) {
        issues.push({
          type: 'overlap',
          severity: 'warning',
          message: `Elements "${a.id}" and "${b.id}" have overlapping bounding boxes`,
          elementIds: [a.id, b.id],
        });
      }
    }
  }

  // Check orphaned arrow bindings
  const elementIds = new Set(nonDeletedElements.map((e) => e.id));
  for (const arrow of arrows) {
    if (arrow.startBinding && !elementIds.has(arrow.startBinding.elementId)) {
      issues.push({
        type: 'orphaned-binding',
        severity: 'error',
        message: `Arrow "${arrow.id}" has startBinding to non-existent element "${arrow.startBinding.elementId}"`,
        elementIds: [arrow.id],
      });
    }
    if (arrow.endBinding && !elementIds.has(arrow.endBinding.elementId)) {
      issues.push({
        type: 'orphaned-binding',
        severity: 'error',
        message: `Arrow "${arrow.id}" has endBinding to non-existent element "${arrow.endBinding.elementId}"`,
        elementIds: [arrow.id],
      });
    }
  }

  // Check text overflow estimation
  for (const textEl of textElements) {
    if (textEl.containerId && textEl.text) {
      const container = nonDeletedElements.find((e) => e.id === textEl.containerId);
      if (container) {
        const fontSize = textEl.fontSize ?? 20;
        const estimatedWidth = textEl.text.length * fontSize * 0.55;
        if (estimatedWidth > container.width * 0.9) {
          issues.push({
            type: 'text-overflow',
            severity: 'info',
            message: `Text in "${textEl.id}" may overflow container "${container.id}"`,
            elementIds: [textEl.id, container.id],
          });
        }
      }
    }
  }

  // Check unbalanced layout (center-of-mass)
  if (shapes.length >= 3) {
    let sumX = 0;
    let sumY = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      const cx = s.x + s.width / 2;
      const cy = s.y + s.height / 2;
      sumX += cx;
      sumY += cy;
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x + s.width);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y + s.height);
    }
    const comX = sumX / shapes.length;
    const comY = sumY / shapes.length;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const driftX = Math.abs(comX - midX) / (spanX || 1);
    const driftY = Math.abs(comY - midY) / (spanY || 1);

    if (driftX > 0.3 || driftY > 0.3) {
      issues.push({
        type: 'unbalanced-layout',
        severity: 'info',
        message:
          'Layout appears unbalanced — elements are clustered to one side. Consider redistributing.',
      });
      suggestions.push('Redistribute elements for a more balanced layout');
    }
  }

  // Check missing labels on shapes
  for (const shape of shapes) {
    const hasBoundText = shape.boundElements?.some((b) => b.type === 'text') ?? false;
    if (!hasBoundText) {
      issues.push({
        type: 'missing-label',
        severity: 'info',
        message: `Shape "${shape.id}" has no text label`,
        elementIds: [shape.id],
      });
    }
  }

  // Check color contrast (WCAG AA 4.5:1 for text)
  for (const textEl of textElements) {
    if (textEl.containerId) {
      const container = nonDeletedElements.find((e) => e.id === textEl.containerId);
      if (container && container.backgroundColor !== 'transparent' && textEl.strokeColor) {
        const ratio = contrastRatio(textEl.strokeColor, container.backgroundColor);
        if (ratio < 4.5) {
          issues.push({
            type: 'low-contrast',
            severity: 'warning',
            message: `Text "${textEl.id}" has contrast ratio ${ratio.toFixed(1)}:1 against container background (WCAG AA requires 4.5:1)`,
            elementIds: [textEl.id, container.id],
          });
        }
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');

  if (issues.length === 0) {
    suggestions.push('Scene looks good!');
  }

  return {
    valid: !hasErrors,
    issues,
    suggestions,
  };
}

// ─── renderSceneToSvg ────────────────────────────────────────────────────────

export interface RenderOptions {
  width?: number;
  height?: number;
  darkMode?: boolean;
  padding?: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hexToRgba(hex: string, opacity: number): string {
  if (hex === 'transparent') return 'none';
  const rgb = hex.replace('#', '');
  if (rgb.length < 6) return hex;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

function elementToSvg(el: ExcalidrawElement): string {
  const fill = hexToRgba(el.backgroundColor, el.opacity);
  const stroke = hexToRgba(el.strokeColor, el.opacity);
  const sw = el.strokeWidth;

  switch (el.type) {
    case 'rectangle': {
      const rx = el.roundness?.type === 3 ? Math.min(8, el.width / 4) : 0;
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'ellipse':
      return `<ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    case 'diamond': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const _hw = el.width / 2;
      const _hh = el.height / 2;
      return `<polygon points="${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'text': {
      const fontSize = el.fontSize ?? 20;
      const fontFamily =
        el.fontFamily === 3 ? 'monospace' : el.fontFamily === 2 ? 'sans-serif' : 'serif';
      const anchor =
        el.textAlign === 'right' ? 'end' : el.textAlign === 'center' ? 'middle' : 'start';
      const tx =
        el.textAlign === 'center'
          ? el.x + el.width / 2
          : el.textAlign === 'right'
            ? el.x + el.width
            : el.x;
      const ty = el.y + fontSize;
      return `<text x="${tx}" y="${ty}" font-size="${fontSize}" font-family="${fontFamily}" fill="${stroke}" text-anchor="${anchor}">${escapeXml(el.text ?? '')}</text>`;
    }
    case 'line':
    case 'arrow': {
      if (!el.points || el.points.length < 2) return '';
      const pts = el.points.map(([px, py]) => `${el.x + px},${el.y + py}`).join(' ');
      const markerId = el.type === 'arrow' ? `marker-end="url(#arrowhead)"` : '';
      return `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}" ${markerId} />`;
    }
    case 'freedraw': {
      if (!el.points || el.points.length < 2) return '';
      const d = el.points
        .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${el.x + px} ${el.y + py}`)
        .join(' ');
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    default:
      return '';
  }
}

export function renderSceneToSvg(scene: ExcalidrawScene, options?: RenderOptions): string {
  const padding = options?.padding ?? 20;
  const elements = scene.elements.filter((e) => !e.isDeleted);

  if (elements.length === 0) {
    const w = options?.width ?? 400;
    const h = options?.height ?? 300;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`;
  }

  // Compute bounding box
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const el of elements) {
    if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
      for (const [px, py] of el.points ?? []) {
        minX = Math.min(minX, el.x + px);
        minY = Math.min(minY, el.y + py);
        maxX = Math.max(maxX, el.x + px);
        maxY = Math.max(maxY, el.y + py);
      }
    } else {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
  }

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const svgW = options?.width ?? contentW + padding * 2;
  const svgH = options?.height ?? contentH + padding * 2;
  const bgColor = options?.darkMode ? '#1e1e1e' : (scene.appState.viewBackgroundColor ?? '#ffffff');

  const hasArrows = elements.some((e) => e.type === 'arrow');
  const arrowDef = hasArrows
    ? `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${options?.darkMode ? '#e0e0e0' : '#1e1e1e'}" /></marker></defs>`
    : '';

  const body = elements
    .map((el) => elementToSvg(el))
    .filter(Boolean)
    .join('\n  ');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="${minX - padding} ${minY - padding} ${contentW + padding * 2} ${contentH + padding * 2}">`,
    `<rect x="${minX - padding}" y="${minY - padding}" width="${contentW + padding * 2}" height="${contentH + padding * 2}" fill="${bgColor}" />`,
    arrowDef,
    `  ${body}`,
    '</svg>',
  ].join('\n');
}

// ─── patchScene ─────────────────────────────────────────────────────────────

export function patchScene(scene: ExcalidrawScene, operations: PatchOperation[]): ExcalidrawScene {
  // Work on a mutable copy
  let elements = scene.elements.map((e) => ({ ...e }));

  for (const op of operations) {
    switch (op.op) {
      case 'add': {
        if (!op.element) break;
        const newEl = specToElement(op.element, elements.length);
        elements.push(newEl);

        // Auto-create bound text if label present
        if (op.element.label && op.element.type !== 'text') {
          const textId = generateId();
          const textEl = specToElement(
            {
              type: 'text',
              x: newEl.x + 10,
              y: newEl.y + newEl.height / 2 - 12,
              width: newEl.width - 20,
              height: 25,
              label: op.element.label,
              containerId: newEl.id,
            },
            elements.length
          );
          textEl.id = textId;
          elements.push(textEl);
          newEl.boundElements = [...(newEl.boundElements ?? []), { type: 'text', id: textId }];
        }
        break;
      }

      case 'update': {
        if (!op.elementId || !op.properties) break;
        const idx = elements.findIndex((e) => e.id === op.elementId);
        if (idx === -1) break;
        const existing = elements[idx]!;
        elements[idx] = {
          ...existing,
          ...(op.properties as Partial<ExcalidrawElement>),
          version: existing.version + 1,
          versionNonce: generateSeed(),
          updated: Date.now(),
        };
        break;
      }

      case 'delete': {
        if (!op.elementId) break;
        const target = elements.find((e) => e.id === op.elementId);
        if (!target) break;

        // Remove bound text elements
        if (target.boundElements) {
          for (const bound of target.boundElements) {
            if (bound.type === 'text') {
              elements = elements.filter((e) => e.id !== bound.id);
            }
          }
        }

        // Clean up arrow bindings pointing to deleted element
        for (const el of elements) {
          if (el.startBinding?.elementId === op.elementId) {
            el.startBinding = null;
          }
          if (el.endBinding?.elementId === op.elementId) {
            el.endBinding = null;
          }
          if (el.boundElements) {
            el.boundElements = el.boundElements.filter((b) => b.id !== op.elementId);
          }
        }

        elements = elements.filter((e) => e.id !== op.elementId);
        break;
      }

      case 'move': {
        if (!op.elementId || !op.properties) break;
        const props = op.properties as { dx?: number; dy?: number };
        const dx = props.dx ?? 0;
        const dy = props.dy ?? 0;
        const moveIdx = elements.findIndex((e) => e.id === op.elementId);
        if (moveIdx === -1) break;

        const moved = elements[moveIdx]!;
        elements[moveIdx] = {
          ...moved,
          x: moved.x + dx,
          y: moved.y + dy,
          version: moved.version + 1,
          versionNonce: generateSeed(),
          updated: Date.now(),
        };

        // Also move bound text elements
        if (moved.boundElements) {
          for (const bound of moved.boundElements) {
            if (bound.type === 'text') {
              const textIdx = elements.findIndex((e) => e.id === bound.id);
              if (textIdx !== -1) {
                const textEl = elements[textIdx]!;
                elements[textIdx] = {
                  ...textEl,
                  x: textEl.x + dx,
                  y: textEl.y + dy,
                  version: textEl.version + 1,
                  versionNonce: generateSeed(),
                  updated: Date.now(),
                };
              }
            }
          }
        }
        break;
      }

      case 'restyle': {
        if (!op.elementId || !op.properties) break;
        const restyleIdx = elements.findIndex((e) => e.id === op.elementId);
        if (restyleIdx === -1) break;
        const restyleEl = elements[restyleIdx]!;
        const allowed = [
          'strokeColor',
          'backgroundColor',
          'fillStyle',
          'strokeWidth',
          'roughness',
          'opacity',
          'strokeStyle',
        ];
        const restyleProps: Record<string, unknown> = {};
        for (const key of allowed) {
          if (key in op.properties) {
            restyleProps[key] = op.properties[key];
          }
        }
        elements[restyleIdx] = {
          ...restyleEl,
          ...restyleProps,
          version: restyleEl.version + 1,
          versionNonce: generateSeed(),
          updated: Date.now(),
        };
        break;
      }
    }
  }

  return {
    ...scene,
    elements,
  };
}
