// The character (ARCHITECTURE.md §5.2): a small, chunky rounded-square body in deep charcoal with
// a violet rim and inner glow, two pill "screen" eyes, a soft shadow so it sits on the desktop,
// and stubby arms that only show when it gestures. Drawn as one SVG, built once; each frame only
// updates attributes. No CSS animations: the engine's loop is the only thing that moves it.
import type { AvatarRenderer } from './engine';
import type { Effect, EyeShape } from './poses';
import type { Frame } from './tween';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 140;
/** The body pivots at its feet, so squash looks like sitting down rather than shrinking. */
const PIVOT = { x: 70, y: 118 };
const EYES = [
  { x: 56, y: 68 },
  { x: 84, y: 68 },
];
const MOUTH_Y = 89;

const VIOLET = [167, 139, 250];
const ALARM = [248, 113, 113];
const EYE = [196, 181, 253];
const EYE_ALARM = [254, 202, 202];

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  set(node, attrs);
  parent?.appendChild(node);
  return node;
}

function set(node: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
}

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t));
  return `rgb(${c.join(' ')})`;
}

const f = (n: number) => n.toFixed(2);

export class SvgRig implements AvatarRenderer {
  readonly svg: SVGSVGElement;
  private readonly parts;

  constructor(container: HTMLElement) {
    const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, class: 'rig' });
    const defs = el('defs', {}, svg);

    const glowGrad = el('radialGradient', { id: 'eb-glow' }, defs);
    const glowStop = el('stop', { offset: 0, 'stop-opacity': 0.55 }, glowGrad);
    el('stop', { offset: 1, 'stop-opacity': 0 }, glowGrad);
    const glowStopEnd = glowGrad.lastElementChild as SVGStopElement;

    const bodyGrad = el('linearGradient', { id: 'eb-body', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': '#272036' }, bodyGrad);
    el('stop', { offset: 1, 'stop-color': '#14111c' }, bodyGrad);

    const innerGrad = el('radialGradient', { id: 'eb-inner', cx: 0.5, cy: 1, r: 0.9 }, defs);
    const innerStop = el('stop', { offset: 0, 'stop-opacity': 0.45 }, innerGrad);
    el('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0 }, innerGrad);

    // The faint pixel-grid texture: one 1 px dot every 4 px.
    const grid = el('pattern', { id: 'eb-grid', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { x: 1, y: 1, width: 1, height: 1, fill: '#fff', 'fill-opacity': 0.05 }, grid);

    const shadow = el('ellipse', { cx: 70, cy: 125, rx: 32, ry: 5, fill: '#000' }, svg);
    const glow = el('ellipse', { cx: 70, cy: 76, rx: 60, ry: 54, fill: 'url(#eb-glow)' }, svg);

    // Only the body itself is "solid": the cursor over it makes the window clickable and draggable.
    const body = el('g', { 'data-hit': '', 'data-drag': '' }, svg);
    const feet = el('g', {}, body);
    for (const x of [50, 76]) el('rect', { x, y: 108, width: 14, height: 11, rx: 5, fill: '#1b1726' }, feet);

    const arms = EYES.map((_, i) => {
      const side = i === 0 ? -1 : 1;
      const g = el('g', {}, body);
      el(
        'rect',
        { x: side < 0 ? -15 : 1, y: -5, width: 14, height: 10, rx: 5, fill: '#1f1a2c', 'stroke-width': 1.5 },
        g,
      );
      return { g, side, shape: g.firstElementChild as SVGRectElement };
    });

    const bodyShape = { x: 28, y: 34, width: 84, height: 80, rx: 24 };
    const shell = el('rect', { ...bodyShape, fill: 'url(#eb-body)', 'stroke-width': 2.2 }, body);
    const inner = el('rect', { ...bodyShape, fill: 'url(#eb-inner)' }, body);
    el('rect', { ...bodyShape, fill: 'url(#eb-grid)' }, body);
    // The "screen" the face lives on: a slightly darker inset panel.
    el('rect', { x: 38, y: 50, width: 64, height: 50, rx: 14, fill: '#0e0c14', 'fill-opacity': 0.55 }, body);

    const face = el('g', {}, body);
    const eyes = EYES.map((pos) => {
      const g = el('g', {}, face);
      const shapes: Record<EyeShape, SVGElement> = {
        pill: el('rect', { x: -5, y: -10, width: 10, height: 20, rx: 5 }, g),
        happy: el(
          'path',
          { d: 'M -6.5 3 Q 0 -6 6.5 3', fill: 'none', 'stroke-width': 3.6, 'stroke-linecap': 'round' },
          g,
        ),
        x: el(
          'path',
          { d: 'M -5 -5 L 5 5 M 5 -5 L -5 5', fill: 'none', 'stroke-width': 3.2, 'stroke-linecap': 'round' },
          g,
        ),
        closed: el(
          'path',
          { d: 'M -6 0 Q 0 4 6 0', fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' },
          g,
        ),
      };
      return { g, pos, shapes };
    });
    const mouth = el(
      'path',
      { 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', fill: '#2b2045' },
      face,
    );

    const effects = this.buildEffects(svg);

    container.appendChild(svg);
    this.svg = svg;
    this.parts = {
      glowStop,
      glowStopEnd,
      innerStop,
      shadow,
      glow,
      body,
      arms,
      shell,
      inner,
      eyes,
      mouth,
      effects,
    };
  }

  render(fr: Frame, time: number): void {
    const p = this.parts;
    const rim = mix(VIOLET, ALARM, fr.alarm);
    const eyeColor = mix(EYE, EYE_ALARM, fr.alarm);

    p.glowStop.setAttribute('stop-color', rim);
    p.glowStopEnd.setAttribute('stop-color', rim);
    p.innerStop.setAttribute('stop-color', rim);
    p.glow.setAttribute('opacity', f(fr.glow));
    p.inner.setAttribute('opacity', f(0.4 + fr.glow * 0.6));
    p.shell.setAttribute('stroke', rim);

    // Squash and stretch: height by `squash` (plus the state-change impulse), width compensates.
    const sy = fr.squash - fr.impulse * 0.07;
    const sx = 1 + (1 - sy) * 0.8;
    set(p.body, {
      transform: `translate(0 ${f(fr.bodyY)}) translate(${PIVOT.x} ${PIVOT.y}) rotate(${f(fr.tilt)}) scale(${f(sx)} ${f(sy)}) translate(${-PIVOT.x} ${-PIVOT.y})`,
    });
    // The shadow shrinks and fades as the body lifts.
    const lift = Math.max(0, -fr.bodyY);
    set(p.shadow, { rx: f(32 - lift * 1.2), opacity: f(0.32 - lift * 0.02) });

    for (const arm of p.arms) {
      const x = arm.side < 0 ? 31 + (1 - fr.arms) * 8 : 109 - (1 - fr.arms) * 8;
      // SVG rotates clockwise, so raising the hand is +angle on the left arm, -angle on the right.
      const raise = arm.side < 0 ? fr.armRaise : -fr.armRaise;
      set(arm.g, { transform: `translate(${f(x)} 84) rotate(${f(raise)})`, opacity: f(fr.arms) });
      arm.shape.setAttribute('stroke', rim);
    }

    for (const eye of p.eyes) {
      set(eye.g, {
        transform: `translate(${f(eye.pos.x + fr.lookX)} ${f(eye.pos.y + fr.lookY)}) scale(1 ${f(fr.eyes === 'pill' ? Math.max(0.08, fr.eyeOpen) : 1)})`,
      });
      for (const [shape, node] of Object.entries(eye.shapes) as Array<[EyeShape, SVGElement]>) {
        node.setAttribute('visibility', shape === fr.eyes ? 'visible' : 'hidden');
        node.setAttribute(shape === 'pill' ? 'fill' : 'stroke', eyeColor);
      }
    }

    const half = fr.mouthWidth / 2;
    const x0 = 70 + fr.lookX * 0.5;
    const y = MOUTH_Y + fr.lookY * 0.4;
    const curve = fr.mouthCurve * 7;
    const open = Math.max(0, fr.mouthOpen) * 11;
    p.mouth.setAttribute(
      'd',
      `M ${f(x0 - half)} ${f(y)} Q ${f(x0)} ${f(y + curve)} ${f(x0 + half)} ${f(y)} Q ${f(x0)} ${f(y + curve + open)} ${f(x0 - half)} ${f(y)} Z`,
    );
    p.mouth.setAttribute('stroke', eyeColor);

    this.renderEffects(fr.effect, fr.effectAlpha, time, rim, eyeColor);
  }

  dispose(): void {
    this.svg.remove();
  }

  // --- effect layer ----------------------------------------------------------------------------

  private buildEffects(svg: SVGSVGElement) {
    const root = el('g', {}, svg);
    const layer = (attrs: Attrs = {}) => el('g', { visibility: 'hidden', ...attrs }, root);

    const dots = layer({ transform: 'translate(104 30)' });
    const dotNodes = [0, 1, 2].map((i) => el('circle', { cx: i * 8, cy: 0, r: 2.8 }, dots));

    const sparkles = layer();
    const star = 'M 0 -6 Q 0.8 -0.8 6 0 Q 0.8 0.8 0 6 Q -0.8 0.8 -6 0 Q -0.8 -0.8 0 -6 Z';
    const sparkleNodes = [
      { x: 22, y: 34, phase: 0 },
      { x: 118, y: 28, phase: 2.1 },
      { x: 120, y: 70, phase: 4.2 },
    ].map((s) => ({ ...s, node: el('path', { d: star }, sparkles) }));

    const question = layer({ transform: 'translate(108 36)' });
    const questionText = el(
      'text',
      { 'font-size': 24, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'Segoe UI, sans-serif' },
      question,
    );
    questionText.textContent = '?';

    const alert = layer({ transform: 'translate(110 36)' });
    const alertText = el(
      'text',
      { 'font-size': 26, 'font-weight': 800, 'text-anchor': 'middle', 'font-family': 'Segoe UI, sans-serif' },
      alert,
    );
    alertText.textContent = '!';

    const zzz = layer();
    const zNodes = [0, 1, 2].map(() => {
      const t = el(
        'text',
        { 'font-size': 12, 'font-weight': 700, 'font-family': 'Cascadia Code, Consolas, monospace' },
        zzz,
      );
      t.textContent = 'z';
      return t;
    });

    const gear = layer();
    const gearPath = el('path', { d: gearShape(7, 9.5, 8), 'fill-rule': 'evenodd' }, gear);

    const layers: Record<Exclude<Effect, 'none'>, SVGGElement> = {
      dots,
      sparkles,
      question,
      alert,
      zzz,
      gear,
    };
    return { layers, dotNodes, sparkleNodes, questionText, alertText, zNodes, gearPath };
  }

  private renderEffects(effect: Effect, alpha: number, time: number, rim: string, light: string): void {
    const e = this.parts.effects;
    for (const [name, g] of Object.entries(e.layers)) {
      const on = name === effect;
      g.setAttribute('visibility', on ? 'visible' : 'hidden');
      if (on) g.setAttribute('opacity', f(alpha));
    }

    switch (effect) {
      case 'dots':
        e.dotNodes.forEach((d, i) => {
          const pulse = (Math.sin(time * 5 - i * 0.9) + 1) / 2;
          set(d, { fill: light, opacity: f(0.25 + pulse * 0.75), cy: f(-pulse * 2) });
        });
        break;
      case 'sparkles':
        for (const s of e.sparkleNodes) {
          const k = (Math.sin(time * 4 + s.phase) + 1) / 2;
          set(s.node, {
            fill: light,
            transform: `translate(${s.x} ${s.y}) scale(${f(0.4 + k * 0.7)}) rotate(${f(time * 40)})`,
            opacity: f(0.35 + k * 0.65),
          });
        }
        break;
      case 'question':
        set(e.questionText, { fill: light, transform: `rotate(${f(Math.sin(time * 2.5) * 10)})` });
        break;
      case 'alert':
        set(e.alertText, { fill: rim, transform: `scale(${f(1 + Math.max(0, Math.sin(time * 6)) * 0.12)})` });
        break;
      case 'zzz':
        e.zNodes.forEach((z, i) => {
          // Each z drifts up and to the right, then starts again, staggered.
          const k = (time * 0.35 + i / 3) % 1;
          set(z, {
            fill: light,
            x: f(96 + k * 22),
            y: f(44 - k * 28),
            opacity: f(Math.sin(k * Math.PI)),
            'font-size': f(9 + k * 7),
          });
        });
        break;
      case 'gear':
        set(e.gearPath, { fill: rim, transform: `translate(112 30) rotate(${f(time * 90)})` });
        break;
      case 'none':
        break;
    }
  }
}

/** A gear outline centred on 0,0: `teeth` teeth between radii r and R, with a hole. */
function gearShape(r: number, R: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [da, rad] of [
      [0, r],
      [step * 0.15, R],
      [step * 0.45, R],
      [step * 0.6, r],
    ] as const) {
      pts.push(`${f(Math.cos(a + da) * rad)} ${f(Math.sin(a + da) * rad)}`);
    }
  }
  const hole = 3;
  return `M ${pts.join(' L ')} Z M ${hole} 0 A ${hole} ${hole} 0 1 0 ${-hole} 0 A ${hole} ${hole} 0 1 0 ${hole} 0 Z`;
}
