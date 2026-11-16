// Reverb, delay and sidechain presets of the Circuit Tracks and Circuit Rhythm.
//
// A project stores each effect's preset number AND its values, and the hardware plays the
// stored values (tested on the Rhythm, 2026-11-15), so choosing a preset means writing both.
// The values come from Ian's saves of every preset on the hardware: Rhythm FX_test1 pack
// (2026-11-15) and Circuit Tracks Circuit_FX_test pack (2026-11-16). The two devices store
// identical values for every preset saved on both (delay 2-16, reverb 1-8). Delay 1 was not
// captured on the Tracks (its save kept a fresh project's values), so its row is the Rhythm's.
// Value names and ranges: Circuit Tracks Programmer's Reference v3 (see docs).

// Delay values: time, time sync, feedback, width, left-right ratio, slew rate.
export const DELAY_PRESETS = [
  [3, 0, 100, 115, 5, 115], [6, 0, 45, 104, 6, 26], [0, 2, 63, 62, 5, 40], [0, 4, 25, 10, 5, 75],
  [0, 5, 59, 15, 5, 39], [0, 7, 15, 34, 6, 56], [0, 7, 75, 115, 5, 98], [0, 7, 75, 75, 3, 23],
  [0, 8, 80, 10, 6, 68], [0, 9, 50, 100, 5, 33], [0, 10, 82, 23, 5, 56], [0, 10, 78, 88, 6, 47],
  [0, 10, 33, 127, 3, 33], [0, 11, 50, 60, 6, 86], [0, 12, 24, 90, 3, 106], [0, 12, 50, 115, 5, 111],
];
// Reverb values: type (0-5), decay, damping.
export const REVERB_PRESETS = [
  [0, 80, 120], [1, 90, 100], [2, 80, 80], [2, 100, 110], [3, 90, 100], [4, 105, 105], [5, 90, 80], [5, 120, 115],
];
// Names as in both user guides.
export const DELAY_NAMES = ['Slapback Fast', 'Slapback Slow', '32nd Triplets', '32nd', '16th Triplets', '16th',
  '16th Ping Pong', '16th Ping Pong Swung', '8th Triplets', '8th dotted Ping Pong', '8th', '8th Ping Pong',
  '8th Ping Pong Swung', '4th Triplets', '4th dotted Ping Pong Swung', '4th Triplets Ping Pong Wide'];
export const REVERB_NAMES = ['Small Chamber', 'Small Room 1', 'Small Room 2', 'Large Room', 'Hall', 'Large Hall',
  'Hall – long reflection', 'Large Hall – long reflection'];

// Circuit Tracks sidechain (Synth 1, Synth 2, MIDI 1, MIDI 2): preset 0 = Off, 1-7 = the grid's
// presets. Values: attack, hold, decay, depth. Off keeps the reset values with depth 0.
// From the Circuit_FX_test save, projects 25-32. The Circuit Rhythm stores the same values for
// presets 1-7 (Ian_SC_test save, 16 Nov), but an off track stores 0,0,0,0.
export const SIDECHAIN_PRESETS = [
  [0, 50, 70, 0], [5, 50, 80, 80], [5, 70, 70, 100], [5, 85, 70, 115],
  [5, 90, 75, 123], [5, 90, 85, 127], [5, 95, 95, 127], [5, 102, 95, 127],
];
