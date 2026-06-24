import asyncio, os
from playwright.async_api import async_playwright

HTML = "/Users/craw/afm-2th-weekday/work/vcore_carousel.html"
WORKDIR = "/Users/craw/afm-2th-weekday/work"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1080, "height": 1920},
            device_scale_factor=2
        )
        page = await ctx.new_page()
        await page.goto(f"file://{HTML}")
        await page.wait_for_load_state("networkidle")

        # 9:16 네이티브 재렌더 — 배경만 1920으로 확장, 콘텐츠(.pad)는 원래 1350 가운데 고정
        await page.add_style_tag(content=(
            ".slide{height:1920px !important;}"
            ".pad{"
            "  position:absolute !important;"
            "  top:285px !important;"
            "  left:0 !important; right:0 !important;"
            "  height:1350px !important;"
            "  bottom:auto !important;"
            "}"
            ".ft{"
            "  position:absolute !important;"
            "  bottom:0 !important;"
            "  left:0 !important; right:0 !important;"
            "}"
        ))

        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(3500)

        slides = await page.query_selector_all(".slide")
        print(f"  릴스 슬라이드 {len(slides)}장 발견")

        for i, sl in enumerate(slides, 1):
            path = f"{WORKDIR}/r9_{i:02d}.png"
            await sl.screenshot(path=path)
            print(f"  [r9_{i:02d}] → {path}")

        await browser.close()
        print(f"\n9:16 PNG {len(slides)}장 완료")

asyncio.run(main())
