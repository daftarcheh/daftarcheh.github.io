#!/usr/bin/env python3
"""Build the Obsidian plugin (obsidian/daftarcheh/) from obsidian/src/ and the app itself.

The right-to-left logic (textDir, bdiText and their helpers), the SVG sanitiser and the fonts are copied
from src/app.js, so Obsidian and the app always read a note the same way. Run by tools/build.py too.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'src' / 'app.js'
SRC = ROOT / 'obsidian' / 'src'
OUT = ROOT / 'obsidian' / 'daftarcheh'

SHARED = ['escapeHtml', 'countOf', 'RTL_RE', 'hasRTL', 'FA_GLUE', 'FLOW_ARROW', 'FLOW_SPLIT', 'textDir', 'isCodeToken',
          'PUNCT_LEAD', 'PUNCT_TAIL', 'BRACKET_OPEN', 'tokInfo', 'unmatchedBracketCut', 'bdiText', 'SVG_TAGS', 'renderSvgBlock']
FONTS = ['Vazirmatn', 'Inter', 'JetBrains Mono']


def top_level(src: str, name: str) -> str:
    """A top-level `function name(` or `var name =` of the app, whole. Top-level code in src/app.js closes its functions
    with a `}` in column 0 (or on the same line), and its vars with a line ending in `;`."""
    lines = src.split('\n')
    for k, line in enumerate(lines):
        if re.match(r'^(function %s\(|var %s\b)' % (re.escape(name), re.escape(name)), line):
            break
    else:
        raise SystemExit('obsidian: %s not found in src/app.js' % name)
    if line.startswith('var'):
        end = k
        while not lines[end].rstrip().endswith(';'):
            end += 1
        return '\n'.join(lines[k:end + 1])
    if line.rstrip().endswith('}') and line.count('{') == line.count('}'):
        return line
    end = k + 1
    while not lines[end].startswith('}'):
        end += 1
    return '\n'.join(lines[k:end + 1])


def fonts(src: str) -> str:
    out = []
    for line in src.split('\n'):
        line = line.strip()
        if not line.startswith("'@font-face"):
            continue
        fam = re.search(r"font-family:\\'([^\\]+)\\'", line)
        if fam and fam.group(1) in FONTS:
            out.append(line[1:-2].replace("\\'", "'"))
    return '\n'.join(out)


def plugin_version(release: str) -> str:
    """The plugin's own version, semver as Obsidian and BRAT compare it: <app release>.<patch>. The patch comes from
    obsidian/src/VERSION while that file belongs to this release, so a fix to the plugin alone ships (BRAT updates on a
    higher version) without a new app release; a new app release starts the plugin again at .0."""
    f = SRC / 'VERSION'
    v = f.read_text(encoding='utf-8').strip() if f.exists() else ''
    return v if re.fullmatch(re.escape(release) + r'\.\d+', v) else release + '.0'


def main() -> int:
    app = APP.read_text(encoding='utf-8')
    version = plugin_version(json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))['release'])
    OUT.mkdir(parents=True, exist_ok=True)
    shared = '\n'.join(top_level(app, n) for n in SHARED)
    main_js = (SRC / 'main.js').read_text(encoding='utf-8').replace('/*@@SHARED@@*/', '/* ---------- SHARED: from src/app.js ---------- */\n' + shared)
    (OUT / 'main.js').write_text(main_js, encoding='utf-8')
    css = (SRC / 'styles.css').read_text(encoding='utf-8').replace('/*@@FONTS@@*/', fonts(app))
    (OUT / 'styles.css').write_text(css, encoding='utf-8')
    manifest = {
        'id': 'daftarcheh',
        'name': 'Daftarcheh',
        'version': version,
        'minAppVersion': '1.4.0',
        'description': "Right-to-left the way Daftarcheh does it — each paragraph and line its own direction — and Daftarcheh's fonts and article look.",
        'author': 'Saeed Hosseini',
        'authorUrl': 'https://daftarcheh.github.io/',
        'isDesktopOnly': False,
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('obsidian plugin → obsidian/daftarcheh/ (main.js %d KB, styles.css %d KB)' % ((OUT / 'main.js').stat().st_size // 1024, (OUT / 'styles.css').stat().st_size // 1024))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
