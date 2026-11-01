import sys
OUT=sys.argv[1]
THEMES={
 "light":dict(font="Inter, sans-serif",bg="#ffffff",box="#f4f5f8",boxs="#a3abba",cl="#f7f8ff",main="#6e7df0",ink="#0a0c11",sec="#5b6272",warn="#a8670f",warnfill="#ffffff",ok="#2f7d5b",okfill="#eaf7f0",arrow="#5b6272",labm="#5b6272",labw="#5b6272"),
 "dark":dict(font="Arial, sans-serif",bg="#0b0e14",box="#151a24",boxs="#2a3140",cl="#151a24",main="#8ea2ff",ink="#f2f4f7",sec="#a3aab6",warn="#ff8a7f",warnfill="#151a24",ok="#b9c6ff",okfill="#151a24",arrow="#a3aab6",labm="#8ea2ff",labw="#ff8a7f"),
}
TITLE="How one stablecoin payment flows through Clearline"
DESC=("A customer pays on-chain. Clearline reads the transfer read-only and never holds funds, checks it is genuine "
      "(token contract, network, address, confirmations) and matches it to the invoice. If something is wrong, it explains "
      "it in plain English and drafts a reply. Either way, nothing is posted until a person approves; then the payment is "
      "posted to the invoice in Xero. QuickBooks is next and not built; NetSuite is designed, not built.")
def svg(t):
    T=THEMES[t]; W,H=900,470
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{T["font"]}" role="img" aria-labelledby="t d">',
       f'<title id="t">{TITLE}</title><desc id="d">{DESC}</desc>',
       '<defs>'+''.join(f'<marker id="{n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>' for n,c in [("m",T["main"]),("w",T["warn"]),("g",T["arrow"])])+'</defs>',
       f'<rect width="{W}" height="{H}" fill="{T["bg"]}"/>']
    # Clearline boundary (steps 2-4 + explain)
    o.append(f'<rect x="228" y="16" width="656" height="330" rx="12" fill="{T["cl"]}" stroke="{T["main"]}" stroke-width="1.4"/>')
    o.append(f'<text x="246" y="40" font-size="12" font-weight="700" fill="{T["labm"]}" letter-spacing="1">CLEARLINE · READ-ONLY, NEVER HOLDS FUNDS</text>')
    def node(x,y,w,h,title,subs,fill,stroke,dash=None,tc=None,sw=1.2):
        d=f' stroke-dasharray="{dash}"' if dash else ''
        o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')
        o.append(f'<text x="{x+14}" y="{y+26}" font-size="15" font-weight="600" fill="{tc or T["ink"]}">{title}</text>')
        for i,s in enumerate(subs):
            o.append(f'<text x="{x+14}" y="{y+47+i*18}" font-size="13" fill="{T["sec"]}">{s}</text>')
    node(16,60,190,92,"1 Customer pays",["USDC or USDT,","on-chain"],T["box"],T["boxs"])
    node(246,60,190,92,"2 Reads the transfer",["from the public chain;","no wallet keys"],T["bg"] if t=="light" else T["box"],T["main"])
    node(470,60,190,110,"3 Checks it's genuine",["token contract","network · address","confirmations"],T["bg"] if t=="light" else T["box"],T["main"])
    node(694,60,174,92,"4 Matches",["to its invoice:","amount, reference"],T["bg"] if t=="light" else T["box"],T["main"])
    node(246,226,232,104,"Explains what's wrong",["short, fake, wrong network,","no reference: in plain English,","with a draft reply"],T["warnfill"],T["warn"],dash="6 4",sw=1.6)
    node(430,370,232,84,"5 A person approves",["nothing is posted before this"],T["box"],T["ink"],sw=2)
    node(740,360,144,100,"6 Posted in Xero",["to the invoice","QuickBooks next","(not built)"],T["okfill"],T["ok"],tc=T["ok"],sw=1.6)
    def line(pts,mk,col,dash=None,w=2):
        d=f' stroke-dasharray="{dash}"' if dash else ''
        m=f' marker-end="url(#{mk})"' if mk else ''
        o.append(f'<polyline points="{" ".join(f"{a},{b}" for a,b in pts)}" fill="none" stroke="{col}" stroke-width="{w}"{d}{m}/>')
    line([(206,106),(244,106)],"m",T["main"])
    line([(436,106),(468,106)],"m",T["main"])
    line([(660,106),(692,106)],"m",T["main"])
    # all good: 4 -> person approves (solid)
    line([(781,152),(781,250),(586,250),(586,368)],"m",T["main"])
    o.append(f'<text x="598" y="242" font-size="13" font-weight="600" fill="{T["labm"]}">checks pass, matched</text>')
    # problem path from 3 and 4 (dashed, labelled)
    line([(565,170),(565,212)],None,T["warn"],dash="6 4")
    line([(712,152),(712,212),(362,212),(362,224)],"w",T["warn"],dash="6 4")
    o.append(f'<text x="376" y="204" font-size="13" font-weight="600" fill="{T["labw"]}">something is wrong</text>')
    line([(362,330),(362,354),(500,354),(500,368)],"w",T["warn"],dash="6 4")
    # approve -> post
    line([(662,412),(738,412)],"m",T["main"],w=2.5)
    o.append(f'<text x="670" y="404" font-size="12" font-weight="600" fill="{T["labm"]}">approve</text>')
    # legend
    o.append(f'<g font-size="12" fill="{T["sec"]}"><line x1="16" y1="190" x2="46" y2="190" stroke="{T["main"]}" stroke-width="2"/><text x="54" y="194">payment checks out</text>'
             f'<line x1="16" y1="214" x2="46" y2="214" stroke="{T["warn"]}" stroke-width="2" stroke-dasharray="6 4"/><text x="54" y="218">problem: explained first</text>'
             f'<text x="16" y="250">NetSuite: designed,</text><text x="16" y="266">not built</text></g>')
    o.append('</svg>')
    open(f"{OUT}/payment-flow-{t}.svg","w").write("\n".join(o))
for t in THEMES: svg(t)
