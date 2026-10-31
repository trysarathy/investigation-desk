import sys; sys.path.insert(0,'.')
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'cr.py')).read().split('P=[')[0])
for c in ["#6e7178","#6b6e76","#696c73","#70737a","#72757c","#676a72"]:
    print("L",c,[f"{C(c,b):.2f}" for b in ["#ffffff","#f7f7f5","#fafaf9","#edf1fd","#fdf3dc"]], "vs text-2 lum diff", f"{C(c,'#5b5e66'):.2f}")
for c in ["#8a8d96","#878a93","#858891","#8c8f98","#90939b"]:
    print("D",c,[f"{C(c,b):.2f}" for b in ["#18191d","#111215","#1d1e23","#1e2440","#2e2512"]], f"vs text-2 {C(c,'#a4a7ae'):.2f}")
