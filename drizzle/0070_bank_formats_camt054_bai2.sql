-- v1 phase 2.5: two more structured bank-statement formats, camt.054 (debit/credit notification) and BAI2, go through
-- the same upload pipeline as MT940 and camt.053 (account currency check, second-person confirmation, "imported, two
-- person confirmed" evidence, duplicate check). Only the list of accepted file formats widens; no rule loosens.
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_format_chk";
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_format_chk" CHECK ("uploads"."file_format" in ('csv','tsv','xlsx','json','mt940','camt053','camt054','bai2'));
