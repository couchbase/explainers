// Map-style navigation of the diagram. Plain scrolling always drives
// the story, so zooming needs a modifier: ⌘, Ctrl or ⌥ + scroll (a
// trackpad pinch arrives as Ctrl + scroll in Chrome and Firefox; Safari
// sends gesture events). Drag pans; double-click zooms in, ⌥/Shift +
// double-click zooms out; on touchscreens, two fingers pinch and pan.

const clampFactor = (f) => Math.max(0.7, Math.min(1.45, f));

export function bindGestures(viewport, camera) {
  viewport.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const k = Math.abs(dy) < 20 ? 0.012 : 0.0025; // pinches send small deltas; wheel notches ~100
    camera.zoomAt(clampFactor(Math.exp(-dy * k)), e.clientX, e.clientY);
  }, { passive: false });

  let gestureScale = 1;
  viewport.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
  viewport.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    camera.zoomAt(clampFactor(e.scale / gestureScale), e.clientX, e.clientY);
    gestureScale = e.scale;
  });
  viewport.addEventListener('gestureend', (e) => e.preventDefault());

  viewport.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    camera.zoomAt(e.altKey || e.shiftKey ? 1 / 1.6 : 1.6, e.clientX, e.clientY);
  });

  const pointers = new Map(); // pointerId -> {x, y}
  let drag = null, pinch = null;
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch') {
      // one finger scrolls the page; two fingers pinch and pan the diagram
      if (pointers.size === 2) { pinch = pinchState(); viewport.setPointerCapture(e.pointerId); }
      return;
    }
    drag = { x: e.clientX, y: e.clientY };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const now = pinchState();
      if (pinch.d > 0) camera.zoomAt(clampFactor(now.d / pinch.d), now.x, now.y);
      camera.panBy(now.x - pinch.x, now.y - pinch.y);
      pinch = now;
      return;
    }
    if (!drag) return;
    camera.panBy(e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; viewport.classList.remove('dragging'); }
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
}
