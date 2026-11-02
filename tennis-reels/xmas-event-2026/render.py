from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).parent
url = (here / "poster.html").resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 794, "height": 1123}, device_scale_factor=3)
    pg.goto(url)
    pg.wait_for_timeout(400)
    pg.pdf(path=str(here / "포스터_A4.pdf"), format="A4", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    pg.screenshot(path=str(here / "포스터_A4.png"), full_page=False)
    b.close()
print("ok")
