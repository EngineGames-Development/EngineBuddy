// Mouse handling for the transparent avatar window: per-pixel click-through, custom drag and
// Ctrl+scroll scaling (ARCHITECTURE.md §8.1). Framework-free; works on `data-*` markers in the DOM:
//
//   [data-hit]   the cursor over this element makes the window clickable (avatar, bubble)
//   [data-drag]  pressing here and moving drags the window (the avatar)
//
// The window starts click-through with mouse-move forwarding (main does that), so `mousemove`
// keeps arriving even while clicks fall through to whatever is underneath.

/** Moving less than this between press and release is a click, not a drag. */
const DRAG_THRESHOLD = 3;

export interface InteractionHandlers {
  /** The avatar was clicked (pressed and released without dragging). */
  onAvatarClick?(event: PointerEvent): void;
}

export function installWindowInteraction(handlers: InteractionHandlers = {}): () => void {
  const api = window.buddy.window;
  let clickThrough = true;

  const setClickThrough = (value: boolean) => {
    if (value === clickThrough) return;
    clickThrough = value;
    api.setClickThrough(value);
  };

  const hitTest = (x: number, y: number) => {
    // While dragging, pointer capture keeps the window interactive no matter where the cursor is.
    if (drag) return;
    setClickThrough(!document.elementFromPoint(x, y)?.closest('[data-hit]'));
  };

  const onMouseMove = (e: MouseEvent) => hitTest(e.clientX, e.clientY);
  const onMouseLeave = () => {
    if (!drag) setClickThrough(true);
  };

  // --- drag ------------------------------------------------------------------------------------
  let drag: { pointerId: number; lastX: number; lastY: number; moved: number } | undefined;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !(e.target as Element | null)?.closest('[data-drag]')) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, lastX: e.screenX, lastY: e.screenY, moved: 0 };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = Math.round(e.screenX - drag.lastX);
    const dy = Math.round(e.screenY - drag.lastY);
    if (dx === 0 && dy === 0) return;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    // Below the threshold it may still be a click, so don't move the window yet.
    if (drag.moved < DRAG_THRESHOLD) return;
    drag.lastX += dx;
    drag.lastY += dy;
    api.moveBy(dx, dy);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved >= DRAG_THRESHOLD;
    drag = undefined;
    if (wasDrag) api.dragEnd();
    else handlers.onAvatarClick?.(e);
    hitTest(e.clientX, e.clientY);
  };

  const onPointerCancel = () => {
    if (drag && drag.moved >= DRAG_THRESHOLD) api.dragEnd();
    drag = undefined;
  };

  // --- Ctrl+scroll scale -----------------------------------------------------------------------
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    // Always swallow Ctrl+wheel: otherwise Chromium zooms the page instead.
    e.preventDefault();
    if (!(e.target as Element | null)?.closest('[data-drag]') || e.deltaY === 0) return;
    api.scaleBy(e.deltaY < 0 ? 1 : -1);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseleave', onMouseLeave);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseleave', onMouseLeave);
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('wheel', onWheel);
  };
}
