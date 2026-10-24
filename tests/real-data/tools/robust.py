import json, re, sys, html, time, urllib.parse, urllib.request, uuid
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3210"
def get(q):
    t = time.time()
    try:
        with urllib.request.urlopen(BASE + "/investigate?" + urllib.parse.urlencode(q), timeout=200) as r: b = r.read().decode(); s = r.status
    except urllib.error.HTTPError as e: b = e.read().decode(); s = e.code
    b = re.sub(r"<script.*?</script>", "", b, flags=re.S)
    code = re.search(r'class="verdict-code">([^<]+)<', b); title = re.search(r'class="verdict-title">([^<]+)<', b)
    muted = re.search(r'verdict-title">[^<]+</div><div class="muted">(.*?)</div>', b, re.S)
    return {"http": s, "code": code.group(1) if code else None, "title": html.unescape(title.group(1)) if title else None,
            "detail": html.unescape(re.sub("<[^>]+>", "", muted.group(1)))[:200] if muted else None, "secs": round(time.time() - t, 2)}
ETH = "0xf70dab272206" ; cases = json.load(open("../tests/real_cases.json"))["cases"]
eth = next(c for c in cases if c["id"] == "ETH-01"); trn = next(c for c in cases if c["id"] == "TRN-01")
tests = [
    ("invalid hash (too short)", {"q": "0x123"}),
    ("not a hash: free text", {"q": "my money never arrived"}),
    ("exchange withdrawal id", {"q": "WD-20261024-88412"}),
    ("hash with spaces and upper case", {"q": "  " + eth["tx_hash"].upper().replace("0X", "0x") + " ", "customer": eth["customer_id"]}),
    ("Tron hash with 0x prefix", {"q": "0x" + trn["tx_hash"], "customer": trn["customer_id"]}),
    ("customer id is an email", {"q": eth["tx_hash"], "customer": "someone@example.com"}),
    ("unknown customer id", {"q": eth["tx_hash"], "customer": "SAMPLE-C999"}),
    ("no customer given (inferred from File A)", {"q": eth["tx_hash"]}),
    ("Tron address instead of hash", {"q": trn["verified_facts"]["to"]}),
    ("EVM address instead of hash", {"q": eth["verified_facts"]["to"]}),
]
out = []
for name, q in tests:
    r = get(q); r["case"] = name; out.append(r); print(json.dumps(r, ensure_ascii=False))
# wrong chain stated in bulk
b = uuid.uuid4().hex
csv_ = f"tx_hash,chain,customer_id\n{eth['tx_hash']},tron,{eth['customer_id']}\n{trn['tx_hash']},ethereum,{trn['customer_id']}\nnot-a-hash,tron,X\n"
body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="w.csv"\r\nContent-Type: text/csv\r\n\r\n' + csv_ + f"\r\n--{b}--\r\n").encode()
try:
    with urllib.request.urlopen(urllib.request.Request(BASE + "/api/bulk", data=body, method="POST", headers={"content-type": f"multipart/form-data; boundary={b}"}), timeout=60) as r: job = json.loads(r.read())
except urllib.error.HTTPError as e: job = {"error": e.read().decode()[:300]}
for _ in range(60):
    if "id" not in job: break
    j = json.loads(urllib.request.urlopen(BASE + f"/api/bulk/{job['id']}").read())
    if j.get("status") == "done": break
    time.sleep(2)
res = {"case": "bulk rows with the wrong chain + an invalid row", "start": {k: v for k, v in job.items() if k != "id"},
       "results": [{k: x.get(k) for k in ("line", "statedChain", "foundChain", "code", "label", "note")} for x in (j.get("results", []) if "id" in job else [])],
       "rowErrors": j.get("rowErrors") if "id" in job else None}
out.append(res); print(json.dumps(res, ensure_ascii=False))
json.dump(out, open(f"robust-{urllib.parse.urlparse(BASE).port}.json", "w"), indent=1, ensure_ascii=False)
