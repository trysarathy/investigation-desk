import sys, json; sys.path.insert(0, '.'); from chain import *
chain, nblocks, official = sys.argv[1], int(sys.argv[2]), [a.lower() for a in sys.argv[3].split(",")]
head = int(rpc(chain, "eth_blockNumber", []), 16)
failed, fakes, normal = [], {}, []
for b in range(head - 30 - nblocks, head - 30):
    try:
        rcs = rpc(chain, "eth_getBlockReceipts", [hex(b)])
    except Exception as e:
        print("blk", b, e); continue
    for r in rcs:
        to = (r.get("to") or "").lower()
        if r["status"] == "0x0" and to in official: failed.append({"h": r["transactionHash"], "b": b, "to": to})
        for l in r["logs"]:
            if l["topics"] and l["topics"][0] == TRANSFER and len(l["topics"]) == 3:
                a = l["address"].lower()
                if a in official:
                    if r["status"] == "0x1" and len(normal) < 400: normal.append({"h": r["transactionHash"], "b": b, "c": a, "from": "0x" + l["topics"][1][-40:], "to": "0x" + l["topics"][2][-40:], "raw": int(l["data"], 16) if l["data"] not in ("0x", "") else 0, "li": int(l["logIndex"], 16), "n": len(r["logs"])})
                else:
                    fakes.setdefault(a, []).append({"h": r["transactionHash"], "b": b, "from": "0x" + l["topics"][1][-40:], "to": "0x" + l["topics"][2][-40:]})
syms = {}
for a in fakes:
    s = symbol(chain, a); syms[a] = s
    if s and ("USDT" in s.upper() or "USDC" in s.upper()): print("FAKE?", a, repr(s), len(fakes[a]), fakes[a][0]["h"])
json.dump({"head": head, "failed": failed, "normal": normal, "fakes": {a: v for a, v in fakes.items() if syms.get(a) and ("USD" in syms[a].upper())}, "syms": {a: s for a, s in syms.items() if s and "USD" in s.upper()}}, open(f"scan_{chain}.json", "w"), indent=1)
print(chain, "failed", len(failed), "normal", len(normal), "contracts", len(fakes))
