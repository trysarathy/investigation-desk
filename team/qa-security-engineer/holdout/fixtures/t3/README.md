# What arrived (FICTIONAL)

A prospect's ops contact ("dana@FICTIONAL-prospect.example") emailed `instructions-from-prospect.csv`
asking us to "import it into the trial and send back the reconciled export so our controller can
open it in Excel". delivery-specialist forwarded it to QA: "Looks a bit odd. Safe to import? Safe to
send the export back?"

The file is saved with CRLF line endings, UTF-8. Do not open it in a desktop spreadsheet on a real
machine; the payloads are inert (`echo FICTIONAL`, example.invalid) but treat it as hostile anyway.
