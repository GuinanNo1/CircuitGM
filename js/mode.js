// Simple / Advanced mode, shared by MIDI2Circuit and Circuit2MIDI.
//
// Each page starts in simple mode. Elements with class "adv" are hidden in simple mode with
// CSS (html.simple .adv), so a hidden setting keeps working at whatever value it has: switching
// to simple never changes the result. A line tells the reader when settings they changed are
// hidden. The choice is remembered per page in this browser (localStorage, best effort).
// The <head> sets html.simple before the page paints (see the inline script there), so this
// module only wires the switch.

const KEY_PREFIX = 'circuitgm-advanced-';

export function readAdvanced(page) {
  try { return localStorage.getItem(KEY_PREFIX + page) === '1'; } catch { return false; }
}

function remember(page, on) {
  try { localStorage.setItem(KEY_PREFIX + page, on ? '1' : '0'); } catch { /* private window etc. */ }
}

// Value of a form control, for "has the reader changed it?".
const valueOf = (el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);

export function setupMode(page) {
  const root = document.documentElement;
  const box = document.getElementById('advanced');
  const note = document.getElementById('mode-changed');
  const touched = new Map();                 // control -> its value before the reader first changed it

  // Remember a control's value when the reader first reaches for it, so programmatic resets
  // (a new song, a new pack) are not counted as the reader's changes.
  const capture = (e) => {
    const el = e.target;
    if (!el.closest?.('.adv') || !el.matches?.('input, select, textarea') || touched.has(el)) return;
    touched.set(el, valueOf(el));
  };
  document.addEventListener('pointerdown', capture, true);
  document.addEventListener('focusin', capture, true);
  document.addEventListener('keydown', capture, true);

  const renumber = () => {
    let n = 1;
    for (const num of document.querySelectorAll('main > .panel > h2 > .num')) {
      const panel = num.closest('.panel');
      if (root.classList.contains('simple') && panel.classList.contains('adv')) continue;
      num.textContent = String(n++);
    }
  };

  const refresh = () => {
    if (!note) return;
    let changed = 0;
    for (const [el, was] of touched) {
      if (!el.isConnected) { touched.delete(el); continue; }
      if (valueOf(el) !== was) changed++;
    }
    const simple = root.classList.contains('simple');
    note.hidden = !simple || changed === 0;
    note.textContent = changed
      ? `${changed} setting${changed > 1 ? 's' : ''} you changed ${changed > 1 ? 'are' : 'is'} hidden in simple mode and still applied. Switch on Advanced to see ${changed > 1 ? 'them' : 'it'}.`
      : '';
  };

  const apply = (on) => {
    root.classList.toggle('simple', !on);
    if (box) box.checked = on;
    renumber();
    refresh();
  };

  box?.addEventListener('change', () => { remember(page, box.checked); apply(box.checked); });
  document.addEventListener('change', refresh);
  apply(readAdvanced(page));
  return { refresh, isAdvanced: () => !root.classList.contains('simple') };
}
