/* Tiny publish/subscribe.

   Stores emit; views subscribe. Without this, store.js would have to import
   the views it needs to repaint and the views already import the store —
   a cycle. The bus keeps the dependency arrows pointing one way. */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // Copy first: a handler is allowed to unsubscribe itself while running.
  for (const fn of Array.from(set)) fn(payload);
}

/** Event names, kept here so a typo fails loudly at import instead of silently. */
export const EV = {
  SELECTION: 'selection',   // basket contents changed
  HISTORY: 'history',       // recent-folder list changed
  CONFIG: 'config'          // a persisted setting changed
};
