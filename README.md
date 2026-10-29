# دفترچه

یادداشت فارسی، همگام با گیت‌هاب: https://daftarcheh.github.io/

- دفترچه‌های یادداشت روی مخزن‌های گیت‌هاب، با کار آفلاین و همگام‌سازی خودکار
- نمایش راست‌چین Markdown با حالت مقاله، جدول، Mermaid، SVG، فرمول ریاضی و callout
- اشتراک امن با گیست، ارائه (اسلاید از Markdown) و خروجی PDF، HTML و تصویر
- JSON، YAML، CSV، Log، SQL، Diff، JWT و Cron با تشخیص خودکار، در تب‌های موقت

## توسعه

| مسیر | نقش |
| --- | --- |
| `src/app.js` | کد اپ (ویرایش اینجا) |
| `src/index.shell.html` | پوستهٔ HTML |
| `app.js` / `index.html` | کپی سروشده |
| `vendor/` | Mermaid و KaTeX |

```bash
$EDITOR src/app.js
python3 tools/build.py --shell
python3 -m http.server 8765
```
