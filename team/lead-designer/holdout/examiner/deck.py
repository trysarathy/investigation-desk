exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'cr.py')).read().split('P=[')[0])
INK="#0b0e14";CARD="#151a24";LINE="#2a3140"
for n,c in [("WHITE","#f2f4f7"),("MUTED","#a3aab6"),("FAINT","#767e8c"),("ACC","#8ea2ff"),("ACC2","#b9c6ff"),("RED","#ff8a7f"),("LINE","#2a3140")]:
    print(f"{n:6s} ink {C(c,INK):5.2f}  card {C(c,CARD):5.2f}")
print("card vs ink", f"{C(CARD,INK):.2f}")
# product chip count opacity .7
print("L chip count", f"{C(blend(hx('#17181c'),0.7,hx('#ffffff')),hx('#ffffff')):.2f}")
print("L text-2 on accent-soft", f"{C('#5b5e66','#edf1fd'):.2f}", "L text-2 on amber-soft", f"{C('#5b5e66','#fdf3dc'):.2f}","L text-3 on red-soft",f"{C('#8a8d94','#fdecea'):.2f}")
print("L text-3 on green-soft",f"{C('#8a8d94','#e9f5ec'):.2f}")
print("D text-3 on accent-soft",f"{C('#767982','#1e2440'):.2f}","D text-3 amber-soft",f"{C('#767982','#2e2512'):.2f}")
# website faint candidate check for footer etc fine. Deck FAINT replacement candidates
for c in ["#8a93a3","#878f9c","#8d95a3","#9099a7"]:
    print("deck faint cand",c, f"ink {C(c,INK):.2f} card {C(c,CARD):.2f}")
