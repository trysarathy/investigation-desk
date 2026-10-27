import { Eyebrow, Reveal, SectionTitle } from "./ui";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const problems = [
  {
    title: "Paid too little",
    body: "Fees come off along the way, so 5,000 becomes 4,950. The invoice stays open.",
    icon: (
      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
        <rect x="8" y="10" width="32" height="28" rx="6" {...stroke} />
        <rect className="shrink" x="13" y="26" width="22" height="7" rx="2" fill="currentColor" opacity="0.3" />
        <path d="M14 17h20" {...stroke} />
      </svg>
    ),
  },
  {
    title: "Wrong network",
    body: "The right digital dollars, sent down a different road, to a place nobody is watching.",
    icon: (
      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
        <path d="M8 38c8-6 10-14 16-20s10-8 16-8" {...stroke} opacity="0.35" />
        <path className="draw" d="M8 38c6-2 12-2 18-8" {...stroke} />
        <circle cx="40" cy="10" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "Counterfeit digital dollars",
    body: "Anyone can create a token called “USDT”. It looks paid, but it's worth nothing.",
    icon: (
      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
        <circle cx="24" cy="24" r="14" {...stroke} />
        <path d="M24 16v16M19 20.5c0-2 2-3 5-3s5 1.2 5 3-2 2.7-5 3.5-5 1.6-5 3.5 2 3 5 3 5-1 5-3" {...stroke} />
        <path className="draw" d="M10 38 38 10" {...stroke} strokeWidth={2.6} />
      </svg>
    ),
  },
  {
    title: "No invoice reference",
    body: "A transfer carries no note, so someone has to guess which invoice it pays.",
    icon: (
      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
        <path d="M14 8h14l8 8v24H14z" {...stroke} />
        <path d="M28 8v8h8" {...stroke} />
        <text x="25" y="33" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">?</text>
      </svg>
    ),
  },
];

export function Problem() {
  return (
    <section id="problem" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32">
      <div className="grid gap-12 md:grid-cols-[1fr_1.1fr] md:gap-16">
        <Reveal>
          <Eyebrow>The problem</Eyebrow>
          <SectionTitle>Cash through the letterbox, with no note.</SectionTitle>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-muted">
            Digital dollars arrive in seconds. Working out what they were for can take an afternoon.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="rounded-2xl border border-line bg-panel p-7 sm:p-8">
          <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-faint">A day in finance</p>
          <ol className="mt-5 space-y-5 text-[17px] leading-relaxed">
            <li><span className="text-faint">1 ·</span> Maya runs finance at a small company that gets paid in digital dollars.</li>
            <li><span className="text-faint">2 ·</span> A customer writes: <span className="text-fg">“We paid yesterday. Why is the invoice still open?”</span></li>
            <li><span className="text-faint">3 ·</span> So she opens pages of codes, spreadsheets and long email chains, just to find one payment.</li>
          </ol>
          <p className="mt-6 text-[12.5px] text-faint">Maya is a fictional finance manager, the same one as in our demo film.</p>
        </Reveal>
      </div>

      <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {problems.map((p, i) => (
          <li key={p.title}>
            <Reveal delay={0.08 * i} className="h-full rounded-2xl border border-line bg-panel/60 p-6 transition hover:border-line-strong">
              <div className="text-warn">{p.icon}</div>
              <h3 className="mt-5 text-[18px] font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{p.body}</p>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
