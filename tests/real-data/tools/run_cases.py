"""Runs every real case through the running app exactly as a user would, and scores it.

  by hash   GET /investigate?q=<hash>&customer=<id>   (the "paste a hash" screen)
  by bulk   POST /api/bulk with a CSV of tx_hash,chain,customer_id, then poll the job
  by address  GET /investigate?q=<address>  (the product says this isn't built; recorded as such)

Usage: run_cases.py <label> [--only ID,ID] [--no-bulk]
Writes results-<label>.json and prints the table.
"""
import json, re, sys, time, html, uuid, pathlib, statistics, urllib.request, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from chain import http, rpc, tg, unb58  # noqa

import os; BASE = os.environ.get("BASE", "http://localhost:3210")
REPO = pathlib.Path("..")
HERE = pathlib.Path(__file__).parent
label = sys.argv[1]
only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
import os; cases = json.load(open(REPO / "tests" / os.environ.get("CASES", "real_cases.json")))["cases"]
if only: cases = [c for c in cases if c["id"] in only]

def get(path, timeout=180):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=timeout) as r: body = r.read().decode("utf-8", "replace"); st = r.status
    except urllib.error.HTTPError as e: body = e.read().decode("utf-8", "replace"); st = e.code
    return st, body, time.time() - t

def parse(page):
    """Read the verdict as the user sees it: verdict bar, findings, checks table, evidence links, reply text."""
    out = {}
    page = re.sub(r"<script.*?</script>", "", page, flags=re.S)  # rendered HTML only; the inline React payload repeats sample cases
    m = re.search(r'class="verdict-code">([^<]+)<', page); out["code"] = m.group(1) if m else None
    m = re.search(r'class="verdict-title">([^<]+)<', page); out["title"] = html.unescape(m.group(1)) if m else None
    if out["title"] and out["title"].startswith("Check paused"): out["code"] = "PAUSED"
    m = re.search(r'Confidence</span>.*?>(High|Medium|—|Unknown|None|Paused)<', page, re.S); out["confidence"] = m.group(1) if m else None
    out["matched"] = [m for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)
                      for m in re.findall(r'<td class="code">(D\d+b?)</td><td>.*?Matched \((High|Medium)\)', row, re.S)]
    out["findings"] = [html.unescape(x) for x in re.findall(r'aria-label="(?:Likely cause|Also found): ([^"]+)"', page)]
    out["explorer_links"] = re.findall(r'href="(https://[^"]+)"[^>]*>Explorer', page)
    text = re.sub(r"<[^>]+>", " ", page); text = html.unescape(re.sub(r"\s+", " ", text))
    out["text"] = text
    return out

# ---------- dynamic cases: newest real transfer to a busy address, independent confirmation count ----------
def newest(case):
    a = case["dynamic_address"]
    if case["chain"] == "tron":
        j = http(f"https://api.trongrid.io/v1/accounts/{a}/transactions/trc20?only_to=true&only_unconfirmed=true&limit=1&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
        if not j.get("data"): return None, None
        h = j["data"][0]["transaction_id"]
        for _ in range(8):  # the node may not have the receipt for a few seconds
            info = tg("/wallet/gettransactioninfobyid", {"value": h})
            if info.get("blockNumber"): return h, info["blockNumber"]
            time.sleep(1.5)
        return None, None
    head = int(http("https://rpc.mevblocker.io", {"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})["result"], 16)
    logs = http("https://rpc.mevblocker.io", {"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs", "params": [{"address": "0xdac17f958d2ee523a2206206994597c13d831ec7",
        "fromBlock": hex(head - 6), "toBlock": hex(head), "topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", None, "0x" + a[2:].rjust(64, "0")]}]})["result"]
    if not logs: return None, None
    return logs[-1]["transactionHash"], int(logs[-1]["blockNumber"], 16)
def independent_head(chain):
    if chain == "tron": return tg("/wallet/getnowblock", {})["block_header"]["raw_data"]["number"]
    return int(http("https://rpc.mevblocker.io", {"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})["result"], 16)

results = []
for c in cases:
    r = {"id": c["id"], "category": c["category"], "chain": c["chain"], "expected": c["expected"], "expected_findings": c.get("expected_findings", [])}
    if c.get("dynamic"):
        for attempt in range(6):
            h, blk = newest(c)
            if h: break
            time.sleep(10)
        if not h: r.update(state="skipped", note="no fresh transfer found"); results.append(r); continue
        c = {**c, "tx_hash": h, "input": h}
        r["tx_hash"] = h
    q = urllib.parse.urlencode({"q": c["input"], **({"customer": c["customer_id"]} if c.get("customer_id") else {})})
    st, page, secs = get(f"/investigate?{q}")
    p = parse(page)
    if c.get("dynamic"):
        head = independent_head(c["chain"]); conf = head - blk
        r["independent_confirmations_at_check"] = conf
        if conf >= c["confirmation_threshold"]: r["note"] = f"{conf} confirmations by the time it was checked: not a D02 moment; D12 expected instead"; c["expected"] = r["expected"] = "D12"
    findings_codes = [code for code, conf in p["matched"] if code != p["code"]]
    exp = c["expected"]
    ok = p["code"] == exp
    if not ok and c.get("scoring", "").startswith("correct if the verdict is D07b") and p["code"] == "D07" and "D07b" in findings_codes: ok = True
    missing_findings = [f for f in c.get("expected_findings", []) if f not in findings_codes and f != p["code"]]
    r.update(tx_hash=c["tx_hash"], http=st, secs=round(secs, 2), got=p["code"], confidence=p["confidence"], title=p["title"],
             findings=findings_codes, correct=ok, missing_findings=missing_findings, explorer_links=p["explorer_links"][:6])
    # Evidence checks: every explorer link must point at this hash; the page must not claim what the chain didn't say.
    r["links_ok"] = all(c["tx_hash"].lower().replace("0x", "") in l.lower() for l in p["explorer_links"] if "/tx" in l or "transaction" in l) if p["explorer_links"] else None
    r["page_text_excerpt"] = p["text"][p["text"].find(p["title"] or "") : (p["text"].find(p["title"] or "") + 700)] if p["title"] else p["text"][:400]
    results.append(r)
    print(f"{c['id']:9} exp {exp:5} got {str(p['code']):6} {str(p['confidence']):7} {'OK ' if ok else 'XX '} {secs:6.2f}s  {(p['title'] or '')[:60]}  F={findings_codes}", flush=True)

# ---------- bulk CSV (same cases, one upload) ----------
bulk = {}
if "--no-bulk" not in sys.argv:
    rows = [c for c in cases if not c.get("dynamic")]
    csv_ = "tx_hash,chain,customer_id\n" + "".join(f"{c['tx_hash']},{c['chain'] if c['chain'] in ('tron','ethereum','bsc','polygon','base','arbitrum','optimism') else ''},{c.get('customer_id') or ''}\n" for c in rows)
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="real-cases.csv"\r\nContent-Type: text/csv\r\n\r\n' + csv_ + f"\r\n--{b}--\r\n").encode()
    t0 = time.time()
    req = urllib.request.Request(BASE + "/api/bulk", data=body, method="POST", headers={"content-type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp: job = json.loads(resp.read())
    except urllib.error.HTTPError as e: job = {"error": e.read().decode()[:300], "status": e.code}
    print("bulk start:", json.dumps(job)[:200])
    jid = job.get("id") or job.get("jobId")
    while jid and time.time() - t0 < 1800:
        st, b2, _ = get(f"/api/bulk/{jid}")
        j = json.loads(b2)
        if j.get("status") == "done": break
        time.sleep(3)
    bulk_secs = time.time() - t0
    if jid:
        items = j.get("results", []) if isinstance(j, dict) else []
        by_hash = {(x.get("txHash") or "").lower(): x for x in items}
        agree = 0
        for c in rows:
            x = by_hash.get(c["tx_hash"].lower()); single = next(r for r in results if r["id"] == c["id"])
            single["bulk_code"] = x.get("code") if x else None; single["bulk_state"] = x.get("state") if x else None
            agree += bool(x) and (x.get("code") == single["got"] or (x.get("state") == "paused" and single["got"] == "PAUSED"))
        bulk = {"rows": len(rows), "returned": len(items), "seconds": round(bulk_secs, 1), "agree_with_single": agree}
        print("bulk:", bulk)

# ---------- by address (customer pastes their deposit address) ----------
addr_case = next((c for c in cases if c["chain"] == "tron" and c.get("verified_facts", {}).get("to")), None)
by_address = None
if addr_case:
    st, page, secs = get("/investigate?" + urllib.parse.urlencode({"q": addr_case["verified_facts"]["to"]}))
    p = parse(page); by_address = {"input": addr_case["verified_facts"]["to"], "http": st, "title": p["title"], "secs": round(secs, 2),
                                   "says": p["text"][p["text"].find("Check paused"):][:260]}
    print("by address:", by_address)

scored = [r for r in results if "correct" in r]
secs = [r["secs"] for r in scored]
summary = {"label": label, "cases": len(results), "scored": len(scored), "correct": sum(r["correct"] for r in scored),
           "accuracy": round(sum(r["correct"] for r in scored) / max(1, len(scored)), 3),
           "normal_cases": sum(1 for r in scored if r["expected"] == "D13"),
           "false_alarms_on_normal": sum(1 for r in scored if r["expected"] == "D13" and r["got"] != "D13"),
           "wrong_and_confident": sum(1 for r in scored if not r["correct"] and r["confidence"] == "High"),
           "paused": sum(1 for r in scored if r["got"] == "PAUSED"),
           "median_secs": round(statistics.median(secs), 2) if secs else None, "slowest_secs": max(secs) if secs else None,
           "bulk": bulk, "by_address": by_address}
per = {}
for r in scored:
    d = per.setdefault(r["expected"], {"cases": 0, "correct": 0, "wrong": 0, "needs_review_or_paused": 0})
    d["cases"] += 1
    if r["correct"]: d["correct"] += 1
    elif r["got"] in ("PAUSED", "D99") or r["confidence"] == "Medium": d["needs_review_or_paused"] += 1
    else: d["wrong"] += 1
summary["per_diagnosis"] = per
json.dump({"summary": summary, "results": results}, open(HERE / f"results-{label}.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in summary.items() if k != "per_diagnosis"}, indent=1)); print(json.dumps(per, indent=1))
