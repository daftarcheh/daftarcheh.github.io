/* Checks for the Obsidian plugin (obsidian/daftarcheh/main.js) without Obsidian: its API and CodeMirror are stubbed,
   the reading view is a jsdom page shaped like Obsidian's. Run: NODE_PATH=<jsdom's node_modules> node tools/obsidian-test.js */
'use strict';
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); }
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const win = dom.window, doc = win.document;
global.window = win; global.document = doc; global.NodeFilter = win.NodeFilter;
global.DOMParser = win.DOMParser; global.XMLSerializer = win.XMLSerializer;
// Obsidian's element helpers
const HE = win.HTMLElement.prototype;
HE.createEl = function(tag, o){ const e = doc.createElement(tag); if (o && o.cls) e.className = o.cls; if (o && o.text) e.textContent = o.text; this.appendChild(e); return e; };
HE.createDiv = function(o){ return this.createEl('div', o); };
HE.createSpan = function(o){ return this.createEl('span', o); };
HE.appendText = function(t){ this.appendChild(doc.createTextNode(t)); };

const registered = { post: [], blocks: {}, editor: [] };
const stubs = {
  obsidian: { Plugin: class {
    registerMarkdownPostProcessor(f){ registered.post.push(f); }
    registerMarkdownCodeBlockProcessor(lang, f){ registered.blocks[lang] = f; }
    registerEditorExtension(e){ registered.editor.push(e); }
  } },
  '@codemirror/view': {
    Decoration: { line: (spec) => ({ spec }) },
    EditorView: { perLineTextDirection: { of: (v) => ({ perLine: v }) } },
    ViewPlugin: { fromClass: (cls, opts) => ({ cls, opts }) }
  },
  '@codemirror/state': { RangeSetBuilder: class { constructor(){ this.items = []; } add(from, to, deco){ this.items.push({ from, deco }); } finish(){ return this.items; } } }
};
const load0 = Module._load;
Module._load = function(req, parent, isMain){ return stubs[req] || load0.apply(this, arguments); };
const Plugin = require(path.join(__dirname, '..', 'obsidian', 'daftarcheh', 'main.js'));
Module._load = load0;
new Plugin().onload();
ok('the plugin registers a reading-view processor, log and svg blocks, and an editor extension',
  registered.post.length === 1 && registered.blocks.log && registered.blocks.svg && registered.editor.length === 1);

/* ---- reading view ---- */
const view = doc.createElement('div');
view.className = 'markdown-preview-view article';
view.innerHTML = [
  '<h1>عنوان یادداشت</h1>',
  '<p>سرویس Load Balancer v2.0 روی پورت 443 کار می‌کند و فایل /etc/hosts را می‌خواند.</p>',
  '<p>This paragraph is plain English text.</p>',
  '<p>timeout cron از ۳۰۰ به ۶۰۰ ثانیه رسید.</p>',
  '<ul><li>مورد اول فارسی</li><li>مورد دوم فارسی</li><li>English item</li></ul>',
  '<table><thead><tr><th>ستون</th><th>Column</th></tr></thead><tbody><tr><td>فارسی</td><td>English</td></tr></tbody></table>',
  '<p>وضعیت {ok: آماده} و {bad: خراب} و {warn: دقت}</p>',
  '<pre><code>ls -la /var/www</code></pre>'
].join('');
doc.body.appendChild(view);
registered.post[0](view, { frontmatter: { cssclasses: ['article'], eyebrow: 'دفترچه · آزمایش', lede: 'یک خلاصهٔ کوتاه.' } });
const ps = view.querySelectorAll('p:not(.df-lede)');
ok('a Persian sentence full of English terms stays right-to-left', ps[0].getAttribute('dir') === 'rtl');
ok('an English paragraph is left-to-right', ps[1].getAttribute('dir') === 'ltr');
ok('«timeout cron از …»: the Persian function words win (dir="auto" would have said ltr)', ps[2].getAttribute('dir') === 'rtl');
ok('English runs inside Persian text are isolated in <bdi>', /<bdi dir="ltr">v2\.0<\/bdi>|<bdi dir="ltr">[^<]*\/etc\/hosts[^<]*<\/bdi>/.test(ps[0].innerHTML), ps[0].innerHTML);
const lis = view.querySelectorAll('li');
ok('list items each get a direction; the list follows most of them', lis[0].getAttribute('dir') === 'rtl' && lis[2].getAttribute('dir') === 'ltr' && view.querySelector('ul').getAttribute('dir') === 'rtl');
ok('table cells get their own direction', view.querySelectorAll('th')[0].getAttribute('dir') === 'rtl' && view.querySelectorAll('td')[1].getAttribute('dir') === 'ltr');
const tags = [...view.querySelectorAll('.mz-tag')].map((t) => t.className + ':' + t.textContent);
ok('{ok|bad|warn: …} become badges', tags.join('|') === 'mz-tag mz-tag-ok:آماده|mz-tag mz-tag-bad:خراب|mz-tag mz-tag-warn:دقت', tags);
ok('code is left alone (no dir, no bdi)', !view.querySelector('pre').getAttribute('dir') && !view.querySelector('pre bdi'));
ok('article: eyebrow above the title, lede under it', view.querySelector('h1').previousElementSibling.className === 'df-eyebrow'
  && view.querySelector('h1').nextElementSibling.className === 'df-lede');
registered.post[0](view, { frontmatter: { cssclasses: ['article'], eyebrow: 'x', lede: 'y' } });
ok('processing twice adds no second header', view.querySelectorAll('.df-eyebrow').length === 1);

/* ---- code blocks ---- */
const logEl = doc.createElement('div');
registered.blocks.log('line one\n!! the important one\nline three\n', logEl);
ok('```log: «!!» lines are highlighted, the rest plain', logEl.querySelectorAll('.hl-line').length === 1 && logEl.querySelector('.hl-line').textContent === 'the important one' && /line three/.test(logEl.textContent));
const svgEl = doc.createElement('div');
registered.blocks.svg('<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="5" height="5" onclick="x()"/><a href="https://evil"><text>t</text></a></svg>', svgEl);
ok('```svg: drawn, with script, handlers and outside links removed', !!svgEl.querySelector('.svgfig svg') && !svgEl.querySelector('script') && !/onclick|evil/.test(svgEl.innerHTML), svgEl.innerHTML.slice(0, 200));

/* ---- editor: each line its own direction ---- */
const lines = ['---', 'tags: [a]', '---', '# سرتیتر فارسی', 'English line here', '```bash', 'echo سلام', '```', 'متن فارسی با چند کلمهٔ English وسطش'];
let pos = 0;
const L = lines.map((text, i) => { const l = { number: i + 1, from: pos, to: pos + text.length, text }; pos += text.length + 1; return l; });
const fakeView = { state: { doc: { line: (n) => L[n - 1], lineAt: (p) => L.find((l) => p >= l.from && p <= l.to) || L[L.length - 1] } }, visibleRanges: [{ from: 0, to: pos - 1 }] };
const ext = registered.editor[0];
const inst = new ext[1].cls(fakeView);
const dirs = {};
inst.decorations.forEach((d) => { dirs[L.find((l) => l.from === d.from).number] = d.deco.spec.attributes.dir; });
ok('editor: per-line direction is on', ext[0].perLine === true);
ok('editor: front matter and code block lines stay ltr', dirs[1] === 'ltr' && dirs[2] === 'ltr' && dirs[6] === 'ltr' && dirs[7] === 'ltr' && dirs[8] === 'ltr', dirs);
ok('editor: Persian lines rtl, English lines ltr', dirs[4] === 'rtl' && dirs[5] === 'ltr' && dirs[9] === 'rtl', dirs);

console.log(`\n${fail === 0 ? 'ALL GOOD' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
