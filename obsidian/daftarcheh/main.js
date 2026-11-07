/*
 * Daftarcheh for Obsidian — right-to-left the way Daftarcheh does it, and its article look.
 *
 * - Every paragraph, heading, list item and table cell gets its own direction from its words
 *   (Daftarcheh's textDir: a Persian sentence full of English terms stays right-to-left).
 * - Inside right-to-left text, runs of English, paths and code-like words keep their order (<bdi>).
 * - The editor (Source and Live Preview) gives each line its own direction too; code blocks and
 *   front matter stay left-to-right.
 * - {ok|bad|warn|info: …} badges, ```log blocks with «!!» lines, ```svg figures, and the
 *   eyebrow / lede of «cssclasses: article» notes.
 *
 * Built by tools/obsidian.py: the block below marked SHARED is copied from src/app.js unchanged.
 */
'use strict';
var obsidian = require('obsidian');
var cmView = require('@codemirror/view');
var cmState = require('@codemirror/state');

/* ---------- SHARED: from src/app.js ---------- */
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function countOf(s, ch){
  var n = 0;
  for (var i = 0; i < s.length; i++) if (s.charAt(i) === ch) n++;
  return n;
}
var RTL_RE = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
function hasRTL(s){ return RTL_RE.test(s); }
var FA_GLUE = /^(و|از|در|به|را|که|با|برای|روی|این|آن|است|نیست|هست|شد|شده|بود|یا|تا|اگر|هم|کن|کنید|می‌شود|می‌کند|نشده|باید)$/;
var FLOW_ARROW = '(?:\\s*[→⇒⟶➜➔]\\s*|\\s+(?:->|=>|-&gt;|=&gt;)\\s+)';
var FLOW_SPLIT = new RegExp(FLOW_ARROW);
function textDir(s){
  var rtl = 0, ltr = 0, glue = false;
  // a flow of short Latin steps has no direction of its own: it follows the page, so it reads right-to-left in Persian text
  var flow = String(s).replace(/`+[^`]*`+/g, 'code').split(FLOW_SPLIT);
  if (flow.length > 1 && !hasRTL(String(s)) && flow.every(function(part){ return part.trim().split(/\s+/).length <= 4; })) return '';
  String(s).replace(/`+[^`]*`+/g, ' ').replace(/\$[^$]*\$/g, ' ').replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ').split(/\s+/).forEach(function(w){
    if (hasRTL(w)){ rtl++; if (FA_GLUE.test(w.replace(/[^\u0600-\u06FF\u200c]/g, ''))) glue = true; }
    else if (/[A-Za-z]/.test(w)) ltr++;
  });
  if (!rtl && !ltr) return ''; // dir="" → inherits the page direction
  // a Persian line full of English terms is common, an English line with a Persian word is rare
  return glue || rtl * 3 >= ltr ? 'rtl' : 'ltr';
}
function isCodeToken(tok){
  return /[A-Za-z0-9]/.test(tok) && /^[\x21-\x7E]+$/.test(tok)
    && tok.indexOf('<') === -1 && tok.indexOf('>') === -1 && tok.indexOf('"') === -1 && tok.indexOf('&') === -1;
}
var PUNCT_LEAD = /^[(\[{"'“‘«]+/;
var PUNCT_TAIL = /[)\]}"'”’.,;:!?»«،؛؟]+$/;
var BRACKET_OPEN = { ')': '(', ']': '[', '}': '{' };
function tokInfo(w){
  var lead = '', tail = '', core = w;
  var lm = core.match(PUNCT_LEAD);
  if (lm){ lead = lm[0]; core = core.slice(lead.length); }
  var tm = core.match(PUNCT_TAIL);
  if (tm){
    tail = tm[0];
    core = core.slice(0, core.length - tail.length);
    // keep a closing bracket that belongs to the token, e.g. foo() or arr[0]
    while (tail && BRACKET_OPEN[tail.charAt(0)] && countOf(core, BRACKET_OPEN[tail.charAt(0)]) > countOf(core, tail.charAt(0))){
      core += tail.charAt(0);
      tail = tail.slice(1);
    }
  }
  return { lead: lead, core: core, tail: tail, q: !!core && isCodeToken(core) };
}
function unmatchedBracketCut(parts, i, j){
  var stack = [];
  for (var k = i; k <= j; k += 2){
    var t = tokInfo(parts[k]), text = (k === i ? '' : t.lead) + t.core + (k === j ? '' : t.tail);
    for (var c = 0; c < text.length; c++){
      var ch = text.charAt(c);
      if (/[(\[{]/.test(ch)) stack.push({ ch: ch, k: k });
      else if (BRACKET_OPEN[ch]){
        if (stack.length && stack[stack.length - 1].ch === BRACKET_OPEN[ch]) stack.pop();
        else if (k < j) return k; // closes something opened before the run
      }
    }
  }
  return stack.length && stack[0].k > i ? stack[0].k - 2 : -1; // opens something closed after the run
}
function bdiText(s){
  var parts = s.split(/(\s+)/), out = [], i = 0;
  while (i < parts.length){
    var first = i % 2 === 0 ? tokInfo(parts[i]) : null;
    if (!first || !first.q){ out.push(parts[i]); i++; continue; }
    var j = i, last = first;
    while (j + 2 < parts.length){
      var next = tokInfo(parts[j + 2]);
      if (!next.q) break;
      j += 2; last = next;
    }
    // a bracket whose partner lies outside the run must stay in the RTL text: end the run before it
    for (var cut = unmatchedBracketCut(parts, i, j); cut >= 0; cut = unmatchedBracketCut(parts, i, j)){ j = cut; last = tokInfo(parts[j]); }
    var inner = parts.slice(i, j + 1).join(''), tail = last.tail;
    inner = inner.slice(first.lead.length, inner.length - tail.length);
    while (tail && BRACKET_OPEN[tail.charAt(0)] && countOf(inner, BRACKET_OPEN[tail.charAt(0)]) > countOf(inner, tail.charAt(0))){
      inner += tail.charAt(0);
      tail = tail.slice(1);
    }
    out.push(first.lead + (/[^A-Za-z\s]/.test(inner) ? '<bdi dir="ltr">' + inner + '</bdi>' : inner) + tail);
    i = j + 1;
  }
  return out.join('');
}
var SVG_TAGS = { svg: 1, g: 1, defs: 1, symbol: 1, use: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, path: 1,
  text: 1, tspan: 1, textPath: 1, title: 1, desc: 1, linearGradient: 1, radialGradient: 1, stop: 1, marker: 1, clipPath: 1, mask: 1, pattern: 1, image: 1 };
function renderSvgBlock(src, ctx){
  var bad = function(msg){
    return '<div class="errbox">⚠ SVG نامعتبر' + (msg ? '<div class="errmsg">' + escapeHtml(msg) + '</div>' : '') + '</div>'
      + '<pre data-lang="xml"><code>' + escapeHtml(src) + '</code></pre>';
  };
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return bad('');
  var text = String(src).trim();
  if (!/\sxmlns=/.test(text.slice(0, 400))) text = text.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  var root = doc.documentElement, err = doc.getElementsByTagName('parsererror')[0];
  if (err || !root || root.localName !== 'svg') return bad(err ? String(err.textContent).trim().split('\n')[0] : 'بلوک باید با <svg> شروع شود');
  ctx.svgN = (ctx.svgN || 0) + 1;
  var pre = 'svg' + ctx.svgN + '-';
  (function clean(el){
    Array.prototype.slice.call(el.children).forEach(function(c){
      if (SVG_TAGS[c.localName]) clean(c);
      else c.parentNode.removeChild(c);
    });
    Array.prototype.slice.call(el.attributes).forEach(function(a){
      var n = a.name.toLowerCase(), v = a.value;
      if (/^on/.test(n)){ el.removeAttribute(a.name); return; }
      if (n === 'href' || n === 'xlink:href'){
        if (v.charAt(0) === '#') el.setAttribute(a.name, '#' + pre + v.slice(1));
        else if (!(el.localName === 'image' && /^data:image\/(png|jpe?g|gif|webp);/i.test(v))) el.removeAttribute(a.name);
        return;
      }
      if (n === 'id'){ el.setAttribute(a.name, pre + v); return; }
      if (/url\(/i.test(v)){
        if (/url\(\s*['"]?(?!#)/i.test(v)) el.removeAttribute(a.name);
        else el.setAttribute(a.name, v.replace(/url\(\s*(['"]?)#/g, 'url($1#' + pre));
      }
    });
  })(root);
  var vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  var w = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(root.getAttribute('width')) || 0;
  var h = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(root.getAttribute('height')) || 0;
  if (!root.getAttribute('viewBox') && w && h) root.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  root.removeAttribute('width');
  root.removeAttribute('height');
  if (w) root.setAttribute('style', 'width:100%;max-width:' + Math.round(w * 1.4) + 'px;min-width:' + Math.round(Math.min(w, 720) * .85) + 'px;' + (root.getAttribute('style') || ''));
  var title = root.getElementsByTagName('title')[0];
  var label = root.getAttribute('aria-label') || (title ? title.textContent : '');
  return '<div class="svgfig" role="img"' + (label ? ' aria-label="' + escapeHtml(label) + '"' : '') + '>' + new XMLSerializer().serializeToString(root) + '</div>';
}

/* ---------- reading view ---------- */

var BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, .callout-title-inner';
var KEEP_LTR = 'pre, code, .math, .mermaid, svg, .frontmatter, .metadata-container';

/** A block's own words: nested lists and code are not part of its sentence. */
function ownText(el){
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('ul, ol, pre, code, .mz-tag'), function(x){ x.remove(); });
  return c.textContent || '';
}

function setDirections(root){
  Array.prototype.forEach.call(root.querySelectorAll(BLOCKS), function(el){
    if (el.closest(KEEP_LTR)) return;
    var d = textDir(ownText(el));
    if (d) el.setAttribute('dir', d);
  });
  // a list follows most of its items, so the markers sit on the side most of the text starts from
  Array.prototype.forEach.call(root.querySelectorAll('ul, ol'), function(list){
    if (list.closest(KEEP_LTR)) return;
    var r = 0, l = 0;
    Array.prototype.forEach.call(list.children, function(li){
      var d = li.getAttribute && li.getAttribute('dir');
      if (d === 'rtl') r++; else if (d === 'ltr') l++;
    });
    if (r || l) list.setAttribute('dir', r >= l ? 'rtl' : 'ltr');
  });
  Array.prototype.forEach.call(root.querySelectorAll('table'), function(table){
    var head = table.querySelector('th, td');
    if (head && head.getAttribute('dir')) table.setAttribute('dir', head.getAttribute('dir'));
  });
}

/** Inside right-to-left text, a run like «Load Balancer v2.0» or «/etc/hosts» keeps its own order. */
function isolateLatin(root){
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function(n){
    var p = n.parentElement;
    if (!p || p.closest(KEEP_LTR + ', a, bdi, .mz-tag') || !/[A-Za-z0-9]/.test(n.nodeValue)) return;
    var block = p.closest('[dir]');
    if (!block || block.getAttribute('dir') !== 'rtl') return;
    var html = bdiText(escapeHtml(n.nodeValue));
    if (html.indexOf('<bdi') === -1) return;
    var holder = document.createElement('span');
    holder.innerHTML = html;                       // escaped text plus <bdi> only
    var frag = document.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);
    n.parentNode.replaceChild(frag, n);
  });
}

/** {ok: …} {bad: …} {warn: …} {info: …} → a small coloured label, as in Daftarcheh. */
var TAG_RE = /\{(ok|bad|warn|info):[ \t]*([^{}\n]{1,80}?)[ \t]*\}/g;
function badges(root){
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function(n){
    if (!n.parentElement || n.parentElement.closest(KEEP_LTR + ', .mz-tag')) return;
    var text = n.nodeValue;
    TAG_RE.lastIndex = 0;
    if (!TAG_RE.test(text)) return;
    TAG_RE.lastIndex = 0;
    var frag = document.createDocumentFragment(), at = 0, m;
    while ((m = TAG_RE.exec(text))){
      if (m.index > at) frag.appendChild(document.createTextNode(text.slice(at, m.index)));
      var span = document.createElement('span');
      span.className = 'mz-tag mz-tag-' + m[1];
      span.textContent = m[2];
      frag.appendChild(span);
      at = m.index + m[0].length;
    }
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    n.parentNode.replaceChild(frag, n);
  });
}

/** «cssclasses: article»: the eyebrow line above the title and the lede paragraph under it, from the front matter. */
function articleHead(root, ctx){
  var fm = ctx && ctx.frontmatter;
  if (!fm) return;
  var classes = [].concat(fm.cssclasses || fm.cssclass || []).join(' ').split(/[\s,]+/);
  if (classes.indexOf('article') === -1 || (!fm.eyebrow && !fm.lede)) return;
  var h1 = root.querySelector('h1');
  if (!h1 || h1.getAttribute('data-df-head')) return;
  h1.setAttribute('data-df-head', '1');
  if (fm.eyebrow){
    var eb = document.createElement('div');
    eb.className = 'df-eyebrow';
    eb.textContent = String(fm.eyebrow);
    eb.setAttribute('dir', textDir(eb.textContent) || 'rtl');
    h1.parentNode.insertBefore(eb, h1);
  }
  if (fm.lede){
    var lede = document.createElement('p');
    lede.className = 'df-lede';
    lede.textContent = String(fm.lede);
    h1.parentNode.insertBefore(lede, h1.nextSibling);
  }
}

/** ```log — the lines starting with «!!» are the ones that matter, highlighted. */
function renderLog(src, el){
  var pre = el.createEl('pre', { cls: 'df-log' });
  var code = pre.createEl('code');
  String(src).replace(/\n$/, '').split('\n').forEach(function(line, k){
    if (k) code.appendText('\n');
    var hot = /^!! ?(.*)$/.exec(line);
    if (hot) code.createSpan({ cls: 'hl-line', text: hot[1] });
    else code.appendText(line);
  });
}

/** ```svg — drawn as a figure, with only drawing kept (no script, handler, style or outside link). */
var svgCount = 0;
function renderSvg(src, el){
  var html = renderSvgBlock(src, { svgN: svgCount++ });
  var holder = el.createDiv();
  holder.innerHTML = html;                         // sanitised by renderSvgBlock, as in Daftarcheh
}

/* ---------- editor: each line its own direction ---------- */

var FENCE_RE = /^\s*(`{3,}|~{3,})/;
function lineDirections(view){
  var builder = new cmState.RangeSetBuilder(), doc = view.state.doc;
  var ranges = view.visibleRanges;
  if (!ranges.length) return builder.finish();
  var lastLine = doc.lineAt(ranges[ranges.length - 1].to).number;
  var visible = ranges.map(function(r){ return [doc.lineAt(r.from).number, doc.lineAt(r.to).number]; });
  var inFence = '', inFm = false;
  // fences and front matter are known only from the top, so the scan starts there (cheap: text only)
  for (var n = 1; n <= lastLine; n++){
    var text = doc.line(n).text, ltr = false, m;
    if (n === 1 && /^---\s*$/.test(text)){ inFm = true; ltr = true; }
    else if (inFm){ ltr = true; if (/^(---|\.\.\.)\s*$/.test(text)) inFm = false; }
    else if ((m = FENCE_RE.exec(text))){
      ltr = true;
      if (!inFence) inFence = m[1].charAt(0);
      else if (m[1].charAt(0) === inFence) inFence = '';
    } else if (inFence) ltr = true;
    var shown = visible.some(function(v){ return n >= v[0] && n <= v[1]; });
    if (!shown) continue;
    var dir = ltr ? 'ltr' : textDir(text);
    if (dir) builder.add(doc.line(n).from, doc.line(n).from, cmView.Decoration.line({ attributes: { dir: dir } }));
  }
  return builder.finish();
}
var directionPlugin = cmView.ViewPlugin.fromClass(class {
  constructor(view){ this.decorations = lineDirections(view); }
  update(u){ if (u.docChanged || u.viewportChanged) this.decorations = lineDirections(u.view); }
}, { decorations: function(v){ return v.decorations; } });

/* ---------- the plugin ---------- */

class DaftarchehPlugin extends obsidian.Plugin {
  onload(){
    this.registerMarkdownPostProcessor(function(el, ctx){
      articleHead(el, ctx);
      badges(el);
      setDirections(el);
      isolateLatin(el);
    });
    this.registerMarkdownCodeBlockProcessor('log', renderLog);
    this.registerMarkdownCodeBlockProcessor('svg', renderSvg);
    // caret, selection and arrow keys follow each line's own direction
    this.registerEditorExtension([cmView.EditorView.perLineTextDirection.of(true), directionPlugin]);
  }
}
module.exports = DaftarchehPlugin;
module.exports.textDir = textDir;
