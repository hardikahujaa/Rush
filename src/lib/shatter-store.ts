/**
 * Shatter state for the particle ring.
 *
 * ── WHY A MODULE STORE AND NOT REACT CONTEXT ───────────────────────────────
 * The trigger (the Categories button) lives in the navbar, which is rendered by
 * the (site) layout. The canvas lives in the hero, which is rendered by the
 * page. Their only common ancestor is a SERVER component, so it cannot hold
 * useState.
 *
 * The obvious fix is a client Context provider wrapping both. That works, but a
 * context holding hover state re-renders every consumer on mouseenter and
 * mouseleave - the navbar, the hero, and everything between them - to move a
 * boolean that only a canvas animation loop ever reads.
 *
 * A module-level store sidesteps React entirely. The button writes; the canvas
 * reads the flag inside its own requestAnimationFrame loop. Nothing re-renders.
 *
 * The subscribe API exists so the canvas can recompute scatter targets ONCE on
 * each change rather than testing for a transition every frame.
 */

let shattered = false;
const listeners = new Set<() => void>();

export const shatterStore = {
  get(): boolean {
    return shattered;
  },

  set(next: boolean): void {
    // Bail on no-op writes: a button can fire mouseenter repeatedly while the
    // pointer jitters inside it, and each one would wake every listener.
    if (next === shattered) return;
    shattered = next;
    for (const listener of listeners) listener();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
