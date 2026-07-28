/* Checkbox wiring shared by every list view, including Shift+click ranges. */

import { S } from './state.js';
import { toast } from './util.js';
import { addFile, removeFile, applyRange, changed } from './store.js';

let shiftHeld = false;

/**
 * @param {HTMLInputElement} cb   the checkbox
 * @param {number} idx            position in S.displayList
 * @param {object} item           the file this row shows
 */
export function bindPick(cb, idx, item) {
  // click fires before change and is the only place shiftKey is readable.
  cb.addEventListener('click', (e) => { shiftHeld = e.shiftKey; });

  cb.addEventListener('change', () => {
    if (shiftHeld && S.lastPickIdx >= 0 && S.lastPickIdx !== idx) {
      const n = applyRange(Math.min(S.lastPickIdx, idx), Math.max(S.lastPickIdx, idx), cb.checked);
      toast((cb.checked ? 'Selected ' : 'Cleared ') + n + ' files in range');
    } else if (cb.checked) {
      addFile(item, null);
    } else {
      removeFile(item.linkcode);
    }
    S.lastPickIdx = idx;
    shiftHeld = false;
    changed();
  });
}
