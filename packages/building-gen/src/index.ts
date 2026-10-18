import type { BuildingSpec } from '@nabi/protocol';

export type Vec3 = [number, number, number];
export interface BuildingPart {
  id: string;
  shape: 'box' | 'cylinder' | 'cone';
  position: Vec3;
  size: Vec3;
  color: string;
  emissive?: boolean;
}

export function seedFromString(value: string): number {
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const palettes: Record<BuildingSpec['archetype'], [string, string]> = {
  office: ['#88b9b5', '#365a62'],
  laboratory: ['#e6dfcc', '#65878d'],
  factory: ['#b2b6a6', '#4e6660'],
  tower: ['#8eabc3', '#445e79'],
  townhouse: ['#d29a7c', '#784d43'],
  library: ['#d9c99b', '#6e7657'],
};

/** Pure geometry description; units are metres, Y is up, the entrance faces +Z. */
export function generateBuilding(spec: BuildingSpec): BuildingPart[] {
  const parts: BuildingPart[] = [];
  const [wall, roof] = palettes[spec.archetype];
  const width = 1.5 + spec.footprint * 0.4;
  const depth = 1.5 + spec.footprint * 0.25;
  const height = 0.5 + spec.tier * 0.58;
  const add = (
    id: string,
    position: Vec3,
    size: Vec3,
    color: string,
    shape: BuildingPart['shape'] = 'box',
    emissive = false,
  ) => parts.push({ id, position, size, color, shape, emissive });

  add('foundation', [0, 0.1, 0], [width + 0.4, 0.2, depth + 0.4], '#d7dbcb');
  if (spec.tier === 0) {
    add('plot-marker', [0, 0.3, 0], [0.7, 0.2, 0.7], '#b2bba2');
    return parts;
  }
  add('body', [0, height / 2 + 0.2, 0], [width, height, depth], wall);
  add('roof', [0, height + 0.28, 0], [width + 0.18, 0.16, depth + 0.18], roof);
  add('door', [0, 0.52, depth / 2 + 0.025], [0.4, 0.64, 0.05], roof);
  const columns = 3 + (spec.seed % 2);
  for (let floor = 0; floor < spec.tier; floor++) {
    for (let column = 0; column < columns; column++) {
      const x = (column - (columns - 1) / 2) * (width / (columns + 1));
      const y = 0.65 + floor * 0.57;
      if (floor > 0 || Math.abs(x) > 0.3)
        add(
          `window-front-${floor}-${column}`,
          [x, y, depth / 2 + 0.03],
          [0.25, 0.28, 0.06],
          '#f3dea4',
          'box',
          true,
        );
      add(
        `window-side-${floor}-${column}`,
        [width / 2 + 0.03, y, (x * depth) / width],
        [0.06, 0.28, 0.25],
        '#b8d8d1',
        'box',
        true,
      );
    }
  }
  if (spec.archetype === 'factory') {
    add(
      'chimney',
      [-width * 0.28, height + 0.65, -depth * 0.25],
      [0.28, 0.8, 0.28],
      roof,
      'cylinder',
    );
  }
  if (spec.archetype === 'laboratory') {
    add('dome', [0, height + 0.65, 0], [0.9, 0.7, 0.9], '#93b7bd', 'cone');
  }
  if (spec.archetype === 'townhouse') {
    add(
      'gable',
      [0, height + 0.57, 0],
      [width * 0.85, 0.65, depth * 0.85],
      roof,
      'cone',
    );
  }
  if (spec.archetype === 'tower') {
    add(
      'penthouse',
      [0, height + 0.58, 0],
      [width * 0.65, 0.6, depth * 0.65],
      wall,
    );
  }
  if (spec.archetype === 'library' || spec.modules.includes('docs')) {
    add(
      'sign',
      [0, height - 0.08, depth / 2 + 0.08],
      [0.9, 0.18, 0.1],
      '#fcf0ce',
    );
  }
  if (spec.modules.includes('ci')) {
    add(
      'antenna',
      [width * 0.32, height + 0.8, 0],
      [0.06, 1.05, 0.06],
      '#4b6060',
    );
    add(
      'beacon',
      [width * 0.32, height + 1.35, 0],
      [0.18, 0.18, 0.18],
      '#e6b862',
      'box',
      true,
    );
  }
  if (spec.modules.includes('container'))
    add('loading-dock', [-width * 0.65, 0.45, 0.3], [0.7, 0.6, 0.9], roof);
  if (spec.modules.includes('tests')) {
    for (const side of [-1, 1])
      add(
        `frame-${side}`,
        [(side * width) / 2, height / 2, depth / 2 + 0.06],
        [0.12, height, 0.14],
        roof,
      );
  }
  if (spec.modules.includes('deploy'))
    add(
      'roof-flag',
      [-width * 0.3, height + 0.62, 0],
      [0.45, 0.4, 0.08],
      '#e7a773',
    );
  return parts;
}

export { gridColumns, layoutDistricts, PLOT_SPACING } from './layout';
export type { PlotPosition } from './layout';
