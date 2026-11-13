import type {Metadata} from "next";
import Link from "next/link";
import styles from "./trial.module.css";
export const metadata:Metadata={title:"Customer evaluation | Clearline",description:"Guided fictional-data evaluation of Connect, Control and funding operations. No real payments."};
const cases=[
["01","Create an intent","Connect","Create a fictional payment, compare three sandbox quotes, choose a route and simulate provider-reported completion.","/clearline"],
["02","Investigate a return","Control","Inspect a returned payout and identify the beneficiary-details correction required.","/clearline"],
["03","Handle a compliance hold","Control","See the partner document request and identify the human owner. Clearline does not clear holds.","/clearline"],
["04","Inspect stablecoin finality","Control","Distinguish a synthetic Base Sepolia transaction observation from proof of final settlement.","/clearline"],
["05","Follow an advance","Funding Desk","Review the separate fictional maker-checker, outstanding ledger and repayment exception module.","/mentor-demo"]
];
export default function Trial(){return <main id="main" className={styles.wrap}>
 <header className={styles.header}><Link href="/clearline" className={styles.logo}><span>C</span> Clearline</Link><span className={styles.test}>TEST MODE · FICTIONAL DATA</span></header>
 <div className={styles.container}>
 <section className={styles.hero}><p className={styles.eyebrow}>CUSTOMER EVALUATION / GUIDED WALKTHROUGH</p><h1>Every payment has a story.<br/>Follow the evidence.</h1><p>Explore Clearline Connect, Control and the Funding Desk through five synthetic cases. No bank login or integration required.</p><div className={styles.actions}><Link href="/clearline" className={styles.primary}>Open Clearline Connect + Control →</Link><Link className={styles.secondary} href="/clearline/docs">Developer docs ↗</Link></div></section>
 <aside className={styles.warning}><strong>Evaluation only.</strong> All providers, quotes, webhooks, balances and statements here are simulated. Do not enter customer information or real payment instructions. Clearline does not move or hold funds.</aside>
 <section className={styles.section}><div className={styles.overline}>FIVE DEMONSTRATION CASES</div><h2>Start with the work, not a sales deck.</h2><div className={styles.grid}>{cases.map(c=><article key={c[0]} className={styles.card}><div className={styles.number}>{c[0]} / 05 · {c[2]}</div><h3>{c[1]}</h3><p>{c[3]}</p><Link href={c[4]}>Explore case →</Link></article>)}</div></section>
 <section className={styles.feedback}><div><div className={styles.overline}>THREE QUESTIONS FOR YOUR TEAM</div><h2>Would this change your operating day?</h2></div><ol><li>Where does your team lose payment visibility today?</li><li>Which exception takes the most work to resolve?</li><li>Who would own the budget to solve that problem?</li></ol></section>
 <section className={styles.end}><h2>One last distinction</h2><p>The Funding Desk is a separate prototype and does not share persisted advance records with Connect yet. The test API is stateless, with no licensed partners, real webhooks or actual settlement evidence. A real-data pilot requires separate security, legal and data-handling review.</p><Link href="/mentor-demo" className={styles.secondary}>Open Funding Desk →</Link></section>
 <footer>Clearline is an early-stage test-mode prototype. No custody, lending, payout execution or compliance decisions.</footer>
 </div></main>;}
