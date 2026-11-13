// The plugin-list icon with Buzz's "agents" tile built in, as Buzz draws it
// behind its own agent plugins (Settings.module.css, data-branded): the
// blue-9 → iris-9 gradient in OKLCH, the lighting layer in soft-light, and
// the glyph hue-rotated 25°. Installed icons are shown as they are, so the
// tile has to be part of the artwork.
import { glyph } from "./list-glyph.mjs";

// sRGB hex → OKLab → OKLCH interpolation → sRGB hex.
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklab([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, unlin(c))) * 255).toString(16).padStart(2, "0")).join("")}`;
}
const lch = ([L, a, b]) => [L, Math.hypot(a, b), Math.atan2(b, a)];
const lab = ([L, C, h]) => [L, C * Math.cos(h), C * Math.sin(h)];
function oklchStops(from, to, n = 9) {
  const [A, B] = [lch(toOklab(hex2rgb(from))), lch(toOklab(hex2rgb(to)))];
  let dh = B[2] - A[2];
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [t, fromOklab(lab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + dh * t]))];
  });
}

const S = 512;
const R = S * 0.24;
const stops = oklchStops("#0090ff", "#5f55fa")
  .map(([t, c]) => `<stop offset="${t.toFixed(3)}" stop-color="${c}"/>`)
  .join("");
const inner = glyph.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

export const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="${S}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>
    <linearGradient id="light" x1="0" y1="0" x2="0" y2="${S}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e0e0e0"/>
      <stop offset="0.55" stop-color="#a6a6a6"/>
      <stop offset="1" stop-color="#808080"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="${S}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#929292"/>
      <stop offset="1" stop-color="#e0e0e0"/>
    </linearGradient>
    <clipPath id="shape"><rect width="${S}" height="${S}" rx="${R}"/></clipPath>
    <filter id="tint" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="25"/></filter>
  </defs>
  <g clip-path="url(#shape)">
    <rect width="${S}" height="${S}" fill="url(#tile)"/>
    <rect x="2.56" y="2.56" width="${S - 5.12}" height="${S - 5.12}" rx="${R}" fill="url(#light)" stroke="url(#edge)" stroke-width="5.12" style="mix-blend-mode:soft-light"/>
    <g filter="url(#tint)">${inner}</g>
  </g>
</svg>`;
