"""Small read-only helpers for collecting ground truth. Independent of the product's code."""
import json, urllib.request, time
RPC = {"ethereum": "https://eth.drpc.org", "bsc": "https://bsc-dataseed.bnbchain.org",
       "polygon": "https://polygon.drpc.org", "arbitrum": "https://arb1.arbitrum.io/rpc",
       "base": "https://mainnet.base.org", "optimism": "https://optimism-rpc.publicnode.com"}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7"; USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; BSC_USD = "0x55d398326f99059ff775485246999027b3197955"

def http(url, body=None, headers=None, tries=4):
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                       headers={"content-type": "application/json", "user-agent": "Mozilla/5.0", **(headers or {})})
            with urllib.request.urlopen(r, timeout=30) as f: return json.loads(f.read())
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(1.5 * (i + 1))

def rpc(chain, method, params):
    j = http(RPC[chain], {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in j: raise RuntimeError(j["error"])
    return j["result"]

def call(chain, to, data): return rpc(chain, "eth_call", [{"to": to, "data": data}, "latest"])
def word(addr): return addr.lower().replace("0x", "").rjust(64, "0")
def symbol(chain, c):
    try:
        r = call(chain, c, "0x95d89b41"); b = bytes.fromhex(r[2:])
        if len(b) >= 96: n = int.from_bytes(b[32:64], "big"); return b[64:64 + n].decode("utf-8", "replace")
        return b.rstrip(b"\0").decode("utf-8", "replace")
    except Exception as e: return None

def evm_tx(chain, h):
    tx = rpc(chain, "eth_getTransactionByHash", [h]); rc = rpc(chain, "eth_getTransactionReceipt", [h])
    out = {"status": rc and rc["status"], "block": tx and int(tx["blockNumber"], 16), "from": tx and tx["from"], "to": tx and tx["to"], "transfers": []}
    for l in (rc or {}).get("logs", []):
        if l["topics"] and l["topics"][0] == TRANSFER and len(l["topics"]) == 3:
            out["transfers"].append({"contract": l["address"], "from": "0x" + l["topics"][1][-40:], "to": "0x" + l["topics"][2][-40:],
                                     "raw": int(l["data"], 16) if l["data"] not in ("0x", "") else 0, "logIndex": int(l["logIndex"], 16)})
    return out

def bs(path): return http("https://eth.blockscout.com/api/v2/" + path)
def tronscan(h): return http(f"https://apilist.tronscanapi.com/api/transaction-info?hash={h}")
def tg(path, body=None): return http("https://api.trongrid.io" + path, body)

import hashlib
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58(hex41):
    raw = bytes.fromhex(hex41); chk = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[:4]
    n = int.from_bytes(raw + chk, "big"); s = ""
    while n: n, r = divmod(n, 58); s = _B58[r] + s
    return s
def tron_addr(h):
    h = h.lower().replace("0x", "")
    if len(h) == 40: h = "41" + h
    return b58(h)
def unb58(s):
    n = 0
    for c in s: n = n * 58 + _B58.index(c)
    return n.to_bytes(25, "big")[:21].hex()
