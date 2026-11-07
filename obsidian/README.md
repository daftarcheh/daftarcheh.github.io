# دفترچه برای Obsidian

راست‌به‌چپِ دفترچه و ظاهر مقاله‌اش در Obsidian:

- هر پاراگراف، سرتیتر، مورد فهرست و خانهٔ جدول جهت خودش را از کلمه‌هایش می‌گیرد، با همان قاعدهٔ دفترچه. جملهٔ فارسی پر از اصطلاح انگلیسی راست‌به‌چپ می‌ماند: «timeout cron از ۳۰۰ به ۶۰۰ ثانیه رسید.»
- داخل متن فارسی، تکه‌های انگلیسی، مسیرها و نسخه‌ها (`Load Balancer v2.0`، `/etc/hosts`) به‌هم‌ریخته نمی‌شوند، در حالت خواندن و در ویرایشگر.
- در ویرایشگر (Source و Live Preview) هم هر خط جهت خودش را دارد و مکان‌نما و کلیدهای جهت با آن حرکت می‌کنند. بلوک کد و front matter چپ‌به‌راست می‌مانند.
- جهتِ دفترچه می‌ماند حتی وقتی خود Obsidian یا افزونهٔ دیگری (مثل RTL Support) به خط‌ها و پاراگراف‌ها `dir="auto"` می‌دهد.
- قلم‌های دفترچه: Vazirmatn، Inter و JetBrains Mono، داخل خود افزونه (بی‌اینترنت هم کار می‌کند).
- برچسب‌های `{ok: …}`، `{bad: …}`، `{warn: …}` و `{info: …}`، بلوک‌های ` ```log ` (خط‌های `!!` پررنگ) و ` ```svg `.
- ظاهر مقاله برای یادداشت‌هایی که `cssclasses: article` دارند: `eyebrow` و `lede` از front matter، ردیف بقیهٔ ویژگی‌ها و برچسب‌ها زیر آن، فهرست عددی با شماره‌های فارسی در دایره، کادرها با خط کناری و جدول تمام‌عرض.

## نصب

### با BRAT (پیشنهادی، با به‌روزرسانی خودکار)

1. Obsidian › Settings › Community plugins: اگر Restricted mode روشن است خاموشش کن، **BRAT** را جستجو و نصب و فعال کن.
2. Command palette (Ctrl+P) › **BRAT: Add a beta plugin for testing** و این را بچسبان:
   ```
   daftarcheh/daftarcheh.github.io
   ```
3. **Daftarcheh** را در Community plugins فعال کن.

BRAT نسخه‌های تازه را خودش از [Releases](https://github.com/daftarcheh/daftarcheh.github.io/releases) می‌گیرد.

### با یک فرمان

Windows (PowerShell). مسیر vault را در خط اول عوض کن:

```powershell
$vault = "C:\path\to\vault"
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$p = "$vault\.obsidian\plugins\daftarcheh"; New-Item -ItemType Directory -Force $p | Out-Null
"manifest.json","main.js","styles.css" | ForEach-Object { Invoke-WebRequest -UseBasicParsing "https://daftarcheh.github.io/obsidian/daftarcheh/$_" -OutFile "$p\$_" }
```

macOS و Linux:

```bash
vault=~/path/to/vault
p="$vault/.obsidian/plugins/daftarcheh"; mkdir -p "$p"
for f in manifest.json main.js styles.css; do curl -fsSL -o "$p/$f" "https://daftarcheh.github.io/obsidian/daftarcheh/$f"; done
```

بعد: Obsidian › Settings › Community plugins. اگر Restricted mode روشن است خاموشش کن، فهرست را تازه کن و **Daftarcheh** را فعال کن.

### دستی (موبایل هم)

1. در vault خودت پوشهٔ `.obsidian/plugins/daftarcheh/` را بساز.
2. این سه فایل را در آن بگذار:
   - https://daftarcheh.github.io/obsidian/daftarcheh/manifest.json
   - https://daftarcheh.github.io/obsidian/daftarcheh/main.js
   - https://daftarcheh.github.io/obsidian/daftarcheh/styles.css
3. Obsidian › Settings › Community plugins: اگر خاموش است روشنش کن، فهرست را تازه کن و **Daftarcheh** را فعال کن.

### تنظیم‌ها و به‌روزرسانی

- Settings › Editor › Right-to-left (RTL) را **خاموش** بگذار؛ افزونه جهت هر خط را خودش تعیین می‌کند. افزونهٔ RTL Support هم دیگر لازم نیست.
- با BRAT به‌روزرسانی خودکار است. اگر با فرمان یا دستی نصب کرده‌ای، برای نسخهٔ تازه همان سه فایل را دوباره بگیر (همان فرمان بالا) و در Obsidian Ctrl+R بزن.

## ساختن

`main.js` و `styles.css` از `obsidian/src/` و خود `src/app.js` ساخته می‌شوند (`python3 tools/obsidian.py`، که `tools/build.py` هم اجرایش می‌کند). منطق راست‌به‌چپ، پاک‌سازی SVG و قلم‌ها مستقیم از برنامه کپی می‌شوند، پس Obsidian و دفترچه یک یادداشت را یک‌جور می‌خوانند. آزمون: `node tools/obsidian-test.js`.

### نسخه و انتشار

نسخهٔ افزونه `<نسخهٔ برنامه>.<وصله>` است، مثل `2.57.1`: نسخهٔ برنامه از `version.json` و وصله از `obsidian/src/VERSION`. با نسخهٔ تازهٔ برنامه، افزونه خودش از `.0` شروع می‌کند. برای اصلاحی فقط در افزونه، عدد آخر `obsidian/src/VERSION` را یکی بالا ببر و دوباره بساز.

هر بار نسخهٔ `obsidian/daftarcheh/manifest.json` در `main` عوض شود، [`obsidian-release.yml`](../.github/workflows/obsidian-release.yml) برای آن نسخه یک Release با همان سه فایل می‌سازد و BRAT از آن به‌روز می‌شود.
