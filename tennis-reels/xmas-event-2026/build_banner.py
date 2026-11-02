import base64, re
from pathlib import Path
here=Path(__file__).parent
def b64(p): return "data:image/png;base64,"+base64.b64encode((here/p).read_bytes()).decode()
lights=re.search(r'<svg class="lights".*?</svg>', (here/"poster_tpl.html").read_text(), re.S).group(0)
html=(here/"banner_tpl.html").read_text().replace("{{LIGHTS}}",lights)
for k,p in {"XMAS":"tree_a.png","UL":"rk/ul.png","S100":"rk/s100.png","CORNER":"corner_rgba.png"}.items():
    html=html.replace("{{%s}}"%k,b64(p))
(here/"banner.html").write_text(html)
print("built")
