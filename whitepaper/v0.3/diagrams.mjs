// The figures in the working paper, as data. `figures.mjs` draws each one with rough.js (hand-drawn
// strokes) into figures/<id>.svg, and writes the same shapes to excalidraw/<id>.excalidraw so they
// can be opened and edited in Excalidraw (and from there copied into Figma).
//
// Node: { id, x, y (centre), w, h, shape: "ellipse" | "pill" | "card", tone, title, lines, icon, serif }
// Edge: { from, to, bend (px, + = left of travel), arrow, dashed, tone, label }
// Canvases are 1120 px wide and print at the full text width (166 mm), so 17 px text prints at about 7 pt.

export const TONES = {
  indigo: { fill: "#eef0ff", stroke: "#6e7df0" },
  amber: { fill: "#fff3dc", stroke: "#cf9233" },
  rose: { fill: "#fdeceb", stroke: "#cc5f55" },
  green: { fill: "#e6f5ed", stroke: "#3b9a6f" },
  slate: { fill: "#f3f4f7", stroke: "#8a93a3" },
};

const card = (id, x, y, w, h, tone, title, lines, icon) => ({ id, x, y, w, h, shape: "card", tone, title, lines, icon });
const pill = (id, x, y, w, h, tone, title, icon) => ({ id, x, y, w, h, shape: "pill", tone, title, icon });
const plain = (pairs) => pairs.map(([from, to, bend = 0]) => ({ from, to, bend }));

// The problem in one picture (page 1): money moved → ??? → invoice closed.
const gap = {
  id: "fig-gap",
  title: "The problem in one picture",
  width: 1120, height: 200,
  nodes: [
    card("moved", 150, 100, 270, 100, "slate", "Money moved", ["a token transfer", "on the chain"]),
    { id: "q", x: 560, y: 100, w: 360, h: 170, shape: "ellipse", tone: "rose", title: "???", lines: ["which invoice? genuine?", "complete? right network?"] },
    card("closed", 970, 100, 270, 100, "green", "Invoice closed", ["books correct,", "evidence on file"]),
  ],
  edges: [
    { from: "moved", to: "q", bend: -16, arrow: true },
    { from: "q", to: "closed", bend: -16, arrow: true, dashed: true },
  ],
};

// a. The problem map: "a transfer is not a payment" → six failure modes → why → what it costs.
// Each failure is a pill with its card (why / cost) under it; three on each side of the centre.
const problemGroups = [
  ["short", "Short payment", "amber", "−", ["Why: the payer's exchange takes", "its fee out of the amount", "Cost: invoice left open, or", "closed wrongly"]],
  ["net", "Wrong network", "amber", "⇄", ["Why: the same 0x address", "exists on every EVM chain", "Cost: funds stuck, or a", "slow recovery"]],
  ["dup", "Duplicate", "amber", "×2", ["Why: an AP run pays twice", "Cost: a refund owed,", "receipts overstated"]],
  ["fake", "Counterfeit token", "rose", "!", ["Why: anyone can name", "a token \"USDT\"", "Cost: worthless tokens", "booked as payment"]],
  ["look", "Look-alike address", "rose", "≈", ["Why: people check only the", "first and last characters", "Cost: money sent", "to a scammer"]],
  ["ref", "Missing reference", "amber", "?", ["Why: a transfer has no", "field for an invoice", "Cost: unapplied cash; the", "customer gets chased"]],
];
const problem = {
  id: "map-problem",
  title: "The problem map",
  width: 1120, height: 680,
  nodes: [
    { id: "c", x: 560, y: 340, w: 250, h: 130, shape: "ellipse", tone: "indigo", title: "A transfer is", lines: ["not a payment"], serif: true },
    ...problemGroups.flatMap(([id, title, tone, icon, lines], i) => {
      const left = i < 3, x = left ? 175 : 945, y = 34 + (i % 3) * 226;
      return [pill(id, x, y, 250, 52, tone, title, icon), card(`${id}-c`, x, y + 110, 310, lines.length * 22 + 28, "slate", "", lines)];
    }),
  ],
  edges: [
    ...plain([["c", "short", 30], ["c", "net", 0], ["c", "dup", -30], ["c", "fake", -30], ["c", "look", 0], ["c", "ref", 30]]),
    ...problemGroups.map(([id]) => ({ from: id, to: `${id}-c`, bend: 0, dashed: true })),
  ],
};

// b. The landscape map: who covers what, and the gap.
const landscape = {
  id: "map-landscape",
  title: "The landscape map",
  width: 1120, height: 680,
  nodes: [
    { id: "c", x: 560, y: 290, w: 260, h: 120, shape: "ellipse", tone: "indigo", title: "Getting paid", lines: ["in stablecoins"], serif: true },
    card("proc", 215, 95, 410, 150, "slate", "Processors and checkout", ["Stripe · HitPay · Coinbase", "Covers: checkout, conversion,", "settlement into fiat", "Leaves: a processor in the middle"], "$"),
    card("wallet", 905, 95, 410, 150, "slate", "Wallet security", ["Safe + Blockaid · Fireblocks", "Covers: warns or limits the payer", "before they send", "Leaves: which invoice a receipt pays"], "◆"),
    card("acct", 215, 470, 410, 150, "slate", "Invoicing and crypto accounting", ["Request Finance · Bitwave · TRES · Cryptio", "Covers: invoices, ERP sync, references", "when the payer uses them", "Leaves (our view): plain transfers"], "≡"),
    card("issuer", 905, 470, 410, 150, "slate", "Issuers and banks", ["Circle · Tether · licensed issuers", "Covers: the money itself:", "mint, redeem, freeze", "Leaves: what a receipt was for"], "◎"),
    card("gap", 560, 620, 520, 100, "green", "The gap Clearline fills", ["A plain transfer into the business's own wallet,", "checked, matched, explained and booked"], "✓"),
  ],
  edges: [
    { from: "c", to: "proc", bend: 20 }, { from: "c", to: "wallet", bend: -20 }, { from: "c", to: "acct", bend: -20 }, { from: "c", to: "issuer", bend: 20 },
    { from: "c", to: "gap", bend: 0, arrow: true, tone: "green" },
  ],
};

// c. The Clearline system map: five layers and their checks.
const system = {
  id: "map-system",
  title: "The Clearline system map",
  width: 1120, height: 590,
  nodes: [
    { id: "c", x: 130, y: 295, w: 230, h: 140, shape: "ellipse", tone: "indigo", title: "Clearline", lines: ["read-only,", "never holds funds"], serif: true },
    ...["1  Instruction", "2  Verification", "3  Matching", "4  Explanation", "5  Accounting"].map((t, i) => pill(`l${i + 1}`, 395, 60 + i * 117, 210, 56, "indigo", t)),
    ...[
      ["exact amount · the issuer's token contract", "network · EIP-681 QR · look-alike warning"],
      ["succeeded? · right network? · genuine contract?", "12 confirmations · freeze · pause if no answer"],
      ["one open request per address · never by amount", "alone · evidence score · a person confirms"],
      ["what happened · likely cause (an inference)", "next step · a reply drafted from the records"],
      ["posting plan · approved by its key · one key", "per line · never posts fake, failed, wrong network"],
    ].map((lines, i) => card(`k${i + 1}`, 820, 60 + i * 117, 560, 84, "slate", "", lines)),
  ],
  edges: plain([["c", "l1", 25], ["c", "l2", 12], ["c", "l3", 0], ["c", "l4", -12], ["c", "l5", -25], ["l1", "k1"], ["l2", "k2"], ["l3", "k3"], ["l4", "k4"], ["l5", "k5"]]),
};

// d. The vision map: wedge → network → open standard.
const vision = {
  id: "map-vision",
  title: "The vision map",
  width: 1120, height: 410,
  nodes: [
    { id: "w", x: 175, y: 105, w: 200, h: 130, shape: "ellipse", tone: "indigo", title: "Wedge", lines: ["now"], serif: true },
    { id: "n", x: 560, y: 105, w: 240, h: 150, shape: "ellipse", tone: "amber", title: "Network", lines: ["next"], serif: true },
    { id: "s", x: 945, y: 105, w: 290, h: 170, shape: "ellipse", tone: "green", title: "Open standard", lines: ["later"], serif: true },
    card("wc", 175, 320, 330, 130, "slate", "", ["Exceptions and booking for", "businesses paid straight into", "their own wallets, in", "Singapore and Hong Kong"]),
    card("nc", 560, 320, 330, 130, "slate", "", ["Each payment page teaches", "payers to check first; sender", "history sharpens matching;", "partners bring customers"]),
    card("sc", 945, 320, 330, 130, "slate", "", ["A signed instruction wallets", "can verify, a receipt auditors", "can re-check. Only if wallet", "teams adopt it"]),
  ],
  edges: [
    { from: "w", to: "n", bend: -30, arrow: true, label: "gate: 3 paid pilots" },
    { from: "n", to: "s", bend: -30, arrow: true, label: "gate: 20 customers" },
    { from: "w", to: "wc", bend: 0, dashed: true }, { from: "n", to: "nc", bend: 0, dashed: true }, { from: "s", to: "sc", bend: 0, dashed: true },
  ],
};

// The architecture: who touches what. Read-only on the chain; books written only after approval.
const architecture = {
  id: "fig-architecture",
  title: "Architecture",
  width: 1120, height: 520,
  nodes: [
    card("payer", 150, 70, 250, 84, "slate", "Payer", ["opens the payment page"]),
    card("chain", 960, 70, 260, 84, "slate", "Ethereum", ["public data, read-only"]),
    card("page", 150, 280, 250, 84, "indigo", "Payment page", ["the instruction"]),
    card("core", 560, 280, 340, 150, "indigo", "Clearline", ["checks · matching", "explanation · posting plan", "one company per deployment"]),
    card("person", 500, 460, 280, 80, "amber", "A person approves", ["with a written reason"]),
    card("books", 970, 460, 260, 84, "slate", "Accounting system", ["Xero (in testing)"]),
    card("badge", 960, 280, 260, 84, "green", "No wallet keys.", ["Never holds funds."]),
  ],
  edges: [
    { from: "payer", to: "page", bend: 0, arrow: true },
    { from: "payer", to: "chain", bend: -36, arrow: true, label: "sends USDC or USDT to the business's own wallet" },
    { from: "page", to: "core", bend: 0, arrow: true, label: "address check" },
    { from: "chain", to: "core", bend: 30, arrow: true, label: "lookup by transaction ID" },
    { from: "core", to: "person", bend: 10, arrow: true },
    { from: "person", to: "books", bend: 0, arrow: true, label: "posts after approval" },
  ],
};

// The worked example as a sequence: one short payment, from invoice to books (demo data).
const sequence = {
  id: "fig-sequence",
  title: "One payment, end to end",
  width: 1120, height: 520,
  sequence: {
    lanes: [
      { id: "fin", label: "Finance team", x: 100, tone: "amber" },
      { id: "cl", label: "Clearline", x: 340, tone: "indigo" },
      { id: "pay", label: "Customer", x: 600, tone: "slate" },
      { id: "eth", label: "Ethereum", x: 830, tone: "slate" },
      { id: "books", label: "Books", x: 1030, tone: "slate" },
    ],
    top: 20,
    steps: [
      { from: "fin", to: "cl", text: "1  Import INV-1042: 5,000.00" },
      { from: "cl", to: "pay", text: "2  Payment page: 5,000.00 USDC" },
      { from: "pay", to: "eth", text: "3  Sends 4,950.00 via an exchange" },
      { from: "fin", to: "cl", text: "4  Pastes the transaction ID" },
      { from: "cl", to: "eth", text: "5  Read-only lookup by ID" },
      { from: "eth", to: "cl", text: "6  Receipt, contract, block", dashed: true },
      { from: "cl", to: "fin", text: "7  Short by 50.00 (1.0%)" },
      { from: "fin", to: "cl", text: "8  Accept as settled, approve plan" },
      { from: "cl", to: "books", text: "9  Payment 4,950.00 + fee write-off 50.00" },
    ],
  },
  nodes: [], edges: [],
};

export const DIAGRAMS = [gap, problem, landscape, system, vision, architecture, sequence];
