// AvatarEngine (ARCHITECTURE.md §5.1): one animation loop that tweens the rig between state poses,
// plays each state's loop, and adds idle life (blinks, glances). It throttles itself when nothing
// fast is happening, and stops while the window is hidden, because it runs all day.
import type { AvatarState } from '../../shared/avatar';
import { isCalm, loopFor, poseFor, type Pose } from './poses';
import { addOffsets, blend, frameToPose, type Frame } from './tween';

/** Draws frames. The SVG rig is one; a Rive or sprite renderer could replace it. */
export interface AvatarRenderer {
  render(frame: Frame, time: number): void;
  dispose(): void;
}

const TRANSITION_MS = 220;
const BLINK_MS = 150;
/** Calm states (IDLE, SLEEPING, ...) with nothing else moving are drawn at this rate. */
const CALM_FPS = 6;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class AvatarEngine {
  private state: AvatarState = 'IDLE';
  private from: Pose = poseFor('IDLE');
  private to: Pose = poseFor('IDLE');
  private transitionStart = -Infinity;
  private stateStart = 0;
  private current: Frame;

  private blinkStart = -Infinity;
  private nextBlink = 0;
  private glance = { x: 0, y: 0 };
  private glanceTarget = { x: 0, y: 0 };
  private nextGlance = 0;

  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(
    private readonly renderer: AvatarRenderer,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.current = blend(this.from, this.to, 1);
    const t = now();
    this.nextBlink = t + rand(1500, 4000);
    this.nextGlance = t + rand(4000, 8000);
  }

  get currentState(): AvatarState {
    return this.state;
  }

  setState(state: AvatarState): void {
    if (state === this.state) return;
    const t = this.now();
    // Start from wherever the avatar is right now, so an interrupted transition doesn't jump.
    this.from = frameToPose(this.current);
    this.to = poseFor(state);
    this.state = state;
    this.transitionStart = t;
    this.stateStart = t;
    this.wake();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.wake();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.cancel();
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }

  private onVisibility = () => this.wake();

  /** Draw a frame now and keep the loop going (if visible). */
  private wake(): void {
    if (!this.running) return;
    this.cancel();
    this.tick();
  }

  private cancel(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
  }

  private tick = (): void => {
    if (!this.running || document.hidden) return;
    const t = this.now();

    const transitionT = (t - this.transitionStart) / TRANSITION_MS;
    let frame = blend(this.from, this.to, transitionT);
    frame = addOffsets(frame, loopFor(this.state, (t - this.stateStart) / 1000));
    const blinking = this.applyBlink(frame, t);
    const glancing = this.applyGlance(frame, t);

    this.current = frame;
    this.renderer.render(frame, t / 1000);

    const busy = transitionT < 1 || blinking || glancing || !isCalm(this.state);
    if (busy) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      // Sleep until the next frame worth drawing: a calm loop step, or the next blink/glance.
      const until = Math.min(1000 / CALM_FPS, this.nextBlink - t, this.nextGlance - t);
      this.timer = setTimeout(() => (this.raf = requestAnimationFrame(this.tick)), Math.max(16, until));
    }
  };

  /** Blinks every few seconds (sometimes twice) when the eyes are open pills. */
  private applyBlink(frame: Frame, t: number): boolean {
    if (t >= this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + (Math.random() < 0.2 ? 260 : rand(2500, 6000));
    }
    const k = (t - this.blinkStart) / BLINK_MS;
    if (k >= 1 || frame.eyes !== 'pill') return false;
    frame.eyeOpen *= Math.abs(1 - 2 * k);
    return true;
  }

  /** In IDLE, now and then look somewhere else for a moment. */
  private applyGlance(frame: Frame, t: number): boolean {
    if (t >= this.nextGlance) {
      const look = this.state === 'IDLE' && Math.random() < 0.6;
      this.glanceTarget = look ? { x: rand(-4, 4), y: rand(-2.5, 1.5) } : { x: 0, y: 0 };
      this.nextGlance = t + (look ? rand(900, 2000) : rand(3500, 8000));
    }
    if (this.state !== 'IDLE') this.glanceTarget = { x: 0, y: 0 };
    this.glance.x += (this.glanceTarget.x - this.glance.x) * 0.25;
    this.glance.y += (this.glanceTarget.y - this.glance.y) * 0.25;
    frame.lookX += this.glance.x;
    frame.lookY += this.glance.y;
    return (
      Math.abs(this.glanceTarget.x - this.glance.x) + Math.abs(this.glanceTarget.y - this.glance.y) > 0.05
    );
  }
}
