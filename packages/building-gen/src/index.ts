import { maturities, type BuildingSpec } from '@nabi/protocol';

export type Vec3 = [number, number, number];
/** Surface classes the renderer maps to physically based materials. */
export type PartMaterial =
  | 'paint'
  | 'concrete'
  | 'brick'
  | 'glass'
  | 'metal'
  | 'wood'
  | 'foliage'
  | 'light';
export interface BuildingPart {
  id: string;
  /**
   * `box` [w, h, d]; `cylinder` [top diameter, h, bottom diameter]; `cone` [diameter,
   * h, —]; `sphere` [diameter]; `prism` a gable [w, h, d] with its ridge along Z.
   */
  shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'prism';
  position: Vec3;
  size: Vec3;
  color: string;
  material: PartMaterial;
  rotation?: Vec3;
  /** Radial segments for round shapes; low counts give facets. */
  segments?: number;
  /** Lit: glows (windows of active repositories, beacons, signs). */
  emissive?: boolean;
}

export function seedFromString(value: string): number {
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32), so a seed always gives the same building. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLOOR = 0.36;
const BASE = 0.2;

interface Style {
  frame: string[];
  glass: string[];
  accent: string[];
}
/** Seeded variants per archetype: the same style, never the same building twice. */
const styles: Record<BuildingSpec['archetype'], Style> = {
  office: {
    frame: ['#eef1f4', '#2f3946', '#c8b89e', '#dfe6e2'],
    glass: ['#6f9cc4', '#5c8aa3', '#8bb7c2', '#7d93b8'],
    accent: ['#e2734f', '#4fb3a9', '#e9c46a'],
  },
  tower: {
    frame: ['#dfe3e8', '#38414d', '#9fb0c2'],
    glass: ['#4f7fa8', '#6e95b8', '#4b6f8e'],
    accent: ['#e9c46a', '#d9e3ec'],
  },
  pavilion: {
    frame: ['#f4f2ec', '#ffffff', '#e8eef2'],
    glass: ['#87c3d6', '#9fc9e8', '#a6d6c8'],
    accent: ['#ff7a59', '#6c63ff', '#2ec4b6', '#f4a261'],
  },
  studio: {
    frame: ['#2a2d3a', '#ecebf3', '#3b3352'],
    glass: ['#7a6fd0', '#5b8bd9', '#9a73c9'],
    accent: ['#ff4fd8', '#35e0f0', '#9dff6a'],
  },
  laboratory: {
    frame: ['#f2f4f3', '#e3ebe8', '#dde4ec'],
    glass: ['#7fb6b0', '#86a9c9'],
    accent: ['#4fc08d', '#58a6ff', '#f2b134'],
  },
  factory: {
    frame: ['#a8553f', '#8e4a3a', '#b5683e', '#7f8a8c'],
    glass: ['#7e9aa6', '#8fa7a0'],
    accent: ['#f2b134', '#3d7ea6', '#d9d4c7'],
  },
  townhouse: {
    frame: ['#e9a07a', '#8fc0a9', '#f1d78a', '#a7b8e8', '#e8a0b4', '#f0ead6'],
    glass: ['#86a7b8'],
    accent: ['#3d4a5c', '#7a4b3a', '#2f5d50'],
  },
  library: {
    frame: ['#e9dfc8', '#efe9dc', '#d9d2c3'],
    glass: ['#7fa1b0', '#8eb0a4'],
    accent: ['#5f8a5a', '#b5835a'],
  },
};

interface Shell {
  /** Roof height and the clear roof area modules can use. */
  top: number;
  roof: { x: number; z: number; w: number; d: number };
  /** Entrance on the +Z face. */
  front: number;
  width: number;
}

/** Pure geometry description; units are metres, Y is up, the entrance faces +Z. */
export function generateBuilding(spec: BuildingSpec): BuildingPart[] {
  const parts: BuildingPart[] = [];
  const rng = random(spec.seed ^ 0x9e3779b9);
  const pick = <T>(items: T[]) => items[Math.floor(rng() * items.length)]!;
  const style = styles[spec.archetype];
  const frame = pick(style.frame);
  const glass = pick(style.glass);
  const accent = pick(style.accent);
  const maturity = spec.maturity ?? maturities[spec.tier]!;
  const activity = spec.activity ?? 'active';
  const glowing = activity !== 'dormant';
  let windowIndex = 0;
  /** Active repositories light every window, quiet ones some, dormant ones none. */
  const lit = () => {
    const index = windowIndex++;
    return activity === 'active' || activity === 'recent'
      ? true
      : activity === 'quiet'
        ? (spec.seed + index * 7) % 3 === 0
        : false;
  };
  const add = (
    id: string,
    shape: BuildingPart['shape'],
    position: Vec3,
    size: Vec3,
    color: string,
    material: PartMaterial,
    extra: Partial<BuildingPart> = {},
  ) => parts.push({ id, shape, position, size, color, material, ...extra });
  /**
   * A glass pane; lit ones glow warmly from inside. Every `window-*` part follows
   * the activity.
   */
  const pane = (
    id: string,
    position: Vec3,
    size: Vec3,
    extra: Partial<BuildingPart> = {},
  ) => {
    const on = lit();
    add(`window-${id}`, 'box', position, size, glass, 'glass', {
      emissive: on,
      ...extra,
    });
  };

  const fp = spec.footprint;
  add(
    'foundation',
    'box',
    [0, 0.1, 0],
    [2.5 + fp * 0.3, 0.2, 2.5 + fp * 0.2],
    '#d6dad3',
    'concrete',
  );
  if (spec.tier === 0) {
    // An empty plot: fenced, levelled, with a sign waiting for the first commits.
    add(
      'plot-marker',
      'box',
      [0, 0.23, 0],
      [1.6, 0.06, 1.4],
      '#b9a98a',
      'wood',
    );
    const fence: [number, number, number, number][] = [
      [0, -0.9, 2.2, 0.04],
      [-1.1, 0, 0.04, 1.8],
      [1.1, 0, 0.04, 1.8],
    ];
    fence.forEach(([x, z, w, d], index) =>
      add(
        `fence-${index}`,
        'box',
        [x, 0.38, z],
        [w, 0.3, d],
        '#e6b85c',
        'paint',
      ),
    );
    add(
      'sign-post',
      'box',
      [0.7, 0.55, 0.85],
      [0.05, 0.7, 0.05],
      '#6b6f73',
      'metal',
    );
    add(
      'sign-board',
      'box',
      [0.7, 0.85, 0.87],
      [0.6, 0.3, 0.03],
      '#f4f1ea',
      'paint',
    );
    return parts;
  }

  const builders: Record<BuildingSpec['archetype'], () => Shell> = {
    office() {
      const width = 1.6 + fp * 0.3;
      const depth = 1.45 + fp * 0.25;
      const floors = 2 + spec.tier + (fp - 1);
      // Double-height glass lobby, then floors of glass between projecting slabs.
      add(
        'body',
        'box',
        [0, BASE + 0.3, 0],
        [width - 0.1, 0.6, depth - 0.1],
        frame,
        'paint',
      );
      pane(
        'lobby',
        [0, BASE + 0.28, depth / 2 - 0.03],
        [width - 0.5, 0.48, 0.04],
      );
      add(
        'canopy',
        'box',
        [0, BASE + 0.62, depth / 2 + 0.2],
        [width * 0.6, 0.05, 0.4],
        accent,
        'metal',
      );
      let y = BASE + 0.6;
      for (let floor = 0; floor < floors; floor++) {
        add(
          `slab-${floor}`,
          'box',
          [0, y + 0.03, 0],
          [width + 0.08, 0.06, depth + 0.08],
          frame,
          'paint',
        );
        pane(
          `${floor}`,
          [0, y + 0.06 + (FLOOR - 0.06) / 2, 0],
          [width - 0.04, FLOOR - 0.06, depth - 0.04],
        );
        y += FLOOR;
      }
      add(
        'roof',
        'box',
        [0, y + 0.04, 0],
        [width + 0.08, 0.08, depth + 0.08],
        frame,
        'paint',
      );
      // Mullions on the two faces the camera sees.
      const shaft = y - BASE - 0.6;
      for (let index = -2; index <= 2; index++) {
        add(
          `mullion-front-${index}`,
          'box',
          [(index * width) / 5, BASE + 0.6 + shaft / 2, depth / 2 + 0.01],
          [0.03, shaft, 0.03],
          frame,
          'metal',
        );
        add(
          `mullion-side-${index}`,
          'box',
          [width / 2 + 0.01, BASE + 0.6 + shaft / 2, (index * depth) / 5],
          [0.03, shaft, 0.03],
          frame,
          'metal',
        );
      }
      add(
        'plant-room',
        'box',
        [-width * 0.18, y + 0.24, -depth * 0.15],
        [width * 0.45, 0.32, depth * 0.45],
        '#c4c9cf',
        'concrete',
      );
      for (const x of [0.2, 0.42])
        add(
          `hvac-${x}`,
          'cylinder',
          [x * width, y + 0.16, depth * 0.22],
          [0.18, 0.12, 0.18],
          '#9aa3ad',
          'metal',
          { segments: 10 },
        );
      return {
        top: y + 0.08,
        roof: {
          x: width * 0.2,
          z: -depth * 0.2,
          w: width * 0.4,
          d: depth * 0.3,
        },
        front: depth / 2,
        width,
      };
    },
    tower() {
      let width = 1.25 + fp * 0.22;
      let depth = width;
      const floors = 4 + spec.tier * 2 + fp;
      add(
        'body',
        'box',
        [0, BASE + 0.25, 0],
        [width + 0.3, 0.5, depth + 0.3],
        '#d7dbe0',
        'concrete',
      );
      pane(
        'lobby',
        [0, BASE + 0.25, depth / 2 + 0.16],
        [width * 0.7, 0.4, 0.02],
      );
      let y = BASE + 0.5;
      const section = Math.ceil(floors / 3);
      for (let floor = 0; floor < floors; floor++) {
        if (floor > 0 && floor % section === 0) {
          // Setbacks, with a terrace slab at each step.
          add(
            `setback-${floor}`,
            'box',
            [0, y + 0.02, 0],
            [width + 0.06, 0.04, depth + 0.06],
            frame,
            'paint',
          );
          width *= 0.8;
          depth *= 0.8;
        }
        pane(`${floor}`, [0, y + FLOOR / 2, 0], [width, FLOOR - 0.02, depth]);
        y += FLOOR;
      }
      // Vertical fins run up the lower shaft.
      const shaft = section * FLOOR;
      for (let index = -1; index <= 1; index++)
        add(
          `fin-${index}`,
          'box',
          [index * 0.35, BASE + 0.5 + shaft / 2, (1.25 + fp * 0.22) / 2 + 0.03],
          [0.05, shaft, 0.08],
          frame,
          'metal',
        );
      add(
        'roof',
        'box',
        [0, y + 0.05, 0],
        [width + 0.06, 0.1, depth + 0.06],
        frame,
        'paint',
      );
      add(
        'spire',
        'cylinder',
        [0, y + 0.55, 0],
        [0.02, 0.9, 0.08],
        '#c9d1d9',
        'metal',
        { segments: 8 },
      );
      add(
        'aviation-light',
        'sphere',
        [0, y + 1.02, 0],
        [0.09, 0.09, 0.09],
        '#ff4b3e',
        'light',
        { emissive: true },
      );
      return {
        top: y + 0.1,
        roof: {
          x: width * 0.25,
          z: depth * 0.25,
          w: width * 0.4,
          d: depth * 0.4,
        },
        front: (1.25 + fp * 0.22) / 2 + 0.15,
        width: 1.25 + fp * 0.22,
      };
    },
    pavilion() {
      // Stacked, offset rounded floors: a soft, product-like silhouette.
      const radius = 0.95 + fp * 0.14;
      const levels = 1 + Math.ceil(spec.tier * 0.75);
      add(
        'body',
        'cylinder',
        [0, BASE + 0.03, 0],
        [radius * 2 + 0.3, 0.06, radius * 2 + 0.3],
        '#e7e9e4',
        'concrete',
        { segments: 40 },
      );
      let y = BASE + 0.06;
      for (let level = 0; level < levels; level++) {
        const r = radius * (1 - level * 0.1);
        const shift = (level % 2 ? 0.12 : -0.08) * (rng() + 0.5);
        const on = lit();
        add(
          `window-${level}`,
          'cylinder',
          [shift, y + 0.25, -shift * 0.6],
          [r * 2 - 0.08, 0.44, r * 2 - 0.08],
          glass,
          'glass',
          { segments: 36, emissive: on },
        );
        add(
          `disc-${level}`,
          'cylinder',
          [shift, y + 0.5, -shift * 0.6],
          [r * 2 + 0.12, 0.07, r * 2 + 0.12],
          frame,
          'paint',
          { segments: 40 },
        );
        y += 0.52;
      }
      // Coloured canopy fins and a rooftop garden.
      for (let index = 0; index < 3; index++) {
        const angle = -0.6 + index * 0.6;
        add(
          `fin-${index}`,
          'box',
          [
            Math.sin(angle) * (radius + 0.12),
            BASE + 0.35,
            Math.cos(angle) * (radius + 0.12),
          ],
          [0.3, 0.62, 0.05],
          accent,
          'paint',
          { rotation: [0, angle, 0] },
        );
      }
      const r = radius * (1 - (levels - 1) * 0.1);
      add(
        'roof',
        'cylinder',
        [0, y + 0.02, 0],
        [r * 1.6, 0.05, r * 1.6],
        '#7fae6b',
        'foliage',
        { segments: 24 },
      );
      const garden: [number, number, number][] = [
        [-0.25, -0.2, 0.42],
        [0.2, -0.32, 0.32],
        [0.05, 0.25, 0.26],
      ];
      garden.forEach(([x, z, size], index) =>
        add(
          `garden-${index}`,
          'sphere',
          [x * r, y + 0.05 + size / 2, z * r],
          [size, size, size],
          '#5e9a5c',
          'foliage',
          { segments: 7 },
        ),
      );
      return {
        top: y + 0.05,
        roof: { x: 0.3 * r, z: 0.3 * r, w: r * 0.5, d: r * 0.4 },
        front: radius + 0.1,
        width: radius * 2,
      };
    },
    studio() {
      // A twisting stack with neon edges, beside a glass dome.
      const width = 1.2 + fp * 0.2;
      const floors = 2 + Math.round(spec.tier * 1.5) + (fp - 1);
      add(
        'body',
        'box',
        [0.2, BASE + 0.2, 0],
        [width + 0.9, 0.4, width + 0.4],
        frame,
        'paint',
      );
      pane(
        'lobby',
        [0.2, BASE + 0.2, width / 2 + 0.21],
        [width * 0.9, 0.3, 0.02],
      );
      let y = BASE + 0.4;
      for (let floor = 0; floor < floors; floor++) {
        const twist = floor * 0.11;
        add(
          `slab-${floor}`,
          'box',
          [0.2, y + 0.025, 0],
          [width + 0.06, 0.05, width + 0.06],
          frame,
          'paint',
          { rotation: [0, twist, 0] },
        );
        pane(
          `${floor}`,
          [0.2, y + 0.05 + 0.15, 0],
          [width - 0.04, 0.3, width - 0.04],
          { rotation: [0, twist, 0] },
        );
        if (floor % 2 === 0)
          add(
            `neon-${floor}`,
            'box',
            [0.2, y + 0.05, 0],
            [width + 0.1, 0.025, width + 0.1],
            accent,
            'light',
            { rotation: [0, twist, 0], emissive: glowing },
          );
        y += FLOOR;
      }
      add(
        'roof',
        'box',
        [0.2, y + 0.04, 0],
        [width + 0.06, 0.08, width + 0.06],
        frame,
        'paint',
        { rotation: [0, floors * 0.11, 0] },
      );
      add(
        'dome',
        'sphere',
        [-width / 2 - 0.25, BASE + 0.4, -0.2],
        [0.85, 0.85, 0.85],
        glass,
        'glass',
        { segments: 18 },
      );
      add(
        'dome-ring',
        'cylinder',
        [-width / 2 - 0.25, BASE + 0.42, -0.2],
        [0.9, 0.04, 0.9],
        accent,
        'light',
        { segments: 24, emissive: glowing },
      );
      return {
        top: y + 0.08,
        roof: { x: 0.2, z: 0, w: width * 0.5, d: width * 0.5 },
        front: width / 2 + 0.2,
        width: width + 0.9,
      };
    },
    laboratory() {
      const width = 2.2 + fp * 0.3;
      const depth = 1.6 + fp * 0.15;
      const floors = 1 + Math.ceil(spec.tier / 2);
      let y = BASE;
      for (let floor = 0; floor < floors; floor++) {
        add(
          floor === 0 ? 'body' : `level-${floor}`,
          'box',
          [0, y + FLOOR / 2 + 0.03, 0],
          [width, FLOOR + 0.06, depth],
          frame,
          'paint',
        );
        // Long ribbon windows, the lab look.
        pane(
          `front-${floor}`,
          [0, y + FLOOR / 2 + 0.05, depth / 2 + 0.005],
          [width - 0.3, 0.14, 0.02],
        );
        pane(
          `side-${floor}`,
          [width / 2 + 0.005, y + FLOOR / 2 + 0.05, 0],
          [0.02, 0.14, depth - 0.3],
        );
        y += FLOOR + 0.06;
      }
      add(
        'roof',
        'box',
        [0, y + 0.03, 0],
        [width + 0.06, 0.06, depth + 0.06],
        '#cfd6d4',
        'concrete',
      );
      // Sawtooth skylights and a radome.
      for (let index = 0; index < 3; index++)
        add(
          `skylight-${index}`,
          'prism',
          [-width * 0.3 + index * 0.32, y + 0.15, -depth * 0.12],
          [0.24, 0.18, depth * 0.55],
          glass,
          'glass',
        );
      add(
        'radome',
        'sphere',
        [width * 0.3, y + 0.32, -depth * 0.2],
        [0.5, 0.5, 0.5],
        '#f6f7f7',
        'paint',
        { segments: 14 },
      );
      add(
        'radome-base',
        'cylinder',
        [width * 0.3, y + 0.1, -depth * 0.2],
        [0.34, 0.14, 0.38],
        '#b9c2c0',
        'concrete',
        { segments: 12 },
      );
      add(
        'server-glow',
        'box',
        [width / 2 + 0.006, BASE + 0.08, 0],
        [0.02, 0.05, depth * 0.6],
        accent,
        'light',
        { emissive: glowing },
      );
      return {
        top: y + 0.06,
        roof: { x: 0, z: depth * 0.28, w: width * 0.45, d: depth * 0.3 },
        front: depth / 2,
        width,
      };
    },
    factory() {
      const width = 2.1 + fp * 0.3;
      const depth = 1.6 + fp * 0.2;
      const height = 0.55 + spec.tier * 0.14;
      add(
        'body',
        'box',
        [0, BASE + height / 2, 0],
        [width, height, depth],
        frame,
        'brick',
      );
      // Sawtooth north-light roof.
      const teeth = 3 + fp;
      for (let index = 0; index < teeth; index++) {
        const x = -width / 2 + (index + 0.5) * (width / teeth);
        add(
          `tooth-${index}`,
          'prism',
          [x, BASE + height + 0.13, 0],
          [width / teeth, 0.26, depth],
          frame,
          'brick',
        );
        pane(
          `tooth-${index}`,
          [x + width / teeth / 4, BASE + height + 0.13, 0],
          [0.02, 0.18, depth - 0.1],
          { rotation: [0, 0, -0.5] },
        );
      }
      add(
        'roof',
        'box',
        [0, BASE + height + 0.01, 0],
        [width + 0.04, 0.02, depth + 0.04],
        '#6e6a66',
        'concrete',
      );
      pane('door', [0.3, BASE + 0.22, depth / 2 + 0.01], [0.5, 0.4, 0.02]);
      add(
        'dock-stripe',
        'box',
        [0.3, BASE + 0.46, depth / 2 + 0.02],
        [0.56, 0.05, 0.02],
        accent,
        'paint',
      );
      // Chimney with bands, silos and a pipe run.
      const stack = 1.2 + spec.tier * 0.35;
      const chimney: Vec3 = [-width / 2 + 0.3, 0, -depth / 2 + 0.3];
      add(
        'chimney',
        'cylinder',
        [chimney[0], BASE + stack / 2, chimney[2]],
        [0.22, stack, 0.3],
        frame,
        'brick',
        { segments: 12 },
      );
      for (const band of [0.6, 0.85])
        add(
          `chimney-band-${band}`,
          'cylinder',
          [chimney[0], BASE + stack * band, chimney[2]],
          [0.29, 0.05, 0.29],
          '#e8e2d6',
          'paint',
          { segments: 12 },
        );
      const silos = Math.min(3, 1 + Math.floor(spec.tier / 2));
      for (let index = 0; index < silos; index++) {
        const x = width / 2 + 0.3;
        const z = -depth / 2 + 0.25 + index * 0.45;
        add(
          `silo-${index}`,
          'cylinder',
          [x, BASE + 0.5, z],
          [0.38, 1, 0.38],
          '#d9dcdf',
          'metal',
          { segments: 16 },
        );
        add(
          `silo-cap-${index}`,
          'cone',
          [x, BASE + 1.1, z],
          [0.4, 0.2, 0.4],
          '#aeb5ba',
          'metal',
          { segments: 16 },
        );
      }
      add(
        'pipe',
        'cylinder',
        [width / 2 + 0.05, BASE + 0.85, -depth / 2 + 0.25],
        [0.07, 0.5, 0.07],
        '#b8bfc4',
        'metal',
        { segments: 8, rotation: [0, 0, Math.PI / 2] },
      );
      return {
        top: BASE + height + 0.26,
        roof: { x: 0, z: depth * 0.2, w: width * 0.4, d: depth * 0.3 },
        front: depth / 2,
        width,
      };
    },
    townhouse() {
      const houses = 2 + (spec.tier >= 3 ? 1 : 0) + (fp > 1 ? 1 : 0);
      const unit = 0.72;
      const width = houses * unit;
      const depth = 1.35;
      const floors = Math.min(3, 1 + Math.ceil(spec.tier / 2));
      const colours = [...style.frame].sort(() => rng() - 0.5);
      let top = 0;
      for (let house = 0; house < houses; house++) {
        const x = -width / 2 + (house + 0.5) * unit;
        const levels = floors - (house % 2 && floors > 1 ? 1 : 0);
        const height = levels * FLOOR + 0.12;
        add(
          house === 0 ? 'body' : `house-${house}`,
          'box',
          [x, BASE + height / 2, 0],
          [unit - 0.02, height, depth],
          colours[house % colours.length]!,
          'paint',
        );
        add(
          house === 0 ? 'roof' : `gable-${house}`,
          'prism',
          [x, BASE + height + 0.2, 0],
          [unit + 0.06, 0.4, depth + 0.08],
          pick(style.accent),
          'paint',
        );
        add(
          `door-${house}`,
          'box',
          [x - 0.12, BASE + 0.15, depth / 2 + 0.01],
          [0.16, 0.28, 0.02],
          '#3d4a5c',
          'wood',
        );
        for (let level = 0; level < levels; level++) {
          pane(
            `${house}-${level}`,
            [
              x + (level === 0 ? 0.13 : 0),
              BASE + 0.2 + level * FLOOR,
              depth / 2 + 0.01,
            ],
            [level === 0 ? 0.22 : 0.4, 0.2, 0.02],
          );
          if (level > 0)
            add(
              `balcony-${house}-${level}`,
              'box',
              [x, BASE + 0.08 + level * FLOOR, depth / 2 + 0.08],
              [0.46, 0.03, 0.14],
              '#4a525c',
              'metal',
            );
        }
        if (house % 2 === 0)
          add(
            `chimney-${house}`,
            'box',
            [x + 0.18, BASE + height + 0.35, -0.2],
            [0.1, 0.3, 0.1],
            '#9b6b55',
            'brick',
          );
        top = Math.max(top, BASE + height);
      }
      return {
        top,
        roof: { x: 0, z: -depth * 0.3, w: 0, d: 0 },
        front: depth / 2,
        width,
      };
    },
    library() {
      const width = 2.0 + fp * 0.3;
      const depth = 1.5 + fp * 0.15;
      const height = 0.7 + spec.tier * 0.18;
      // Stepped podium, colonnade in front of a glass hall, green roof.
      for (let step = 0; step < 3; step++)
        add(
          step === 0 ? 'body' : `step-${step}`,
          'box',
          [0, BASE + 0.04 + step * 0.06, 0.1 - step * 0.03],
          [width + 0.4 - step * 0.12, 0.06, depth + 0.5 - step * 0.12],
          '#e2dccd',
          'concrete',
        );
      const floor = BASE + 0.18;
      add(
        'hall-back',
        'box',
        [0, floor + height / 2, -0.15],
        [width - 0.1, height, depth - 0.5],
        frame,
        'paint',
      );
      pane(
        'hall',
        [0, floor + height / 2, depth / 2 - 0.3],
        [width - 0.3, height - 0.05, 0.03],
      );
      const columns = 4 + Math.min(3, spec.tier);
      for (let index = 0; index < columns; index++)
        add(
          `column-${index}`,
          'cylinder',
          [
            -width / 2 + 0.15 + (index * (width - 0.3)) / (columns - 1),
            floor + height / 2,
            depth / 2 - 0.08,
          ],
          [0.1, height, 0.12],
          frame,
          'paint',
          { segments: 10 },
        );
      add(
        'entablature',
        'box',
        [0, floor + height + 0.06, -0.02],
        [width + 0.1, 0.12, depth - 0.1],
        frame,
        'paint',
      );
      add(
        'roof',
        'box',
        [0, floor + height + 0.15, -0.05],
        [width - 0.1, 0.06, depth - 0.25],
        '#7fae6b',
        'foliage',
      );
      if (spec.tier >= 3)
        pane(
          'reading-room',
          [width * 0.18, floor + height + 0.36, -depth * 0.15],
          [width * 0.4, 0.36, depth * 0.4],
        );
      return {
        top: floor + height + 0.18,
        roof: { x: -width * 0.25, z: 0, w: width * 0.3, d: depth * 0.35 },
        front: depth / 2 + 0.2,
        width,
      };
    },
  };

  const { top, roof, front, width } = builders[spec.archetype]();

  // Construction: cut the building at the stage it has reached.
  const progress =
    maturity === 'prototype' ? 0.42 : maturity === 'developing' ? 0.74 : 1;
  if (progress < 1) {
    const cut = BASE + (top - BASE) * progress;
    for (let index = parts.length - 1; index >= 0; index--) {
      const part = parts[index]!;
      if (part.id === 'foundation') continue;
      const height = part.shape === 'sphere' ? part.size[0] : part.size[1];
      const bottom = part.position[1] - height / 2;
      const tilted = part.rotation && (part.rotation[0] || part.rotation[2]);
      if (bottom >= cut - 0.02) parts.splice(index, 1);
      else if (
        bottom + height > cut &&
        !tilted &&
        (part.shape === 'box' || part.shape === 'cylinder')
      ) {
        // Trim to the cut, as if the floors above are not built yet.
        const kept = cut - bottom;
        part.size = [part.size[0], kept, part.size[2]];
        part.position = [part.position[0], bottom + kept / 2, part.position[2]];
      }
    }
    // Bare concrete deck and rebar where the next floor will go.
    const deck = Math.min(width, 2.2);
    add(
      'deck',
      'box',
      [0, cut + 0.02, 0],
      [deck * 0.85, 0.04, Math.min(front * 2, 2) * 0.75],
      '#bfc3c4',
      'concrete',
    );
    const corners: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    corners.forEach(([x, z], index) =>
      add(
        `rebar-${index}`,
        'box',
        [(x * deck) / 3, cut + 0.25, (z * front) / 2],
        [0.03, 0.45, 0.03],
        '#8a7a6b',
        'metal',
      ),
    );
    // Scaffolding all round on a prototype, on one side while it is developing.
    const sides = maturity === 'prototype' ? [-1, 1] : [1];
    const scaffold = cut + 0.3;
    for (const side of sides) {
      const x = side * (width / 2 + 0.16);
      for (const end of [-1, 1])
        add(
          `scaffold-pole-${side}-${end}`,
          'box',
          [x, scaffold / 2 + 0.1, end * (front + 0.1)],
          [0.04, scaffold, 0.04],
          '#d9a441',
          'metal',
        );
      for (let level = 1; level * 0.4 < scaffold; level++)
        add(
          `scaffold-plank-${side}-${level}`,
          'box',
          [x, 0.1 + level * 0.4, 0],
          [0.14, 0.03, front * 2 + 0.3],
          '#a88550',
          'wood',
        );
      add(
        `scaffold-net-${side}`,
        'box',
        [x + side * 0.08, scaffold / 2 + 0.2, 0],
        [0.01, scaffold * 0.7, front * 2],
        '#4f9d69',
        'paint',
      );
    }
    if (maturity === 'prototype') {
      const craneX = -width / 2 - 0.6;
      const mast = top + 1.2;
      add(
        'crane-mast',
        'box',
        [craneX, mast / 2 + 0.2, -0.4],
        [0.12, mast, 0.12],
        '#f2b134',
        'metal',
      );
      add(
        'crane-jib',
        'box',
        [craneX + 0.9, mast + 0.2, -0.4],
        [2.4, 0.08, 0.08],
        '#f2b134',
        'metal',
      );
      add(
        'crane-cab',
        'box',
        [craneX + 0.08, mast + 0.05, -0.4],
        [0.18, 0.16, 0.16],
        '#e8e4da',
        'paint',
      );
      add(
        'crane-counterweight',
        'box',
        [craneX - 0.4, mast + 0.12, -0.4],
        [0.32, 0.2, 0.2],
        '#6b6f73',
        'concrete',
      );
      add(
        'crane-cable',
        'box',
        [craneX + 1.7, mast - 0.35, -0.4],
        [0.015, 1.1, 0.015],
        '#3c3f42',
        'metal',
      );
      add(
        'crane-load',
        'box',
        [craneX + 1.7, mast - 0.95, -0.4],
        [0.3, 0.12, 0.2],
        '#a88550',
        'wood',
      );
    }
    // Site fence and material pallets.
    add(
      'site-fence',
      'box',
      [0, 0.32, front + 0.32],
      [width + 0.4, 0.24, 0.03],
      '#f2b134',
      'paint',
    );
    add(
      'pallet',
      'box',
      [width / 2 - 0.2, 0.28, front + 0.12],
      [0.3, 0.16, 0.22],
      '#b9a98a',
      'wood',
    );
  }

  // Capability modules. Roof modules only appear on finished buildings.
  const finished = progress === 1;
  const has = (module: BuildingSpec['modules'][number]) =>
    spec.modules.includes(module);
  if (has('tests'))
    for (const side of [-1, 1]) {
      add(
        `frame-${side}`,
        'box',
        [side * 0.5, 0.45, front + 0.42],
        [0.06, 0.5, 0.06],
        '#3c4450',
        'metal',
      );
      add(
        `frame-light-${side}`,
        'box',
        [side * 0.5, 0.72, front + 0.42],
        [0.09, 0.06, 0.09],
        '#58d68d',
        'light',
        { emissive: true },
      );
    }
  if (has('ci') && finished) {
    const [x, z] = [roof.x + roof.w / 2, roof.z - roof.d / 2];
    add(
      'antenna',
      'box',
      [x, top + 0.45, z],
      [0.04, 0.9, 0.04],
      '#4b5563',
      'metal',
    );
    add(
      'beacon',
      'sphere',
      [x, top + 0.92, z],
      [0.1, 0.1, 0.1],
      '#f2b134',
      'light',
      { emissive: true },
    );
  }
  if (has('docs'))
    add(
      'sign',
      'box',
      [0, 0.85, front + 0.06],
      [0.8, 0.16, 0.04],
      '#fdf6e3',
      'light',
      { emissive: glowing },
    );
  if (has('container'))
    ['#e76f51', '#3d7ea6'].forEach((colour, index) =>
      add(
        `container-${index}`,
        'box',
        [-width / 2 - 0.35, 0.36 + index * 0.27, front - 0.2 - index * 0.05],
        [0.32, 0.26, 0.7],
        colour,
        'metal',
      ),
    );
  if (has('lint') && finished && roof.w > 0)
    for (const side of [-1, 1])
      add(
        `solar-${side}`,
        'box',
        [roof.x + (side * roof.w) / 4, top + 0.1, roof.z],
        [roof.w * 0.42, 0.03, roof.d * 0.8],
        '#2c3e66',
        'metal',
        { rotation: [-0.35, 0, 0] },
      );
  if (has('deploy') && finished && roof.w > 0) {
    const pad = Math.min(roof.w, roof.d) * 0.9;
    add(
      'helipad',
      'cylinder',
      [roof.x, top + 0.03, roof.z],
      [pad, 0.04, pad],
      '#3a3f47',
      'concrete',
      { segments: 24 },
    );
    add(
      'helipad-mark',
      'box',
      [roof.x, top + 0.06, roof.z],
      [0.06, 0.01, pad * 0.55],
      '#f2f2f2',
      'light',
      { emissive: true },
    );
  }
  if (has('e2e')) {
    add(
      'test-annex',
      'box',
      [-width / 2 - 0.1, 0.45, -0.75],
      [0.55, 0.5, 0.55],
      frame,
      'paint',
    );
    pane('annex', [-width / 2 - 0.1, 0.5, -0.47], [0.4, 0.2, 0.02]);
  }
  if (has('release')) {
    add(
      'flag-pole',
      'cylinder',
      [width / 2 + 0.3, 0.75, front + 0.2],
      [0.03, 1.1, 0.03],
      '#c9d1d9',
      'metal',
      { segments: 6 },
    );
    add(
      'flag',
      'box',
      [width / 2 + 0.47, 1.18, front + 0.2],
      [0.3, 0.18, 0.01],
      accent,
      'paint',
    );
  }
  if (maturity === 'production') {
    // A finished landmark: lit crown and landscaping at the entrance.
    if (roof.w > 0)
      add(
        'crown',
        'box',
        [roof.x, top + 0.015, roof.z],
        [Math.max(roof.w, 0.4), 0.03, Math.max(roof.d, 0.3)],
        glowing ? '#fff1c4' : '#6b7480',
        'light',
        { emissive: glowing },
      );
    for (const side of [-1, 1]) {
      add(
        `planter-${side}`,
        'box',
        [side * (width / 2 - 0.05), 0.3, front + 0.45],
        [0.3, 0.16, 0.3],
        '#cfc6b4',
        'concrete',
      );
      add(
        `shrub-${side}`,
        'sphere',
        [side * (width / 2 - 0.05), 0.48, front + 0.45],
        [0.3, 0.3, 0.3],
        '#5e9a5c',
        'foliage',
        { segments: 6 },
      );
    }
  }
  return parts;
}

export { gridColumns, layoutDistricts, PLOT_SPACING } from './layout';
export type { PlotPosition } from './layout';
