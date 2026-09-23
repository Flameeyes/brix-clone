// @ts-check

/**
 * The default VGA mode 13h palette, which BRIX never changes.
 *
 * @returns {[number, number, number][]} 256 RGB triplets, 0-255 per channel
 */
function buildVgaPalette() {
  /** @type {[number, number, number][]} */
  const palette = [
    [0, 0, 0], [0, 0, 42], [0, 42, 0], [0, 42, 42], [42, 0, 0], [42, 0, 42], [42, 21, 0], [42, 42, 42],
    [21, 21, 21], [21, 21, 63], [21, 63, 21], [21, 63, 63], [63, 21, 21], [63, 21, 63], [63, 63, 21], [63, 63, 63],
  ];
  for (const grey of [0, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 45, 50, 56, 63]) {
    palette.push([grey, grey, grey]);
  }
  const hueSets = [
    [63, 0, 16, 31, 47], [63, 31, 39, 47, 55], [63, 45, 49, 54, 58],
    [28, 0, 7, 14, 21], [28, 14, 17, 21, 24], [28, 20, 22, 24, 26],
    [16, 0, 4, 8, 12], [16, 8, 10, 12, 14], [16, 11, 12, 13, 15],
  ];
  for (const [hi, lo, a, b, c] of hueSets) {
    palette.push(
      [lo, lo, hi], [a, lo, hi], [b, lo, hi], [c, lo, hi], [hi, lo, hi], [hi, lo, c], [hi, lo, b], [hi, lo, a],
      [hi, lo, lo], [hi, a, lo], [hi, b, lo], [hi, c, lo], [hi, hi, lo], [c, hi, lo], [b, hi, lo], [a, hi, lo],
      [lo, hi, lo], [lo, hi, a], [lo, hi, b], [lo, hi, c], [lo, hi, hi], [lo, c, hi], [lo, b, hi], [lo, a, hi],
    );
  }
  while (palette.length < 256) {
    palette.push([0, 0, 0]);
  }
  /** @param {number} value */
  const scale = (value) => Math.round((value * 255) / 63);
  return palette.map(([r, g, b]) => [scale(r), scale(g), scale(b)]);
}

export const VGA_PALETTE = buildVgaPalette();

/** @param {number} index */
export function cssColor(index) {
  const [r, g, b] = VGA_PALETTE[index];
  return `rgb(${r}, ${g}, ${b})`;
}
