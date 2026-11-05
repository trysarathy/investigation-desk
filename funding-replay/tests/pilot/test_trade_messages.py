import unittest

from pilot.trade_messages import LIMIT, NS, parse_message


MT = """:27:1/1
:40A:IRREVOCABLE
:20:TEST-LC-16
:31C:261106
:40E:UCP LATEST VERSION
:31D:261130SINGAPORE
:50:Example applicant
:59:Example beneficiary
:32B:USD12400,01
:41D:Example bank
BY PAYMENT
:46A:COMMERCIAL INVOICE
TRANSPORT DOCUMENT
:49:WITHOUT"""
MX = """<Document xmlns="%s"><FIToFICstmrCdtTrf>
<GrpHdr><MsgId>SIM-301</MsgId><NbOfTxs>1</NbOfTxs></GrpHdr>
<CdtTrfTxInf><PmtId><EndToEndId>INV-2</EndToEndId></PmtId>
<IntrBkSttlmAmt Ccy="USD">999.02</IntrBkSttlmAmt></CdtTrfTxInf>
</FIToFICstmrCdtTrf></Document>""" % NS


class MessageProfiles(unittest.TestCase):
    def test_mt_is_only_terms_preview(self):
        result = parse_message("mt700", MT.replace("\n", "\r\n"))
        self.assertEqual(result["fields"]["amount"]["minor"], 1240001)
        self.assertEqual(result["fields"]["expiry_date"], "2026-11-30")
        self.assertIn("TRANSPORT DOCUMENT", result["fields"]["document_terms"])
        self.assertFalse(result["authenticated"])
        self.assertEqual(result["effect"], "none")
        self.assertEqual(result["interpretation"], "credit_terms_preview")

    def test_trailing_comma_and_jpy_are_not_usd_cents(self):
        cases = (("USD10,", 1000), ("JPY10,", 10))
        for field, expected in cases:
            self.assertEqual(parse_message("mt700", MT.replace("USD12400,01", field))["fields"]["amount"]["minor"], expected)

    def test_invalid_fin_never_masquerades_as_terms(self):
        bad = [MT.replace("1/1", "1/2"), MT.replace("261130", "261131"), MT.replace("261130", "261105"),
               MT.replace("261130SINGAPORE", "261130"), MT.replace("TEST-LC-16", "A//B"),
               MT.replace("USD12400,01", "USD12.45"), MT.replace("USD12400,01", "JPY10,01"),
               MT.replace("USD12400,01", "USD0,"), MT.replace("USD12400,01", "ZZZ10,"),
               MT.replace(":59:Example beneficiary\n", ""), MT+"\n:32B:USD999,",
               "{1:FAKE}\n"+MT, MT+"\n:71D:FEES", MT.replace(":41D:", ":!!:"), MT.replace("IRREVOCABLE", "REVOCABLE"), MT.replace(":49:WITHOUT", ":49:PAID"), MT.replace(":49:WITHOUT", "")]
        for raw in bad:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    parse_message("mt700", raw)

    def test_iso_is_payment_instruction_not_lc_or_credit(self):
        result = parse_message("pacs.008.001.08", MX)
        self.assertEqual(result["fields"]["interbank_settlement_amount"]["minor"], 99902)
        self.assertEqual(result["interpretation"], "payment_instruction_preview")
        self.assertFalse(result["authenticated"])
        self.assertEqual(result["effect"], "none")
        self.assertEqual(len(result["sha256"]), 64)
        self.assertNotEqual(parse_message("pacs.008.001.08", MX+"\n")["sha256"], result["sha256"])

    def test_ambiguous_malformed_and_unsafe_xml_fail_closed(self):
        bad = [MX.replace(NS, "urn:example"), MX.replace("999.02", "9e2"),
               MX.replace(">1</NbOfTxs", ">2</NbOfTxs"), MX.replace("</MsgId>", "</MsgId><MsgId>duplicate</MsgId>"),
               MX.replace("<EndToEndId>", '<EndToEndId xmlns="urn:other">'),
               MX.replace("</CdtTrfTxInf>", "</CdtTrfTxInf><CdtTrfTxInf/>"),
               MX.replace("</Document>", "<extra/></Document>"), MX[:80],
               '<!DOCTYPE x [<!ENTITY ev SYSTEM "file:///etc/passwd">]>'+MX, '<?unsafe x?>'+MX,
               MX.replace("<GrpHdr>", "<GrpHdr>" + "<X/>"*250)]
        for raw in bad:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    parse_message("pacs.008.001.08", raw)

    def test_unknown_kind_bounds_and_illegal_controls(self):
        for kind, raw in [("mt701", MT), ("mt700", "\x00"+MT), ("mt700", "X"*(LIMIT+1)),
                          ("mt700", "\ud800"), ("pacs.008.001.08", None)]:
            with self.assertRaises(ValueError):
                parse_message(kind, raw)


if __name__ == "__main__":
    unittest.main()
