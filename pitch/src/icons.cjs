// Simple custom icons in the film's line style, rasterised for the deck (no clip art).
const sharp = require("sharp"); const fs = require("fs"); const path = require("path");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const L = "#C9D1DF", A = "#8EA2FF", R = "#FF8A7F", BG = "#141A24";
const note = (extra = "", notch = false) => `
  <rect x="20" y="70" width="216" height="116" rx="12" fill="${BG}" stroke="${L}" stroke-width="5" ${notch ? 'clip-path="url(#c)"' : ""}/>
  <ellipse cx="128" cy="128" rx="44" ry="30" fill="none" stroke="${L}" stroke-opacity=".45" stroke-width="4"/>
  ${extra}`;
const icons = {
  short: `<defs><clipPath id="c"><path d="M0 0 H256 V140 L196 200 H0 Z"/></clipPath></defs>${note("", true)}
    <path d="M236 140 L190 186" stroke="${A}" stroke-width="6" stroke-dasharray="12 9" stroke-linecap="round"/>
    <text x="128" y="142" text-anchor="middle" font-family="Arial" font-weight="700" font-size="40" fill="${L}">$</text>`,
  road: `<path d="M24 196 L128 196" stroke="${L}" stroke-width="14" stroke-linecap="round" stroke-opacity=".6"/>
    <path d="M128 196 L232 196" stroke="${L}" stroke-width="14" stroke-linecap="round" stroke-opacity=".6"/>
    <path d="M128 196 L214 70" stroke="${A}" stroke-width="14" stroke-linecap="round"/>
    <circle cx="214" cy="70" r="16" fill="${A}"/>
    <path d="M214 30 L240 56 M240 30 L214 56" stroke="${R}" stroke-width="7" stroke-linecap="round"/>`,
  fake: `${note()}<g transform="rotate(-14 128 128)"><rect x="66" y="98" width="124" height="60" rx="8" fill="none" stroke="${R}" stroke-width="6"/>
    <text x="128" y="142" text-anchor="middle" font-family="Arial" font-weight="700" font-size="38" fill="${R}">FAKE</text></g>`,
  nolabel: `<rect x="34" y="62" width="188" height="132" rx="12" fill="${BG}" stroke="${L}" stroke-width="5"/>
    <path d="M34 72 L128 136 L222 72" fill="none" stroke="${L}" stroke-width="5" stroke-opacity=".7"/>
    <rect x="150" y="150" width="86" height="56" rx="10" fill="${BG}" stroke="${A}" stroke-width="5" stroke-dasharray="10 7"/>
    <text x="193" y="191" text-anchor="middle" font-family="Arial" font-weight="700" font-size="36" fill="${A}">?</text>`,
  howtopay: `<rect x="52" y="30" width="152" height="196" rx="16" fill="${BG}" stroke="${L}" stroke-width="5"/>
    ${[0, 1, 2].map((i) => `<circle cx="90" cy="${82 + i * 50}" r="14" fill="${A}"/><text x="90" y="${90 + i * 50}" text-anchor="middle" font-family="Arial" font-weight="700" font-size="20" fill="${BG}">${i + 1}</text>
    <path d="M116 ${82 + i * 50} H176" stroke="${L}" stroke-width="7" stroke-linecap="round" stroke-opacity=".7"/>`).join("")}`,
  ticked: `<rect x="40" y="44" width="176" height="168" rx="16" fill="${BG}" stroke="${L}" stroke-width="5"/>
    <path d="M72 92 H160 M72 128 H140" stroke="${L}" stroke-width="7" stroke-linecap="round" stroke-opacity=".6"/>
    <circle cx="190" cy="186" r="40" fill="${A}"/><path d="M170 186 L184 200 L210 172" stroke="${BG}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  explains: `<path d="M34 50 H222 Q232 50 232 60 V160 Q232 170 222 170 H110 L70 206 V170 H44 Q34 170 34 160 V60 Q34 50 44 50 Z" fill="${BG}" stroke="${L}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M66 90 H200 M66 126 H170" stroke="${A}" stroke-width="8" stroke-linecap="round"/>`,
  logo: `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B9C6FF"/><stop offset="1" stop-color="${A}"/></linearGradient></defs>
    <rect x="8" y="8" width="240" height="240" rx="64" fill="url(#g)"/>
    <path d="M56 136 H104 L124 160 L192 88" stroke="#07090D" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
};
(async () => {
  for (const [k, body] of Object.entries(icons)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;
    await sharp(Buffer.from(svg), { density: 300 }).resize(512, 512).png().toFile(path.join(OUT, `${k}.png`));
  }
  console.log("icons:", Object.keys(icons).join(", "));
})();
