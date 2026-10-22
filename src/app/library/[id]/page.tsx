import { notFound } from 'next/navigation';
import { Investigation } from '@/components/Investigation';
import { CaseFeedback } from '@/components/CaseFeedback';
import { audit, getDocument, type CaseRecord } from '@/lib/platform/store';
export const dynamic='force-dynamic';
export default async function StoredPage({params}:{params:Promise<{id:string}>}) {
 const record=getDocument<CaseRecord>('case',(await params).id);if(!record)notFound();audit('case.viewed',record.id);
 return <><Investigation view={record.view}/><div className="page" style={{paddingTop:0}}><CaseFeedback id={record.id} predicted={record.view.verdicts.at(-1)!.code}/><p className="muted">{record.revisions.length} evidence snapshots preserved. Last checked {record.facts.checkedAt}. {record.feedback ? `Review: ${record.feedback.actual} · ${record.feedback.adjudicated?'adjudicated':'awaiting adjudication'}`:'Not yet reviewed.'}</p></div></>;
}
