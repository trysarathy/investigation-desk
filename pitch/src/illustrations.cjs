// Clean line illustrations for the 6-slide brief, in the deck's palette (no clip art).
const sharp = require("sharp"); const fs = require("fs"); const path = require("path");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const L = "#C9D1DF", A = "#8EA2FF", A2 = "#B9C6FF", R = "#FF8A7F", BG = "#141A24", INK = "#0B0E14";
const svgs = {
  // A door with a letterbox; a banknote half through the slot; an empty, dashed note tag beside it.
  letterbox: [900, 560, `
    <rect x="70" y="30" width="430" height="500" rx="18" fill="${BG}" stroke="${L}" stroke-opacity=".55" stroke-width="4"/>
    <rect x="110" y="70" width="350" height="150" rx="10" fill="none" stroke="${L}" stroke-opacity=".22" stroke-width="3"/>
    <rect x="110" y="340" width="350" height="150" rx="10" fill="none" stroke="${L}" stroke-opacity=".22" stroke-width="3"/>
    <circle cx="455" cy="290" r="9" fill="${L}" fill-opacity=".6"/>
    <g transform="rotate(-8 300 255)">
      <rect x="205" y="168" width="200" height="110" rx="10" fill="${BG}" stroke="${A2}" stroke-width="4"/>
      <ellipse cx="305" cy="222" rx="36" ry="26" fill="none" stroke="${A2}" stroke-opacity=".55" stroke-width="3"/>
      <text x="305" y="234" text-anchor="middle" font-family="Arial" font-weight="700" font-size="34" fill="${A2}">$</text>
    </g>
    <rect x="150" y="248" width="270" height="44" rx="8" fill="${INK}" stroke="${L}" stroke-width="4"/>
    <rect x="152" y="296" width="266" height="40" fill="${BG}"/>
    <g transform="rotate(6 700 230)">
      <path d="M600 150 H800 V300 H600 Z" fill="none" stroke="${A}" stroke-width="4" stroke-dasharray="14 10"/>
      <circle cx="622" cy="172" r="8" fill="none" stroke="${A}" stroke-width="4"/>
      <text x="700" y="250" text-anchor="middle" font-family="Arial" font-weight="700" font-size="70" fill="${A}">?</text>
    </g>
    <text x="700" y="372" text-anchor="middle" font-family="Arial" font-size="30" fill="${L}" fill-opacity=".8">no note</text>`],
};
(async () => {
  for (const [k, [w, h, body]] of Object.entries(svgs)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
    await sharp(Buffer.from(svg), { density: 300 }).resize(w * 2, h * 2).png().toFile(path.join(OUT, `${k}.png`));
  }
  console.log("ok");
})();
