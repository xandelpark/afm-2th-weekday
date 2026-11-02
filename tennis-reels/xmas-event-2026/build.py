import base64
from pathlib import Path
here=Path(__file__).parent
def b64(p,mime): return f"data:{mime};base64,"+base64.b64encode((here/p).read_bytes()).decode()
html=(here/"poster_tpl.html").read_text()
html=html.replace("{{XMAS}}",b64("tree_a.png","image/png")).replace("{{UL}}",b64("rk/ul.png","image/png")).replace("{{CORNER}}",b64("corner_rgba.png","image/png")).replace("{{S100}}",b64("rk/s100.png","image/png"))
(here/"poster.html").write_text(html)
print("built")
