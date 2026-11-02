# 3000×900mm, 100dpi → 11811×3543px
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
here=Path(__file__).parent; url=(here/"banner.html").resolve().as_uri()
scale=float(sys.argv[1]) if len(sys.argv)>1 else 11811/1500
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={"width":1500,"height":450},device_scale_factor=scale); pg.goto(url); pg.wait_for_timeout(500)
    print(pg.evaluate("""[...document.querySelectorAll('.mid,.grand,.photo')].map(e=>{const r=e.getBoundingClientRect();return e.className+' '+Math.round(r.top)+'-'+Math.round(r.bottom)})"""))
    pg.screenshot(path=str(here/"banner.png"))
    pg.pdf(path=str(here/"현수막_3000x900.pdf"), width="3000mm", height="900mm", print_background=True, scale=2000/1500*0.0+1, margin={"top":"0","bottom":"0","left":"0","right":"0"}) if False else None
    b.close()
im=Image.open(here/"banner.png").convert("RGB"); print(im.size)
im.save(here/"현수막_3000x900_100dpi.jpg", quality=93, dpi=(100,100))
im.resize((1500,450)).save(here/"banner_preview.png")
