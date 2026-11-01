import { useEffect, useRef } from 'react';
import { AVATAR_STATES, type AvatarState } from '../../shared/avatar';
import { AvatarEngine } from './engine';
import { onSay } from './greeting';
import { reactionFor } from './reactions';
import { SvgRig } from './rig';
import { AvatarStateMachine } from './state-machine';

/**
 * The character. React only mounts it: the engine owns the SVG and its animation loop, and
 * BuddyEvents drive it through the reactions table and the state machine.
 */
export function Avatar() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const engine = new AvatarEngine(new SvgRig(host.current));
    const machine = new AvatarStateMachine((state) => {
      engine.setState(state);
      host.current?.setAttribute('data-state', state);
    });
    engine.start();

    // Local lines (the greeting): wave on the first, talk on the rest.
    const unsubscribeSay = onSay(({ first }) =>
      machine.apply({ state: first ? 'EXCITED' : 'TALKING', priority: 1, hold: first ? 1300 : 1100 }),
    );

    const unsubscribe = window.buddy.onEvent((event) => {
      if (event.type === 'mode_changed') return machine.setMode(event.mode);
      const reaction = reactionFor(event);
      if (reaction) machine.apply(reaction);
    });

    // Ctrl+Alt+D (window focused, e.g. after clicking the avatar) cycles through every state,
    // then back to normal. A debug aid for checking the art.
    let debugIndex = -1;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey && e.code === 'KeyD')) return;
      debugIndex = debugIndex + 1 < AVATAR_STATES.length ? debugIndex + 1 : -1;
      const state: AvatarState | undefined = AVATAR_STATES[debugIndex];
      machine.setOverride(state);
      console.info(`[avatar] debug state: ${state ?? '(off)'}`);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      unsubscribe();
      unsubscribeSay();
      machine.dispose();
      engine.dispose();
    };
  }, []);

  return <div ref={host} className="avatar" title="EngineBuddy" />;
}
