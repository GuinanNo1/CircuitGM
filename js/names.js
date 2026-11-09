// Pack, project and sample names for Novation Components, which allows 16 characters
// (it accepts longer names in a file, but then won't let you edit them).
//
// fitName shortens a name without cutting a word in half:
//   1. drop file-name clutter (underscores, a leading track number, " - " separators,
//      repeated spaces) and non-ASCII letters;
//   2. if it fits, done;
//   3. drop vowels from the longest words (keeping each word's first letter) until it fits,
//      e.g. "Bohemian_Rhapsody_Live" -> "Bhmn Rhpsdy Live";
//   4. failing that, keep whole words from the start, as many as fit;
//   5. only a single word too long for the space is cut.
// numbered(name, n) gives "Name 2", or "Name2" when the space doesn't fit.

export const NAME_MAX = 16;

export function cleanName(s) {
  return (s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '')
    .replace(/^\s*\d{1,3}\s*[-._)]+\s*/, '')                       // "01 - Song", "03_Song" -> "Song"
    .replace(/_+/g, ' ')
    .replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
}

const VOWELS = /[aeiouAEIOU]/g;

function squeeze(word) {
  if (word.length <= 4) return word;
  return word[0] + word.slice(1).replace(VOWELS, '');
}

export function fitName(s, max = NAME_MAX) {
  const name = cleanName(s);
  if (name.length <= max) return name;
  let words = name.split(' ');
  // 3. squeeze the longest words first, one at a time, until it fits
  const order = words.map((w, i) => i).sort((a, b) => words[b].length - words[a].length);
  const squeezed = words.slice();
  for (const i of order) {
    squeezed[i] = squeeze(squeezed[i]);
    const t = squeezed.join(' ');
    if (t.length <= max) return t;
  }
  // 4. whole squeezed words from the start
  let out = '';
  for (const w of squeezed) {
    const t = out ? `${out} ${w}` : w;
    if (t.length > max) break;
    out = t;
  }
  // 5. a single word too long for the space
  return out || squeezed[0].slice(0, max);
}

export function numbered(name, n, max = NAME_MAX) {
  const num = String(n);
  const spaced = fitName(name, max - num.length - 1);
  if (cleanName(name).length <= max - num.length - 1) return `${spaced} ${num}`;
  const tight = fitName(name, max - num.length);
  return tight.length > spaced.length ? `${tight}${num}` : `${spaced} ${num}`;
}
