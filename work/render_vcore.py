import asyncio, os, shutil
from playwright.async_api import async_playwright

HTML = "/Users/craw/afm-2th-weekday/work/vcore_carousel.html"
WORKDIR = "/Users/craw/afm-2th-weekday/work"
OUTDIR = "/Users/craw/Downloads/reels/vcore_string_guide"

SLIDE_NAMES = [
    "cover", "hook", "vcore_intro",
    "beginner_male", "beginner_female",
    "inter_male", "inter_female",
    "summary_table", "tip", "cta"
]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1080, "height": 1350},
            device_scale_factor=2
        )
        page = await ctx.new_page()
        await page.goto(f"file://{HTML}")
        await page.wait_for_load_state("networkidle")
        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(3500)

        slides = await page.query_selector_all(".slide")
        print(f"  슬라이드 {len(slides)}장 발견")

        for i, sl in enumerate(slides, 1):
            name = SLIDE_NAMES[i - 1] if i <= len(SLIDE_NAMES) else f"slide_{i:02d}"
            work_path = f"{WORKDIR}/slide_{i:02d}.png"
            out_path = f"{OUTDIR}/vcore_string_guide_{i:02d}_{name}.png"
            await sl.screenshot(path=work_path)
            shutil.copy(work_path, out_path)
            print(f"  [{i:02d}] {name} → {out_path}")

        await browser.close()
        print(f"\n캐러셀 PNG {len(slides)}장 완료")

asyncio.run(main())
