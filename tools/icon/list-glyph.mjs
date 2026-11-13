// The plugin-list icon: the Orbit glyph in the frosted, inflated material of
// Buzz's bundled plugin icons, on transparency (Buzz draws the tile).
const S = 512;
const C = S / 2;
const rad = (d) => (d * Math.PI) / 180;
const pt = (a, r) => [C + r * Math.cos(rad(a)), C + r * Math.sin(rad(a))];
const f = (n) => Number(n.toFixed(2));

const R = 148; // orbit radius
const arc = (from, to) => {
  const [x0, y0] = pt(from, R);
  const [x1, y1] = pt(to, R);
  return `M${f(x0)} ${f(y0)} A${R} ${R} 0 0 1 ${f(x1)} ${f(y1)}`;
};
const node = (a, r) => {
  const [x, y] = pt(a, R);
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${r}"/>`;
};
function sparkle(cx, cy, r, waist = 0.25) {
  const w = r * waist;
  return `M${f(cx)} ${f(cy - r)} Q${f(cx + w)} ${f(cy - w)} ${f(cx + r)} ${f(cy)} Q${f(cx + w)} ${f(cy + w)} ${f(cx)} ${f(cy + r)} Q${f(cx - w)} ${f(cy + w)} ${f(cx - r)} ${f(cy)} Q${f(cx - w)} ${f(cy - w)} ${f(cx)} ${f(cy - r)} Z`;
}

/** The glyph, 512 px on transparency. */
export const glyph = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="frost" x1="120" y1="90" x2="400" y2="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.45" stop-color="#E4EEFF"/>
      <stop offset="1" stop-color="#A8C4FF"/>
    </linearGradient>
    <radialGradient id="core" cx="${C}" cy="${C}" r="70" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#A9C6FF" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#9DBEFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="puffy" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="9" result="soft"/>
      <feOffset in="soft" dx="-6" dy="-10" result="up"/>
      <feComposite in="SourceAlpha" in2="up" operator="arithmetic" k2="1" k3="-1" result="lower"/>
      <feFlood flood-color="#5B7FF0" flood-opacity="0.62"/>
      <feComposite in2="lower" operator="in" result="shade"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="soft2"/>
      <feOffset in="soft2" dx="4" dy="7" result="down"/>
      <feComposite in="SourceAlpha" in2="down" operator="arithmetic" k2="1" k3="-1" result="upper"/>
      <feFlood flood-color="#FFFFFF" flood-opacity="0.95"/>
      <feComposite in2="upper" operator="in" result="rim"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="far"/>
      <feOffset in="far" dy="12" result="dropped"/>
      <feFlood flood-color="#1B2BB5" flood-opacity="0.26"/>
      <feComposite in2="dropped" operator="in" result="drop"/>
      <feMerge>
        <feMergeNode in="drop"/>
        <feMergeNode in="SourceGraphic"/>
        <feMergeNode in="shade"/>
        <feMergeNode in="rim"/>
      </feMerge>
    </filter>
  </defs>
  <g filter="url(#puffy)">
    <g fill="none" stroke="url(#frost)" stroke-width="40" stroke-linecap="round">
      <path d="${arc(-160, -28)}"/>
      <path d="${arc(20, 152)}"/>
    </g>
    <g fill="url(#frost)">
      ${node(-28, 33)}
      ${node(152, 33)}
      <path d="${sparkle(C, C, 92)}"/>
    </g>
    <circle cx="${C}" cy="${C}" r="62" fill="url(#core)"/>
  </g>
</svg>`;
