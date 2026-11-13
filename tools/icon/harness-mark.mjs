// The harness mark, beside "Claude (ACP)" in Buzz's Harness picker: Claude's
// terracotta burst, drawn here with its own uneven rays, and a "+" badge, so
// it reads as Claude, extended, at 20 px.

const C = 16;
const TERRA = "#D97757";
const BADGE = "#C9623F";
const INK = "#FFF6F0";
const rad = (deg) => (deg * Math.PI) / 180;
const pt = (angle, r, cx = C, cy = C) => [cx + r * Math.cos(rad(angle)), cy + r * Math.sin(rad(angle))];
const f = (n) => Number(n.toFixed(3));

/** A ray from `w0` wide at `r0` to a round tip `w1` wide at `r1`. */
function ray(angle, r0, r1, w0, w1, cx, cy) {
  const [x0, y0] = pt(angle, r0, cx, cy);
  const [x1, y1] = pt(angle, r1, cx, cy);
  const [ax, ay] = pt(angle - 90, w0 / 2, x0, y0);
  const [bx, by] = pt(angle + 90, w0 / 2, x0, y0);
  const [tx, ty] = pt(angle + 90, w1 / 2, x1, y1);
  const [dx, dy] = pt(angle - 90, w1 / 2, x1, y1);
  return `M${f(ax)} ${f(ay)} L${f(dx)} ${f(dy)} A${w1 / 2} ${w1 / 2} 0 0 1 ${f(tx)} ${f(ty)} L${f(bx)} ${f(by)} Z`;
}

/** [angle, length, width]: each ray its own, as if drawn. */
const RAYS = [
  [-91, 14.2, 2.7], [-62, 11.6, 2.3], [-37, 14.6, 2.9], [-9, 11.9, 2.4],
  [17, 13.9, 2.6], [43, 10.9, 2.2], [70, 14.3, 2.8], [97, 11.7, 2.4],
  [125, 14.0, 2.7], [152, 11.2, 2.3], [180, 14.4, 2.8], [208, 11.8, 2.4], [237, 13.4, 2.6],
];

export function harnessMark() {
  const [cx, cy, scale] = [14.6, 14.6, 0.93];
  const rays = RAYS.map(([angle, length, width]) => ray(angle, 0.6, length * scale, width * 0.82, width, cx, cy)).join(" ");
  const [bx, by, br] = [25.3, 25.3, 5.9];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><mask id="g2-cut"><rect width="32" height="32" fill="#fff"/><circle cx="${bx}" cy="${by}" r="${br + 1.25}" fill="#000"/></mask></defs>
  <g mask="url(#g2-cut)">
    <path d="${rays}" fill="${TERRA}"/>
    <circle cx="${cx}" cy="${cy}" r="2.3" fill="${TERRA}"/>
  </g>
  <circle cx="${bx}" cy="${by}" r="${br}" fill="${BADGE}"/>
  <g transform="translate(${bx} ${by})"><path d="M0 -2.85 V2.85 M-2.85 0 H2.85" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/></g>
</svg>`;
}
