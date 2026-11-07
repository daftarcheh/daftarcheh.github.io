# دفترچه برای Obsidian

راست‌به‌چپِ دفترچه و ظاهر مقاله‌اش در Obsidian:

- هر پاراگراف، سرتیتر، مورد فهرست و خانهٔ جدول جهت خودش را از کلمه‌هایش می‌گیرد، با همان قاعدهٔ دفترچه. جملهٔ فارسی پر از اصطلاح انگلیسی راست‌به‌چپ می‌ماند.
- داخل متن فارسی، تکه‌های انگلیسی، مسیرها و نسخه‌ها (`Load Balancer v2.0`، `/etc/hosts`) به‌هم‌ریخته نمی‌شوند.
- در ویرایشگر (Source و Live Preview) هم هر خط جهت خودش را دارد. بلوک کد و front matter چپ‌به‌راست می‌مانند.
- قلم‌های دفترچه: Vazirmatn، Inter و JetBrains Mono.
- برچسب‌های `{ok: …}`، `{bad: …}`، `{warn: …}` و `{info: …}`، بلوک‌های ` ```log ` (خط‌های `!!` پررنگ) و ` ```svg `.
- ظاهر مقاله برای یادداشت‌هایی که `cssclasses: article` دارند، با `eyebrow` و `lede` از front matter.

## نصب

1. در vault خودت پوشهٔ `.obsidian/plugins/daftarcheh/` را بساز.
2. این سه فایل را در آن بگذار:
   - https://daftarcheh.github.io/obsidian/daftarcheh/manifest.json
   - https://daftarcheh.github.io/obsidian/daftarcheh/main.js
   - https://daftarcheh.github.io/obsidian/daftarcheh/styles.css
3. Obsidian › Settings › Community plugins: اگر خاموش است روشنش کن، فهرست را تازه کن و **Daftarcheh** را فعال کن.

## ساختن

`main.js` و `styles.css` از `obsidian/src/` و خود `src/app.js` ساخته می‌شوند (`python3 tools/obsidian.py`، که `tools/build.py` هم اجرایش می‌کند). منطق راست‌به‌چپ، پاک‌سازی SVG و قلم‌ها مستقیم از برنامه کپی می‌شوند، پس Obsidian و دفترچه یک یادداشت را یک‌جور می‌خوانند. آزمون: `node tools/obsidian-test.js`.
