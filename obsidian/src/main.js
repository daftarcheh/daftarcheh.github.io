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

/*@@SHARED@@*/

/* ---------- reading view ---------- */

var BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, .callout-title-inner';
var KEEP_LTR = 'pre, code, .math, .mermaid, svg, .frontmatter, .metadata-container';

/** A block's own words: nested lists and code are not part of its sentence. */
function ownText(el){
  var c = el.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll('ul, ol, pre, code, .mz-tag'), function(x){ x.remove(); });
  return c.textContent || '';
}

/** Obsidian's own post-processor gives p, li and headings dir="auto" (the first letter decides: «timeout cron از …» would read
    left-to-right). Whichever runs last owns «dir», so the direction also goes in data-df-dir, which styles.css makes win. */
function setDir(el, d){
  el.setAttribute('dir', d);
  el.setAttribute('data-df-dir', d);
}

function setDirections(root){
  Array.prototype.forEach.call(root.querySelectorAll(BLOCKS), function(el){
    if (el.closest(KEEP_LTR)) return;
    var d = textDir(ownText(el));
    if (d) setDir(el, d);
  });
  // a list follows most of its items, so the markers sit on the side most of the text starts from
  Array.prototype.forEach.call(root.querySelectorAll('ul, ol'), function(list){
    if (list.closest(KEEP_LTR)) return;
    var r = 0, l = 0;
    Array.prototype.forEach.call(list.children, function(li){
      var d = li.getAttribute && li.getAttribute('dir');
      if (d === 'rtl') r++; else if (d === 'ltr') l++;
    });
    if (r || l) setDir(list, r >= l ? 'rtl' : 'ltr');
  });
  Array.prototype.forEach.call(root.querySelectorAll('table'), function(table){
    var head = table.querySelector('th, td');
    if (head && head.getAttribute('dir')) setDir(table, head.getAttribute('dir'));
  });
  // a callout reads from its title's side, so its coloured line and icon sit where a Persian callout starts: the right
  Array.prototype.forEach.call(root.querySelectorAll('.callout'), function(callout){
    var title = callout.querySelector('.callout-title-inner[dir]') || callout.querySelector('.callout-content [dir]');
    if (title) setDir(callout, title.getAttribute('dir'));
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
  if (classes.indexOf('article') === -1) return;
  var meta = articleMeta(fm);
  if (!fm.eyebrow && !fm.lede && !meta) return;
  var h1 = root.querySelector('h1');
  if (!h1 || h1.getAttribute('data-df-head')) return;
  h1.setAttribute('data-df-head', '1');
  var last = h1;
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
    h1.parentNode.insertBefore(lede, last.nextSibling);
    last = lede;
  }
  if (meta){
    h1.parentNode.insertBefore(meta, last.nextSibling);
    last = meta;
  }
  // Daftarcheh draws the header's bottom line under its last part: the title, the lede or the row of properties
  last.setAttribute('data-df-head-end', '');
}

/** The row of the note's properties under the lede, as Daftarcheh's article header has it («تاریخ: ۱۷ آبان ۱۴۰۵», #tags). */
var FM_HIDDEN = /^(cssclass(es)?|eyebrow|lede|transition|position)$/i;
function fmText(v){
  if (Array.isArray(v)) return v.map(fmText).filter(Boolean).join('، ');
  return v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim();
}
function articleMeta(fm){
  var props = [], tags = [];
  Object.keys(fm).forEach(function(k){
    if (FM_HIDDEN.test(k)) return;
    var v = fmText(fm[k]);
    if (!v) return;
    if (/^tags?$/i.test(k)) tags = tags.concat(v.split(/[\s,،]+/).filter(Boolean));
    else props.push([k, v]);
  });
  if (!props.length && !tags.length) return null;
  var row = document.createElement('div');
  row.className = 'df-meta';
  props.forEach(function(p){
    var item = row.appendChild(document.createElement('span'));
    var key = item.appendChild(document.createElement('span'));
    key.className = 'df-k';
    key.textContent = p[0] + ':';
    item.appendChild(document.createTextNode(' '));
    var val = item.appendChild(document.createElement('b'));
    val.setAttribute('dir', textDir(p[1]) || 'auto');
    val.textContent = p[1];
  });
  if (tags.length){
    var t = row.appendChild(document.createElement('span'));
    t.textContent = tags.map(function(x){ return '#' + x.replace(/^#/, ''); }).join(' ');
  }
  row.setAttribute('dir', textDir(row.textContent) || 'rtl');
  return row;
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
/** Where bdiText would put <bdi> in a line, as [from, to] offsets: the editor isolates the same runs the reading view does. */
var BDI_OPEN = '<bdi dir="ltr">', BDI_CLOSE = '</bdi>';
function bdiRanges(text){
  var out = bdiText(text), ranges = [], plain = '', at = 0, k = 0;
  if (out.indexOf(BDI_OPEN) === -1) return ranges;
  while (k < out.length){
    if (out.startsWith(BDI_OPEN, k)){ at = plain.length; k += BDI_OPEN.length; continue; }
    if (out.startsWith(BDI_CLOSE, k)){ ranges.push([at, plain.length]); k += BDI_CLOSE.length; continue; }
    plain += out.charAt(k++);
  }
  return plain === text ? ranges : [];                // a line that itself contains «<bdi…>» is left alone
}
// an isolated left-to-right run; with bidiIsolate CodeMirror also moves the caret across it in the right order
var isoMark = cmView.Decoration.mark ? cmView.Decoration.mark(Object.assign({ class: 'df-iso', attributes: { dir: 'ltr' } },
  cmView.Direction ? { bidiIsolate: cmView.Direction.LTR } : {})) : null;
function lineDirections(view, out){
  var builder = new cmState.RangeSetBuilder(), doc = view.state.doc;
  var iso = isoMark ? new cmState.RangeSetBuilder() : null;
  if (out) out.isolates = null;
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
    var dir = ltr ? 'ltr' : textDir(text), from = doc.line(n).from;
    // data-df-dir carries the direction too: another plugin's line «dir» (RTL Support's dir="auto") may replace ours,
    // and styles.css makes this one win
    if (dir) builder.add(from, from, cmView.Decoration.line({ attributes: { dir: dir, 'data-df-dir': dir } }));
    if (iso && dir === 'rtl') bdiRanges(text).forEach(function(r){ iso.add(from + r[0], from + r[1], isoMark); });
  }
  if (out && iso) out.isolates = iso.finish();
  return builder.finish();
}
var directionPlugin = cmView.ViewPlugin.fromClass(class {
  constructor(view){ this.decorations = lineDirections(view, this); }
  update(u){ if (u.docChanged || u.viewportChanged) this.decorations = lineDirections(u.view, this); }
}, { decorations: function(v){ return v.decorations; } });
function isolatesOf(view){
  var p = view.plugin(directionPlugin);
  return (p && p.isolates) || cmView.Decoration.none;
}

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
    var ext = [cmView.EditorView.perLineTextDirection.of(true), directionPlugin];
    // inside right-to-left lines, «Load Balancer v2.0» and «/etc/hosts» keep their order, as in the reading view
    if (isoMark && cmView.EditorView.decorations){
      ext.push(cmView.EditorView.decorations.of(isolatesOf));
      if (cmView.EditorView.bidiIsolatedRanges) ext.push(cmView.EditorView.bidiIsolatedRanges.of(isolatesOf));
    }
    this.registerEditorExtension(ext);
  }
}
module.exports = DaftarchehPlugin;
module.exports.textDir = textDir;
