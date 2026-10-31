def lin(c):
    c/=255
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def hx(h):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def L(rgb): r,g,b=[lin(x) for x in rgb]; return 0.2126*r+0.7152*g+0.0722*b
def blend(fg,a,bg): return tuple(round(fg[i]*a+bg[i]*(1-a)) for i in range(3))
def cr(a,b):
    la,lb=L(a),L(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def C(a,b): 
    a=hx(a) if isinstance(a,str) else a; b=hx(b) if isinstance(b,str) else b
    return cr(a,b)
P=[ # light product
("L text-3 / panel","#8a8d94","#ffffff"),
("L text-3 / canvas","#8a8d94","#f7f7f5"),
("L text-3 / panel-2","#8a8d94","#fafaf9"),
("L text-2 / panel","#5b5e66","#ffffff"),
("L text-2 / panel-2","#5b5e66","#fafaf9"),
("L accent / panel","#3b5bdb","#ffffff"),
("L accent / accent-soft","#3b5bdb","#edf1fd"),
("L accent-text / accent","#ffffff","#3b5bdb"),
("L green / green-soft","#1f7a3d","#e9f5ec"),
("L green / panel","#1f7a3d","#ffffff"),
("L amber / amber-soft","#8a5a00","#fdf3dc"),
("L red / red-soft","#b42318","#fdecea"),
("L border-strong / panel","#d2d2cc","#ffffff"),
("L border / panel","#e4e4e0","#ffffff"),
("L focus / panel","#3b5bdb","#ffffff"),
("L focus / canvas","#3b5bdb","#f7f7f5"),
("L text-3 / amber-soft","#8a8d94","#fdf3dc"),
("L text-3 / accent-soft","#8a8d94","#edf1fd"),
("D text-3 / panel","#767982","#18191d"),
("D text-3 / canvas","#767982","#111215"),
("D text-3 / panel-2","#767982","#1d1e23"),
("D text-2 / panel","#a4a7ae","#18191d"),
("D accent / accent-soft","#6b86f0","#1e2440"),
("D accent-text / accent","#0d1020","#6b86f0"),
("D accent / panel","#6b86f0","#18191d"),
("D green / green-soft","#5cc98a","#15291e"),
("D amber / amber-soft","#e8b45a","#2e2512"),
("D red / red-soft","#f1877d","#351a18"),
("D red / panel","#f1877d","#18191d"),
("D focus / panel","#8aa0f5","#18191d"),
("D focus / accent","#8aa0f5","#6b86f0"),
("D border-strong / panel","#383a41","#18191d"),
("D border-strong / canvas","#383a41","#111215"),
("D text-2 / panel-2","#a4a7ae","#1d1e23"),
("D text / panel","#ececee","#18191d"),
("D chip pressed canvas/text","#111215","#ececee"),
("L chip pressed canvas/text","#f7f7f5","#17181c"),
("L border-strong / canvas","#d2d2cc","#f7f7f5"),
# website
("W faint / ink","#8a93a3","#0a0c11"),
("W faint / panel","#8a93a3","#11141b"),
("W muted / ink","#a3abba","#0a0c11"),
("W muted / panel","#a3abba","#11141b"),
("W accent / ink","#8ea2ff","#0a0c11"),
("W accent / panel","#8ea2ff","#11141b"),
("W bad / panel","#f28b82","#11141b"),
("W ink / fg (btn)","#0a0c11","#eceef4"),
("W accent-strong / ink","#6e7df0","#0a0c11"),
("W accent-strong / panel","#6e7df0","#11141b"),
("W good / ink","#5fd3a0","#0a0c11"),
("W warn / ink","#f5b85c","#0a0c11"),
]
for n,a,b in P: print(f"{n:32s} {C(a,b):5.2f}")
ink=hx("#0a0c11"); panel=hx("#11141b"); white=(255,255,255)
ls=blend(white,0.14,panel); l=blend(white,0.08,panel); lsi=blend(white,0.14,ink)
print("line-strong on panel",ls, f"{cr(ls,panel):.2f}", "line on panel", f"{cr(l,panel):.2f}", "line-strong over ink", f"{cr(lsi,ink):.2f}")
# Partners form field bg-ink inside panel: border line-strong vs ink field and panel
print("line-strong(over panel) vs ink field", f"{cr(ls,ink):.2f}")
print("accent border vs ink",f"{cr(hx('#8ea2ff'),ink):.2f}", "accent vs line-strong", f"{cr(hx('#8ea2ff'),ls):.2f}")
# radio checked bg accent/10 on panel
a10=blend(hx('#8ea2ff'),0.10,panel); print("accent/10 on panel",a10, "fg on it", f"{cr(hx('#eceef4'),a10):.2f}", "muted on panel",f"{cr(hx('#a3abba'),panel):.2f}")
# panel/40 section bg over ink
p40=blend(panel,0.4,ink); print("panel/40 over ink",p40,"faint on it",f"{cr(hx('#8a93a3'),p40):.2f}")
# product amber border mix 35%
for nm,fg,bg in [("L amber35 border vs amber-soft","#8a5a00","#fdf3dc")]:
    m=blend(hx(fg),0.35,hx(bg)); print(nm,m,f"{cr(m,hx(bg)):.2f}")
# pill-matched green 45% border on panel
m=blend(hx('#1f7a3d'),0.45,hx('#ffffff')); print("L green45 border vs panel",f"{cr(m,hx('#ffffff')):.2f}")
