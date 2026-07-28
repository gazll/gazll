/* Dialog focus management.

   Without a trap, pressing Tab inside an open dialog walks straight out onto
   the buttons behind the overlay — you keep tabbing but nothing visible moves,
   and Enter then fires a control you cannot see. */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

const returnTo = new WeakMap();

function focusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function onKey(e) {
  if (e.key !== 'Tab') return;
  const modal = e.currentTarget;
  const items = focusable(modal);
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (e.shiftKey && (active === first || !modal.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Call when a dialog becomes visible. */
export function openDialog(modal, focusFirst) {
  returnTo.set(modal, document.activeElement);
  modal.addEventListener('keydown', onKey);
  const target = focusFirst || focusable(modal)[0];
  if (target) setTimeout(() => target.focus(), 30);
}

/** Call when it is hidden; puts focus back where it came from. */
export function closeDialog(modal) {
  modal.removeEventListener('keydown', onKey);
  const back = returnTo.get(modal);
  returnTo.delete(modal);
  if (back && back.focus && document.contains(back)) back.focus();
}
