import {documents,audit} from '@/lib/platform/store';
export async function GET(){audit('regressions.exported','all');return Response.json({schema:'desk.regression.v1',warning:'Contains workspace evidence. Review labels before promoting to tests.',candidates:documents('regression')},{headers:{'Content-Disposition':'attachment; filename="regression-candidates.json"','Cache-Control':'no-store'}});}
