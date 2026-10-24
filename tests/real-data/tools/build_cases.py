"""Builds tests/real_cases.json and the SAMPLE COMPANY DATA files from real public transactions.

Every expected answer is checked here against a source that is NOT the product:
  Tron      Tronscan API (apilist.tronscanapi.com) for status, token transfer and time
  Ethereum  Blockscout API (eth.blockscout.com) for status and token transfers
  BNB, Polygon, Arbitrum, Base  a second public RPC (publicnode / chain's own), receipt status
  Freezes   the issuer's own AddedBlackList / Blacklisted event, plus isBlackListed() now
  Fake tokens  symbol() on chain vs Tether's / Circle's published contract lists
"""
import json, sys, time, pathlib, datetime as dt
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from chain import *  # noqa

HERE = pathlib.Path(__file__).parent
REPO = pathlib.Path("..")
OUT = REPO / "tests" / "real-data"; OUT.mkdir(parents=True, exist_ok=True)
VERIFY_RPC = {"bsc": "https://bsc.meowrpc.com", "polygon": "https://polygon-bor-rpc.publicnode.com",
              "arbitrum": "https://arbitrum.drpc.org", "base": "https://base-rpc.publicnode.com"}
EXPLORER = {"tron": "https://tronscan.org/#/transaction/{}", "ethereum": "https://etherscan.io/tx/{}", "bsc": "https://bscscan.com/tx/{}",
            "polygon": "https://polygonscan.com/tx/{}", "arbitrum": "https://arbiscan.io/tx/{}", "base": "https://basescan.org/tx/{}"}
TETHER_LIST = {"label": "Tether's official contract list", "url": "https://tether.to/en/supported-protocols"}
CIRCLE_LIST = {"label": "Circle's USDC contract addresses", "url": "https://developers.circle.com/stablecoins/usdc-contract-addresses"}
USDC_BSC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"
ASSIGNED = "2025-01-01T00:00:00Z"

cases, file_a, file_b = [], [], []
n_cust = [0]
def cust():
    n_cust[0] += 1; return f"SAMPLE-C{n_cust[0]:03d}"
def iso(ts): return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def link(chain, h): return {"label": f"{chain} explorer", "url": EXPLORER[chain].format(h)}

# ---------- independent verifiers ----------
def v_tron(h):
    j = tronscan(h); time.sleep(0.4)
    tr = j.get("trc20TransferInfo") or []
    return {"status": "success" if j.get("contractRet") == "SUCCESS" else "failed", "ret": j.get("contractRet"), "ts": j["timestamp"] // 1000,
            "transfers": [{"contract": t["contract_address"], "from": t["from_address"], "to": t["to_address"], "raw": int(t["amount_str"]),
                           "decimals": int(t.get("decimals") or 6), "symbol": t.get("symbol")} for t in tr],
            "to_contract": (j.get("contractData") or {}).get("contract_address"), "method": ((j.get("trigger_info") or {}).get("method") or ""),
            "call_to": ((j.get("trigger_info") or {}).get("parameter") or {}).get("_to"), "call_value": ((j.get("trigger_info") or {}).get("parameter") or {}).get("_value"),
            "owner": j.get("ownerAddress")}
def v_eth(h):
    for i in range(5):
        try: j = bs(f"transactions/{h}"); break
        except Exception: time.sleep(4)
    time.sleep(1.3)
    tt = j.get("token_transfers") or []
    return {"status": "success" if j.get("result") == "success" else ("failed" if j.get("status") == "error" else j.get("result")),
            "ts": int(dt.datetime.fromisoformat(j["timestamp"].replace("Z", "+00:00")).timestamp()), "to": (j.get("to") or {}).get("hash", "").lower(),
            "method": j.get("method"), "result": j.get("result"),
            "transfers": [{"contract": t["token"]["address_hash"].lower() if "address_hash" in t["token"] else t["token"]["address"].lower(),
                           "from": t["from"]["hash"].lower(), "to": t["to"]["hash"].lower(), "raw": int(t["total"].get("value") or 0),
                           "decimals": int(t["total"].get("decimals") or t["token"].get("decimals") or 0), "symbol": t["token"].get("symbol")} for t in tt]}
def v_rpc(chain, h):
    url = VERIFY_RPC[chain]
    tx = http(url, {"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionByHash", "params": [h]})["result"]
    rc = http(url, {"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionReceipt", "params": [h]})["result"]
    blk = http(url, {"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": [tx["blockNumber"], False]})["result"]
    tr = []
    for l in rc["logs"]:
        if l["topics"] and l["topics"][0] == TRANSFER and len(l["topics"]) == 3:
            tr.append({"contract": l["address"].lower(), "from": "0x" + l["topics"][1][-40:], "to": "0x" + l["topics"][2][-40:],
                       "raw": int(l["data"], 16) if l["data"] not in ("0x", "") else 0, "logIndex": int(l["logIndex"], 16)})
    return {"status": "success" if rc["status"] == "0x1" else "failed", "ts": int(blk["timestamp"], 16), "to": (tx["to"] or "").lower(), "transfers": tr}
def verify(chain, h):
    return v_tron(h) if chain == "tron" else v_eth(h) if chain == "ethereum" else v_rpc(chain, h)

def tron_frozen(addr):
    r = tg("/wallet/triggerconstantcontract", {"owner_address": "410000000000000000000000000000000000000000", "contract_address": unb58(USDT_TRON),
            "function_selector": "isBlackListed(address)", "parameter": unb58(addr)[2:].rjust(64, "0")})
    return int(r["constant_result"][0], 16) != 0
def eth_frozen(token, addr):
    sel = "0xe47d6060" if token == "usdt" else "0xfe575a87"
    j = http("https://rpc.mevblocker.io", {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": USDT_ETH if token == "usdt" else USDC_ETH, "data": sel + word(addr)}, "latest"]})
    return int(j["result"], 16) != 0

def amount(t, dec=None):
    d = dec if dec is not None else t.get("decimals", 6)
    s = f"{t['raw'] / 10**d:.{d}f}".rstrip("0").rstrip(".") if d else str(t["raw"])
    from decimal import Decimal
    return format(Decimal(t["raw"]).scaleb(-d).normalize(), "f")

def add(case_id, category, chain, h, expected, why, sources, customer=None, input_=None, facts=None, findings=None, company=False, extra=None):
    c = {"id": case_id, "category": category, "chain": chain, "tx_hash": h, "input": input_ or h, "customer_id": customer,
         "expected": expected, "expected_findings": findings or [], "why_this_answer": why, "uses_sample_company_data": company,
         "sources": sources, "verified_facts": facts or {}}
    if extra: c.update(extra)
    cases.append(c); print(f"{case_id:7} {category:28} {chain:9} {expected:5} {h[:14]}")

def assign(chain, address, customer, retired=None, assigned=ASSIGNED):
    file_a.append({"address": address, "chain": chain, "customer_id": customer, "assigned_at": assigned, "retired_at": retired or "",
                   "note": "SAMPLE COMPANY DATA (fictional)"})
def ledger(dep_id, chain, h, token, to, amt, status, ts, customer, idx=None, reason=""):
    file_b.append({"deposit_id": dep_id, "tx_hash": h, "chain": chain, "token": token, "to_address": to, "amount": amt, "status": status,
                   "credited_at": iso(ts + 300) if status != "PENDING" else "", "customer_id": customer,
                   "transfer_index": "" if idx is None else str(idx), "reason_code": reason, "note": "SAMPLE COMPANY DATA (fictional)"})

# ---------- 1. Tron: normal, not credited, held, rejected, other customer, retired, below minimum ----------
tron_recent = json.load(open(HERE / "tron_recent.json"))
seen_to, picked = set(), []
for e in tron_recent:
    v = int(e["result"]["value"]); to = tron_addr(e["result"]["to"])
    if 20_000_000 <= v <= 50_000_000_000 and to not in seen_to and len(picked) < 11:
        info = v_tron(e["transaction_id"])
        if info["status"] == "success" and len(info["transfers"]) == 1 and info["transfers"][0]["contract"] == USDT_TRON and info["transfers"][0]["to"] == to:
            sender = info["transfers"][0]["from"]
            if tron_frozen(sender) or tron_frozen(to): continue
            seen_to.add(to); picked.append((e, info))
small = None
for e in tron_recent:
    v = int(e["result"]["value"])
    if 0 < v < 1_000_000:
        info = v_tron(e["transaction_id"])
        if info["status"] == "success" and len(info["transfers"]) == 1 and not tron_frozen(info["transfers"][0]["from"]): small = (e, info); break

def tron_case(i, e, info, expected, status=None, why="", customer_override=None, retired=False, reason=""):
    h = e["transaction_id"]; t = info["transfers"][0]; c = cust()
    assign("tron", t["to"], c, retired=iso(info["ts"] - 86400) if retired else None)
    reporter = customer_override or c
    if status: ledger(f"SAMPLE-DEP-{len(file_b)+1:04d}", "tron", h, "USDT", t["to"], amount(t), status, info["ts"], c, 0, reason)
    add(f"TRN-{i:02d}", {"D13": "normal (credited)", "D12": "on-chain, not credited", "D14": "on hold", "D16": "rejected by company",
                         "D17": "another customer's address", "D18": "retired address", "D08": "below minimum"}[expected],
        "tron", h, expected, why, [link("tron", h), {"label": "Tronscan API", "url": f"https://apilist.tronscanapi.com/api/transaction-info?hash={h}"}],
        customer=reporter, company=True,
        facts={"status": info["ret"], "token_contract": t["contract"], "from": t["from"], "to": t["to"], "amount": amount(t), "time": iso(info["ts"]),
               "sender_frozen_now": False})

for i, (e, info) in enumerate(picked[:5], 1):
    tron_case(i, e, info, "D13", "CREDITED", "Real confirmed USDT transfer (official contract) to an address the sample company assigned to this customer; the sample ledger has a CREDITED row for this tx hash. Nothing is wrong: the product must clear it.")
tron_case(6, *picked[5], "D12", None, "Real confirmed USDT transfer to this customer's sample deposit address; the sample ledger has no row for it, so it arrived on-chain but was not credited.")
tron_case(7, *picked[6], "D12", "PENDING", "Real confirmed transfer; the sample ledger row is still PENDING well past confirmations.")
tron_case(8, *picked[7], "D14", "HELD", "Real confirmed transfer; the sample ledger row is HELD (compliance hold).")
tron_case(9, *picked[8], "D16", "REJECTED", "Real confirmed transfer; the sample ledger row is REJECTED.", reason="SAMPLE: source of funds not verified")
other = cust()  # a second sample customer, reporting a transfer that landed on someone else's address
tron_case(10, *picked[9], "D17", None, "Real transfer to a sample address assigned to a DIFFERENT customer than the one reporting it.", customer_override=other)
tron_case(11, *picked[10], "D18", None, "Real transfer that landed one day after the sample company retired the address (and never reassigned it).", retired=True)
if small: tron_case(12, *small, "D08", None, "Real USDT transfer of less than the sample minimum (1 USDT on Tron) to this customer's sample address.")

# ---------- 2. Ethereum: normal, not credited, below minimum, unsupported token (USDC), wrong address ----------
scan = json.load(open(HERE / "scan_ethereum.json"))
eth_n, eth_small, eth_usdc = [], None, None
for r in scan["normal"]:
    if r["n"] != 1: continue
    if r["c"] == USDT_ETH and 10_000_000 <= r["raw"] <= 10**12 and len(eth_n) < 7 and r["to"] not in [x["to"] for x in eth_n]: eth_n.append(r)
    elif r["c"] == USDT_ETH and 0 < r["raw"] < 10_000_000 and not eth_small: eth_small = r
    elif r["c"] == USDC_ETH and r["raw"] >= 10_000_000 and not eth_usdc: eth_usdc = r
def eth_case(cid, r, expected, status, why, category, report_as=None, register=True):
    h = r["h"]; info = v_eth(h)
    t = [x for x in info["transfers"] if x["contract"] == r["c"]][0]
    assert info["status"] == "success", (h, info["status"])
    if eth_frozen("usdt", t["from"]) or eth_frozen("usdt", t["to"]): print("skip frozen", h); return False
    c = cust()
    if register: assign("ethereum", t["to"], c)
    if status: ledger(f"SAMPLE-DEP-{len(file_b)+1:04d}", "ethereum", h, "USDT" if r["c"] == USDT_ETH else "USDC", t["to"], amount(t), status, info["ts"], c, r["li"])
    add(cid, category, "ethereum", h, expected, why, [link("ethereum", h), {"label": "Blockscout API", "url": f"https://eth.blockscout.com/api/v2/transactions/{h}"}] +
        ([CIRCLE_LIST] if r["c"] == USDC_ETH else []), customer=report_as or c, company=True,
        facts={"status": info["result"], "token_contract": t["contract"], "symbol": t["symbol"], "from": t["from"], "to": t["to"], "amount": amount(t), "time": iso(info["ts"])})
    return True
k = 0
for r in eth_n:
    if k < 4 and eth_case(f"ETH-{k+1:02d}", r, "D13", "CREDITED", "Real confirmed USDT transfer (official Tether contract) to the customer's sample deposit address; the sample ledger has a CREDITED row with this hash and log index. Nothing is wrong.", "normal (credited)"): k += 1
    elif k == 4 and eth_case("ETH-05", r, "D12", None, "Real confirmed USDT transfer to the customer's sample deposit address with no ledger row.", "on-chain, not credited"): k += 1
    elif k == 5:
        # Customer says they paid us, but the destination is not one of our deposit addresses.
        rep = cust(); assign("ethereum", "0x" + "5a" * 20, rep)
        if eth_case("ETH-06", r, "D07", None, "Real transfer whose destination is not in the sample company's deposit-address list; the reporting customer's own sample address is different and not a look-alike.", "wrong address (not ours)", report_as=rep, register=False): k += 1
if eth_small: eth_case("ETH-07", eth_small, "D08", None, "Real USDT transfer below the sample minimum (10 USDT on Ethereum) to the customer's sample address.", "below minimum")
if eth_usdc: eth_case("ETH-08", eth_usdc, "D05", None, "Real USDC (Circle's official contract) sent to a sample deposit address; the sample company accepts only USDT on Ethereum.", "unsupported token")

# ---------- 3. BNB Chain ----------
scan = json.load(open(HERE / "scan_bsc.json"))
bsc_n, bsc_small, bsc_usdc = [], None, None
for r in scan["normal"]:
    if r["n"] != 1: continue
    if r["c"] == BSC_USD and 20 * 10**18 <= r["raw"] <= 10**24 and len(bsc_n) < 4 and r["to"] not in [x["to"] for x in bsc_n]: bsc_n.append(r)
    elif r["c"] == BSC_USD and 0 < r["raw"] < 20 * 10**18 and not bsc_small: bsc_small = r
    elif r["c"] == USDC_BSC and r["raw"] >= 10**18 and not bsc_usdc: bsc_usdc = r
def bsc_case(cid, r, expected, status, why, category):
    h = r["h"]; info = v_rpc("bsc", h); t = [x for x in info["transfers"] if x["contract"] == r["c"]][0]
    assert info["status"] == "success"
    c = cust(); assign("bsc", t["to"], c)
    if status: ledger(f"SAMPLE-DEP-{len(file_b)+1:04d}", "bsc", h, "USDT", t["to"], amount(t, 18), status, info["ts"], c, t["logIndex"])
    add(cid, category, "bsc", h, expected, why, [link("bsc", h), {"label": "Receipt via a second RPC", "url": VERIFY_RPC["bsc"]}], customer=c, company=True,
        facts={"status": info["status"], "token_contract": t["contract"], "from": t["from"], "to": t["to"], "amount": amount(t, 18), "time": iso(info["ts"])})
for i, r in enumerate(bsc_n[:3], 1):
    bsc_case(f"BSC-{i:02d}", r, "D13", "CREDITED", "Real confirmed BSC-USD transfer (the sample company's declared BNB Chain USDT) to the customer's sample address; CREDITED in the sample ledger.", "normal (credited)")
if len(bsc_n) > 3: bsc_case("BSC-04", bsc_n[3], "D12", None, "Real confirmed BSC-USD transfer to the customer's sample address with no ledger row.", "on-chain, not credited")
if bsc_small: bsc_case("BSC-05", bsc_small, "D08", None, "Real BSC-USD transfer below the sample minimum (20 USDT on BNB Chain).", "below minimum")
if bsc_usdc: bsc_case("BSC-06", bsc_usdc, "D05", None, "Real Binance-Peg USDC sent to a sample deposit address; the sample company accepts only BSC-USD on BNB Chain.", "unsupported token")

# ---------- 4. Wrong network: real transfers on Polygon / Arbitrum / Base to an address we registered on Ethereum ----------
for chain, tok in [("polygon", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"), ("arbitrum", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9"), ("base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")]:
    scan = json.load(open(HERE / f"scan_{chain}.json"))
    r = next((x for x in scan["normal"] if x["n"] == 1 and x["c"] == tok and x["raw"] > 0), None) or next(x for x in scan["normal"] if x["c"] == tok and x["raw"] > 0)
    h = r["h"]; info = v_rpc(chain, h); t = [x for x in info["transfers"] if x["contract"] == tok and x["to"] == r["to"]][0]
    c = cust(); assign("ethereum", t["to"], c)
    add(f"NET-{chain[:3].upper()}", "wrong network", chain, h, "D04",
        f"Real transfer on {chain}; the sample company registered this destination as the customer's Ethereum deposit address, so the funds went to the right address on the wrong network.",
        [link(chain, h), {"label": "Receipt via a second RPC", "url": VERIFY_RPC[chain]}], customer=c, company=True,
        facts={"status": info["status"], "token_contract": t["contract"], "from": t["from"], "to": t["to"], "time": iso(info["ts"])})

# ---------- 5. Failed transfers ----------
ts = json.load(open(HERE / "tron_scan.json")); n = 0
for f in ts["failed"]:
    if n >= 3: break
    info = v_tron(f["h"])
    if info["status"] == "failed" and info["ret"] == "OUT_OF_ENERGY" and "transfer" in info["method"].lower():
        n += 1
        add(f"FAIL-T{n}", "failed (out of energy)", "tron", f["h"], "D03", "Tronscan reports contractRet OUT_OF_ENERGY for this USDT transfer call: no tokens moved.",
            [link("tron", f["h"]), {"label": "Tronscan API", "url": f"https://apilist.tronscanapi.com/api/transaction-info?hash={f['h']}"}],
            facts={"status": info["ret"], "method": info["method"], "time": iso(info["ts"])})
se = json.load(open(HERE / "scan_ethereum.json")); n = 0
for f in se["failed"]:
    if n >= 3 or f["to"] != USDT_ETH: continue
    info = v_eth(f["h"])
    if info["status"] == "failed" and (info["method"] or "").startswith("transfer"):
        n += 1
        add(f"FAIL-E{n}", "failed (reverted)", "ethereum", f["h"], "D03", f"Blockscout reports status error ({info['result']}) for this USDT {info['method']} call: no tokens moved.",
            [link("ethereum", f["h"]), {"label": "Blockscout API", "url": f"https://eth.blockscout.com/api/v2/transactions/{f['h']}"}],
            facts={"status": info["result"], "method": info["method"], "time": iso(info["ts"])})
sb = json.load(open(HERE / "scan_bsc.json"))
for f in sb["failed"][:1]:
    info = v_rpc("bsc", f["h"])
    if info["status"] == "failed":
        add("FAIL-B1", "failed (reverted)", "bsc", f["h"], "D03", "Receipt status 0 from a second RPC: the call reverted, no tokens moved.",
            [link("bsc", f["h"]), {"label": "Receipt via a second RPC", "url": VERIFY_RPC["bsc"]}], facts={"status": "0x0", "time": iso(info["ts"])})

# ---------- 6. Issuer freezes (Tether / Circle blacklists) ----------
tb = json.load(open(HERE / "tron_bl_cands.json")); nf = nd = 0
for c in tb:
    if not tron_frozen(c["addr"]): continue
    src = [{"label": "Tether AddedBlackList event (freeze tx)", "url": EXPLORER["tron"].format(c["freeze_tx"])}]
    if nf < 2 and c["failed"]:
        f = c["failed"][0]; info = v_tron(f["txID"])
        if info["status"] == "failed" and info["to_contract"] == USDT_TRON and "transfer" in info["method"].lower():
            nf += 1
            add(f"FRZ-TF{nf}", "frozen sender, transfer reverted", "tron", f["txID"], "D03",
                f"Sender {c['addr']} was blacklisted by Tether (AddedBlackList) before this USDT transfer, which then reverted ({info['ret']}). Primary answer: transaction failed; the freeze must be flagged too.",
                [link("tron", f["txID"])] + src, findings=["D09"], facts={"status": info["ret"], "sender": c["addr"], "sender_frozen_now": True, "time": iso(info["ts"])})
    if nd < 3 and c["outs"]:
        o = c["outs"][0]; info = v_tron(o["h"])
        if info["status"] == "success" and len(info["transfers"]) == 1:
            t = info["transfers"][0]
            if tron_frozen(t["to"]): continue
            nd += 1; cu = cust(); assign("tron", t["to"], cu)
            add(f"FRZ-TD{nd}", "deposit from a now-frozen sender", "tron", o["h"], "D09",
                f"Real USDT deposit to the customer's sample address from {c['addr']}, which Tether has since blacklisted (AddedBlackList); isBlackListed() is true today. Ops must escalate to compliance rather than treat it as a normal deposit.",
                [link("tron", o["h"])] + src, customer=cu, company=True,
                facts={"status": info["ret"], "from": t["from"], "to": t["to"], "amount": amount(t), "sender_frozen_now": True, "time": iso(info["ts"])})
eb = json.load(open(HERE / "eth_bl_cands.json")); nf = nd = nc = 0
for c in eb:
    if not eth_frozen(c["token"], c["addr"]): continue
    src = [{"label": f"{'Tether AddedBlackList' if c['token']=='usdt' else 'Circle Blacklisted'} event (freeze tx)", "url": EXPLORER["ethereum"].format(c["freeze_tx"])}]
    if c["token"] == "usdt" and nf < 2 and c["fails"]:
        f = c["fails"][0]; info = v_eth(f["h"])
        if info["status"] == "failed" and (info["method"] or "").startswith("transfer"):
            nf += 1
            add(f"FRZ-EF{nf}", "frozen sender, transfer reverted", "ethereum", f["h"], "D03",
                f"Sender {c['addr']} was blacklisted by Tether before this USDT {info['method']} call, which reverted. Primary answer: failed; the freeze must be flagged too.",
                [link("ethereum", f["h"])] + src, findings=["D09"], facts={"status": info["result"], "sender": c["addr"], "sender_frozen_now": True, "time": iso(info["ts"])})
    want = (c["token"] == "usdt" and nd < 2) or (c["token"] == "usdc" and nc < 1)
    if want and c["outs"]:
        o = c["outs"][0]; info = v_eth(o["h"])
        tok = USDT_ETH if c["token"] == "usdt" else USDC_ETH
        ts_ = [x for x in info["transfers"] if x["contract"] == tok and x["from"] == c["addr"]]
        if info["status"] == "success" and len(info["transfers"]) == 1 and ts_:
            t = ts_[0]
            if eth_frozen(c["token"], t["to"]): continue
            cu = cust(); assign("ethereum", t["to"], cu)
            if c["token"] == "usdt": nd += 1; cid = f"FRZ-ED{nd}"
            else: nc += 1; cid = "FRZ-EC1"
            add(cid, "deposit from a now-frozen sender", "ethereum", o["h"], "D09",
                f"Real {c['token'].upper()} deposit to the customer's sample address from {c['addr']}, which the issuer has since blacklisted; the issuer's freeze call returns true today. Ops must escalate to compliance.",
                [link("ethereum", o["h"])] + src + ([CIRCLE_LIST] if c["token"] == "usdc" else []), customer=cu, company=True,
                facts={"status": info["result"], "from": t["from"], "to": t["to"], "amount": amount(t), "token": c["token"].upper(), "sender_frozen_now": True, "time": iso(info["ts"])})

# ---------- 7. Fake / counterfeit USDT on Ethereum ----------
fakes = json.load(open(HERE / "eth_fakes.json")) + [{"contract": "0x7e77b5ca18a5bc08a42d5e3746f28bafd091c7d0", "h": "0x909804df7f566cb0fbf3c10d244b49bf6227783c6cba1c520c259092b894dc4b"}]
def mev_transfers(h):
    rc = http("https://rpc.mevblocker.io", {"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionReceipt", "params": [h]})["result"]
    return [{"contract": l["address"].lower(), "from": "0x" + l["topics"][1][-40:], "to": "0x" + l["topics"][2][-40:], "logIndex": int(l["logIndex"], 16)}
            for l in rc["logs"] if l["topics"] and l["topics"][0] == TRANSFER and len(l["topics"]) == 3]
for i, f in enumerate(fakes, 1):
    info = v_eth(f["h"]); sym = symbol("ethereum", f["contract"])
    ts_ = [x for x in mev_transfers(f["h"]) if x["contract"] == f["contract"].lower()]
    assert sym == "USDT" and ts_, (f, sym)
    cu = cust(); assign("ethereum", ts_[0]["to"], cu)
    add(f"FAKE-{i:02d}", "fake token (symbol USDT)", "ethereum", f["h"], "D06",
        f"A 'USDT' transfer to the customer's sample deposit address from token contract {f['contract']}, which returns symbol() 'USDT' but is not Tether's Ethereum contract (0xdAC17F958D2ee523a2206206994597C13D831ec7 on Tether's official list). Not real USDT; must not be credited.",
        [link("ethereum", f["h"]), {"label": "Blockscout token page", "url": f"https://eth.blockscout.com/token/{f['contract']}"}, TETHER_LIST], customer=cu, company=True,
        facts={"status": info["result"], "token_contract": f["contract"].lower(), "symbol": sym, "from": ts_[0]["from"], "to": ts_[0]["to"], "transfers_in_tx": len(mev_transfers(f["h"])), "time": iso(info["ts"])})
# Homoglyph counterfeit from Bitquery's write-up: symbol 'ÚЅDТ' (Cyrillic letters) inside a 187-transfer forgery batch.
h = "0xf84dacfeb3a92ae3291120d954b86d89932fe31702103754cad4f8e8ac41a10d"; info = v_eth(h)
hg = [x for x in mev_transfers(h) if x["contract"] == "0x647a139b234dcf9f91b1b749993604e715d3acb8"]
cu = cust(); assign("ethereum", hg[0]["to"], cu)
add("FAKE-HG", "fake token (look-alike symbol)", "ethereum", h, "D06",
    "A 'ÚЅDТ' transfer to the customer's sample deposit address from counterfeit token 0x647a139b234dcf9f91b1b749993604e715d3acb8, whose symbol uses Cyrillic look-alike letters to pass as USDT. Documented by Bitquery as counterfeit USDT used in poisoning batches. Must not be credited.",
    [link("ethereum", h), {"label": "Bitquery investigation (counterfeit USDT 0x647a…acb8)", "url": "https://bitquery.io/investigations/address-poisoning-ethereum"}, TETHER_LIST], customer=cu, company=True,
    facts={"status": info["result"], "token_contract": "0x647a139b234dcf9f91b1b749993604e715d3acb8", "symbol": "ÚЅDТ (U+0055 U+0301 U+0405 D U+0422)", "to": hg[0]["to"], "transfers_in_tx": len(mev_transfers(h))})

# ---------- 8. Address poisoning (documented, Bitquery) ----------
BQ = {"label": "Bitquery: Address Poisoning on Ethereum (evidence section)", "url": "https://bitquery.io/investigations/address-poisoning-ethereum"}
for cid, h, intended, lookalike, dust, why in [
    ("POISON-1", "0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f", "0xbaf4b1af7e3b560d937da0458514552b6495f8b5", "0xbaff2f13638c04b10f8119760b2d2ae86b08f8b5",
     "0x9780f38b63f761ccfb8fde3b2c27630646baace1f06b2959a3874849937288bd",
     "19 Dec 2025: 49,999,950 USDT sent to 0xbaff…f8b5 instead of 0xbaf4…f8b5 (same first 3 and last 4 hex characters), 12 minutes after the look-alike sent the victim 0.005 USDT dust."),
    ("POISON-2", "0x374076fa28ed745227c28f42c5054a0bcd024c51ad7a41c17d52e7c6c24980eb", "0x053dba7292957341779cb0e9aae1aa7b139ada3a", "0x053dc459bade1baf76aed6e8630823f8392fda3a",
     "0xf84dacfeb3a92ae3291120d954b86d89932fe31702103754cad4f8e8ac41a10d",
     "9 Aug 2026: 39,889.952535 USDT sent to 0x053dc459…da3a instead of 0x053dba72…da3a (same first 4 and last 4), after a forged counterfeit-USDT transfer from the victim to the look-alike 12 seconds after the victim's real test payment."),
]:
    info = v_eth(h); t = info["transfers"][0]
    assert t["to"] == lookalike and info["status"] == "success"
    cu = cust(); assign("ethereum", intended, cu)
    add(cid, "address poisoning", "ethereum", h, "D07b", why + " Treat the intended address as this customer's sample deposit address.",
        [link("ethereum", h), BQ, {"label": "poisoning transfer", "url": EXPLORER["ethereum"].format(dust)}], customer=cu, company=True, findings=["D07"],
        facts={"status": info["result"], "from": t["from"], "to": t["to"], "intended": intended, "amount": amount(t), "time": iso(info["ts"])},
        extra={"scoring": "correct if the verdict is D07b, or D07 with a D07b finding"})

# ---------- 9. Not found anywhere: real Bitcoin transaction ids (customers paste these) ----------
tip = urllib.request.urlopen("https://mempool.space/api/blocks/tip/hash", timeout=20).read().decode()
txids = json.loads(urllib.request.urlopen(f"https://mempool.space/api/block/{tip}/txids", timeout=20).read())
for i, h in enumerate(txids[1:3], 1):
    add(f"NF-{i}", "not found (Bitcoin txid)", "bitcoin", h, "D01",
        "A real Bitcoin transaction id. It is 64 hex characters, like a Tron or EVM hash, but exists on none of the supported chains, so 'not found on any chain' is correct.",
        [{"label": "mempool.space", "url": f"https://mempool.space/tx/{h}"}])

# ---------- 10. Waiting for confirmations: captured live at run time ----------
# Busy real addresses (most frequent USDT recipients in the scanned window) stand in as two customers'
# deposit addresses. The runner takes the newest real transfer to them, investigates it at once, and
# independently counts confirmations at the same moment: below the threshold, D02 is the right answer.
for cid, chain, addr, threshold in [("LIVE-T", "tron", "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf", 20),
                                    ("LIVE-E", "ethereum", "0xbdb3ba9ffe392549e1f8658dd2630c141fdf47b6", 12)]:
    cu = cust(); assign(chain, addr, cu)
    cases.append({"id": cid, "category": "waiting for confirmations (live capture)", "chain": chain, "tx_hash": None, "input": None,
                  "customer_id": cu, "expected": "D02", "expected_findings": [], "uses_sample_company_data": True, "dynamic": True,
                  "dynamic_address": addr, "confirmation_threshold": threshold,
                  "why_this_answer": f"Captured at run time: the newest real USDT transfer to {addr}. The runner counts confirmations from an independent node at the moment of the check; below {threshold}, 'waiting for confirmations' is correct. The case is scored only when the independent count is below the threshold.",
                  "sources": [{"label": f"{chain} explorer (address)", "url": ("https://tronscan.org/#/address/" if chain == "tron" else "https://etherscan.io/address/") + addr}],
                  "verified_facts": {}})
    print(cid, "dynamic", chain, addr)

# ---------- write ----------
import csv, io
def write_csv(path, rows, cols):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n"); w.writeheader(); [w.writerow(r) for r in rows]
write_csv(OUT / "SAMPLE-file-a-deposit-addresses.csv", file_a, ["address", "chain", "customer_id", "assigned_at", "retired_at", "note"])
write_csv(OUT / "SAMPLE-file-b-ledger.csv", file_b, ["deposit_id", "tx_hash", "chain", "token", "to_address", "amount", "status", "credited_at", "customer_id", "transfer_index", "reason_code", "note"])
json.dump({"generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "about": "Real public stablecoin transactions with independently verified expected diagnoses. Cases with uses_sample_company_data=true depend on tests/real-data/SAMPLE-*.csv, a FICTIONAL company's deposit addresses and ledger that reference real transactions.",
           "cases": cases}, open(REPO / "tests" / "real_cases.json", "w"), indent=1, ensure_ascii=False)
print(len(cases), "cases;", len(file_a), "File A rows;", len(file_b), "File B rows")
