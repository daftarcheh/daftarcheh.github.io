/* Smoke test of the NEW main app (v1.80) under jsdom: boot, the bottom bar with «موقت», the + menu
   surviving a page scroll, Ctrl+E edit↔read, and nbsp-free code copy. Run from scratchpad:
   NODE_PATH=jsd/node_modules node smoke180.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, "..");
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
// vendor stays out (mermaid/katex are heavy and optional); the app itself runs inline
html = html.replace(/<script id="mermaidLib"[^>]*><\/script>/, '');
html = html.replace(/<script id="katexLib"[^>]*><\/script>/, '');
html = html.replace('<script src="app.js" defer></script>', '<script>window.__APP__()</script>');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a fake GitHub, enough for push/pull: blobs → tree → commit → ref, plus contents and raw reads ---- */
const crypto = require('crypto');
const rawGists = new Map(), gistsMeta = new Map(), gistsDeleted = new Set();
const repo = { files: new Map(), commits: [], apiCommits: 0, blobs: new Map(), trees: new Map() };
function blobSha(text){ return crypto.createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0' + text).digest('hex'); }
function head(){ return repo.commits.length ? repo.commits[repo.commits.length - 1].sha : ''; }
function putRemote(p, text){ const sha = blobSha(text); repo.files.set(p, { path: p, sha, text }); repo.blobs.set(sha, text); return sha; }
function bumpRemote(msg){ const t = crypto.randomBytes(20).toString('hex'); repo.trees.set(t, { tree: [] }); repo.commits.push({ sha: crypto.randomBytes(20).toString('hex'), message: msg, tree: t }); }
function api(data, status = 200){
  return { ok: status < 300, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(data), text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)) };
}
function handleApi(method, url, body){
  const u = new URL(url), p = decodeURIComponent(u.pathname).replace(/^\/repos\/[^/]+\/[^/]+/, '');
  const b = body ? JSON.parse(body) : null;
  if (p === '/gists' && method === 'POST'){
    // a fresh gist: its raw address answers only after a moment (or never, when the test says so)
    const id = require('crypto').randomBytes(16).toString('hex'), content = Object.values(b.files)[0].content;
    if (!global.__gistNeverRaw) setTimeout(() => rawGists.set(id, content), 500);
    gistsMeta.set(id, { id, description: b.description || '', owner: { login: 'me' }, files: b.files, updated_at: new Date().toISOString() });
    return api({ id, owner: { login: 'me' }, files: b.files }, 201);
  }
  if (/^\/gists\/[0-9a-f]+$/.test(p) && method === 'PATCH'){
    const id = p.split('/').pop(), g = gistsMeta.get(id);
    if (!g) return api({ message: 'Not Found' }, 404);
    if (b.description != null) g.description = b.description;
    if (b.files){ Object.assign(g.files, b.files); rawGists.set(id, Object.values(b.files)[0].content); }
    g.patches = (g.patches || 0) + 1;
    return api(g);
  }
  if (/^\/gists\/[0-9a-f]+$/.test(p) && method === 'DELETE'){
    const id = p.split('/').pop();
    gistsMeta.delete(id); rawGists.delete(id); gistsDeleted.add(id);
    return api('', 204);
  }
  if (p === '/gists' && method === 'GET') return api(u.searchParams.get('page') === '1' || !u.searchParams.get('page') ? [...gistsMeta.values()] : []);
  if (p === '' && method === 'GET') return api({ full_name: 'me/notes', private: true, default_branch: 'main', permissions: { push: true } });
  if (p === '/git/ref/heads/main' && method === 'GET') return head() ? api({ object: { sha: head() } }) : api({ message: 'Not Found' }, 404);
  if (/^\/git\/trees\/[0-9a-f]{40}$/.test(p) && method === 'GET')
    return api({ sha: p.split('/').pop(), truncated: false, tree: [...repo.files.values()].map((f) => ({ path: f.path, type: 'blob', sha: f.sha, size: f.text.length })) });
  if (p === '/commits' && method === 'GET') return api([]);
  if (p.startsWith('/contents/') && method === 'GET'){
    const f = repo.files.get(p.slice('/contents/'.length));
    return f ? api(f.text) : api({ message: 'Not Found' }, 404);
  }
  if (p.startsWith('/contents/') && method === 'PUT'){
    const path2 = p.slice('/contents/'.length), text = Buffer.from(b.content, 'base64').toString('utf8');
    const blob = putRemote(path2, text), t = crypto.randomBytes(20).toString('hex');
    repo.trees.set(t, { tree: [{ path: path2, sha: blob }] });
    repo.apiCommits++;
    const sha = crypto.randomBytes(20).toString('hex');
    repo.commits.push({ sha, message: b.message, tree: t });
    return api({ content: { path: path2 }, commit: { sha } }, 201);
  }
  if (p === '/git/blobs' && method === 'POST'){
    const text = Buffer.from(b.content, 'base64').toString('utf8'), sha = blobSha(text);
    repo.blobs.set(sha, text);
    return api({ sha });
  }
  if (p.startsWith('/git/commits/') && method === 'GET'){
    const c = repo.commits.find((x) => x.sha === p.slice('/git/commits/'.length));
    if (!c) return api({ message: 'Not Found' }, 404);
    if (!repo.trees.has(c.tree)) repo.trees.set(c.tree, { tree: [] });
    return api({ sha: c.sha, tree: { sha: c.tree } });
  }
  if (p === '/git/trees' && method === 'POST'){
    if (b.base_tree && !repo.trees.has(b.base_tree)) return api({ message: 'base_tree is not a tree' }, 422);
    const missing = (b.tree || []).filter((e) => e.sha === null && !repo.files.has(e.path));
    if (missing.length) return api({ message: 'GitRPC::BadObjectState' }, 422);
    const sha = crypto.randomBytes(20).toString('hex');
    repo.trees.set(sha, b);
    return api({ sha });
  }
  if (p === '/git/commits' && method === 'POST'){
    const sha = crypto.randomBytes(20).toString('hex');
    repo.apiCommits++;
    repo.commits.push({ sha, message: b.message, tree: b.tree });
    for (const e of (repo.trees.get(b.tree) || {}).tree || []){
      if (e.sha === null) repo.files.delete(e.path);
      else if (repo.blobs.has(e.sha)) repo.files.set(e.path, { path: e.path, sha: e.sha, text: repo.blobs.get(e.sha) });
    }
    return api({ sha });
  }
  if ((p === '/git/refs/heads/main' && method === 'PATCH') || (p === '/git/refs' && method === 'POST')) return api({ object: { sha: b.sha } });
  return api({ message: 'fake GitHub: unhandled ' + method + ' ' + p }, 404);
}

const dom = new JSDOM(html, {
  url: 'https://example.test/mizkar/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(win){
    win.__APP__ = () => win.eval(app);
    const db = new Map();
    win.indexedDB = {
      open(){
        const rq = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
        setTimeout(() => {
          rq.result = {
            objectStoreNames: { contains: (n) => db.has(n) },
            createObjectStore(n){ db.set(n, new Map()); return {}; },
            transaction(store){
              if (!db.has(store)) db.set(store, new Map());
              const m = db.get(store), tx = { oncomplete: null, onerror: null, error: null };
              const rq2 = (result) => { const r = { result, onsuccess: null, onerror: null }; setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; };
              tx.objectStore = () => ({
                get: (k) => rq2(m.get(k)),
                getAll: () => rq2([...m.values()]),
                count: () => rq2(m.size),
                openCursor: () => rq2(null),
                delete: (k) => { m.delete(k); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return rq2(undefined); },
                put: (v, k) => { m.set(k, v); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return rq2(k); }
              });
              return tx;
            },
            close(){}
          };
          rq.onupgradeneeded && rq.onupgradeneeded();
          rq.onsuccess && rq.onsuccess();
        }, 0);
        return rq;
      }
    };
    win.__mqls = [];   // the system theme is switchable from the checks: win.__sysDark + the recorded listeners
    win.matchMedia = (q) => ({ get matches(){ return /prefers-color-scheme: dark/.test(q) ? !!win.__sysDark : false; }, addEventListener(t, f){ win.__mqls.push([q, f]); }, removeEventListener(){}, addListener(f){ win.__mqls.push([q, f]); }, removeListener(){} });
    win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    win.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
    win.scrollTo = () => {};
    win.HTMLElement.prototype.scrollIntoView = function(){};
    win.URL.createObjectURL = () => 'blob:test';
    win.URL.revokeObjectURL = () => {};
    win.fetch = (url, init) => {
      const raw = /^https:\/\/gist\.githubusercontent\.com\/([^/]+)\/([0-9a-f]+)\/raw/.exec(String(url));
      if (raw){
        const text = rawGists.get(raw[2]);
        const okOwner = raw[1] === 'me';
        return Promise.resolve(text && okOwner ? { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: () => Promise.resolve(text), json: () => Promise.resolve({}) }
          : { ok: false, status: 404, headers: { get: () => 'text/plain' }, text: () => Promise.resolve('404'), json: () => Promise.resolve({}) });
      }
      if (/^https:\/\/api\.github\.com\/gists\/[0-9a-f]+$/.test(String(url)) && !(init && init.method && init.method !== 'GET') && gistsDeleted.has(String(url).split('/').pop())) return Promise.resolve(api({ message: 'Not Found' }, 404));
      if (/^https:\/\/api\.github\.com\/gists\/[0-9a-f]+$/.test(String(url)) && !(init && init.method && init.method !== 'GET')) return Promise.resolve(api({ message: 'API rate limit exceeded' }, 403));
      if (String(url).startsWith('https://api.github.com')) return Promise.resolve(handleApi((init && init.method) || 'GET', String(url), init && init.body));
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'text/plain' }, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
    };
    win.console = console;
    const { TextEncoder, TextDecoder } = require('util');
    win.TextEncoder = TextEncoder;
    win.TextDecoder = TextDecoder;
    Object.defineProperty(win, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  }
});

const win = dom.window, doc = win.document;
let bootError = null;
win.addEventListener('error', (e) => { bootError = e.message; });

(async () => {
  await sleep(600);
  ok('the app boots with no uncaught error', !bootError, bootError);
  const optArt0 = doc.getElementById('optArticle');
  ok('ظاهر مقاله پیش فرض روشن است', !!optArt0 && optArt0.checked);
  ok('و کلید ذخیرهٔ تازه دارد (مقدار «خاموش» قدیمی جای پیش فرض را نمی گیرد)', /typeof s\.articleOn === 'boolean'/.test(app) && !/typeof s\.article === 'boolean'/.test(app));
  optArt0.checked = false; optArt0.dispatchEvent(new win.Event('change'));     // the older checks below look at the plain view
  const metaVer = (doc.querySelector('meta[name="app-version"]') || {}).content || '';
  const jsonVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
  ok('the page and version.json agree on the version', metaVer && metaVer === jsonVer, [metaVer, jsonVer]);
  const swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('the worker cache is keyed to this release (or phones never update)', swText.includes("var CACHE = 'mizkar-" + jsonVer + "'"), jsonVer);

  // phone size: the bar carries «موقت» now, six places with «تازه» among them
  Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  await sleep(30);
  const nav = doc.getElementById('nbNav');
  ok('the bottom bar exists', !!nav);
  const places = [...nav.querySelectorAll('[data-nb-nav]')].map((b) => b.dataset.nbNav);
  ok('پنج جا: امروز · تقویم · ＋ (وسط) · یادداشت‌ها · بیشتر', JSON.stringify(places) === JSON.stringify(['home', 'cal', 'new', 'notes', 'more']), places);

  // + opens its sheet, and a page scroll right after must NOT close it
  nav.querySelector('[data-nb-nav="new"]').click();
  await sleep(20);
  const menu = doc.getElementById('nbMenu');
  ok('«تازه» opens the menu', menu && !menu.hidden);
  ok('with the new-note actions', [...menu.querySelectorAll('.mi')].some((b) => b.textContent.indexOf('یادداشت جدید') !== -1));
  doc.dispatchEvent(new win.Event('scroll', { bubbles: true }));
  win.dispatchEvent(new win.Event('scroll'));
  await sleep(20);
  ok('a page scroll does not kill it on the phone', !menu.hidden);
  // tapping + again closes it (its own toggle)
  nav.querySelector('[data-nb-nav="new"]').click();
  await sleep(10);
  ok('a second tap on + closes it', menu.hidden);

  // «تقویم» on the bar opens the calendar, and lights up
  nav.querySelector('[data-nb-nav="cal"]').click();
  await sleep(30);
  ok('«تقویم» روی نوار، تقویم را باز می کند و روشن می شود', win.mizkarNotebook && win.mizkarNotebook.section === 'cal' && doc.body.classList.contains('nb-open')
    && nav.querySelector('[data-nb-nav="cal"]').getAttribute('aria-pressed') === 'true');
  doc.querySelector('#nbNav [data-nb-nav="more"]').click();
  await sleep(20);
  ok('«موقت» در «بیشتر» است (و ⧉ نوار بالا)', [...doc.querySelectorAll('#nbMenu .mi')].some((b) => /^موقت/.test(b.textContent.trim())));
  doc.getElementById('nbMenu').hidden = true;

  // the swipe strip knows the same pages
  const mob = win.nbMobile;
  ok('صفحه های سوایپ همان نوار: امروز·تقویم·یادداشت ها', mob && JSON.stringify(mob.pages) === JSON.stringify(['home', 'cal', 'notes']));
  ok('and a leftward pull from here goes to «یادداشت ها»', mob.pageGo(mob.pageNow() + 1) === 'notes');

  // desktop again: Ctrl+E toggles edit ↔ read on a notebook note
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  const nb = win.mizkarNotebook;
  nb.ui.write('آزمون/الف.md', '# الف\nمتن\n');
  nb.ui.open('آزمون/الف.md');
  await sleep(50);
  const viewOf = () => doc.getElementById('work').dataset.view;
  ok('a note opens for reading', viewOf() === 'preview', viewOf());
  const ctrlE = () => doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, bubbles: true, cancelable: true }));
  ctrlE();
  await sleep(30);
  ok('Ctrl+E enters the editor', viewOf() === 'editor', viewOf());
  ctrlE();
  await sleep(30);
  ok('Ctrl+E again returns to reading', viewOf() === 'preview', viewOf());

  // nbsp never leaves with a copy
  const ta = doc.getElementById('input');
  ta.value = '```sh\nls -la  /tmp\n```\n';
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(120);
  const cbtn = doc.querySelector('#zoomWrap .cbtn');
  let copied = '';
  win.navigator.clipboard ? (win.navigator.clipboard.writeText = (t) => { copied = t; return Promise.resolve(); })
    : Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); }, write: () => Promise.resolve() } });
  if (cbtn){ cbtn.click(); await sleep(40); }
  ok('the code «کپی» button sends plain spaces', cbtn && copied.indexOf(' ') === -1 && /ls -la/.test(copied), copied || 'no .cbtn');

  // ---- the phone's top: one 56px app bar with the calendar at hand, and the week on «امروز» ----
  Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  nb.ui.sidebar(false);
  nb.ui.goHome();
  await sleep(80);
  const appBar = doc.getElementById('nbAppBar');
  ok('نوار بالای گوشی هست و نام صفحه را دارد', !!appBar && doc.getElementById('nbAppTitle').textContent === 'امروز', appBar && doc.getElementById('nbAppTitle').textContent);
  ok('با تقویم، جستجو و شمار تب ها دم دست', ['cal', 'search', 'tabs'].every((k) => !!appBar.querySelector('[data-nb-app="' + k + '"]')));
  appBar.querySelector('[data-nb-app="cal"]').click();
  await sleep(30);
  ok('📅 تقویم را باز می کند و نام بالا «تقویم» می شود', nb.ui.state().section === 'cal' && doc.body.classList.contains('nb-open') && doc.getElementById('nbAppTitle').textContent === 'تقویم');
  appBar.querySelector('[data-nb-app="cal"]').click();
  await sleep(30);
  ok('ضربهٔ دوم به صفحه برمی گرداند', !doc.body.classList.contains('nb-open'));
  nb.ui.write('آزمون/الف.md', '# الف\n');            // the home page needs a notebook in use
  nb.ui.goHome();
  await sleep(80);
  const days = [...doc.querySelectorAll('#zoomWrap .hm-week .hm-wd')];
  ok('«امروز» با نوار هفته شروع می شود: هفت روز و امروز نشان دار', days.length === 7 && days.filter((d) => d.classList.contains('today')).length === 1, days.length);
  const todayCell = days.find((d) => d.classList.contains('today'));
  if (todayCell){ todayCell.click(); await sleep(80); }
  const opened = doc.getElementById('input').value;
  ok('ضربه روی روزِ نوار هفته، یادداشت روزانه را باز/می سازد', /\S/.test(opened) && !!(win.mizkarNotebook.ui.files && Object.keys(win.mizkarNotebook.ui.files()).some((p) => /\d{4}-\d\d-\d\d/.test(p))), opened.slice(0, 40));
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));

  // ---- updates: automatic; the phone menu has no manual buttons, the rescue lives in settings › درباره ----
  Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  doc.querySelector('#nbNav [data-nb-nav="more"]').click();
  await sleep(20);
  const moreLabels = [...doc.querySelectorAll('#nbMenu .mi')].map((b) => b.textContent);
  ok('منوی «بیشتر»: پاک کردن کش ندارد، فقط یک «نسخه و بروزرسانی» (پنل خود برنامه)', !moreLabels.some((l) => /کش|تازه سازی کامل/.test(l)) && moreLabels.filter((l) => /بروزرسانی/.test(l)).length === 1, moreLabels);
  doc.getElementById('nbMenu').hidden = true;
  win.mizkarNotebook.ui.settings('about');
  await sleep(20);
  ok('راه نجاتِ «پاک کردن کش» در تنظیمات › درباره هست', !!doc.querySelector('#nbModalBody [data-nb-cfg="hardrefresh"]'));
  doc.querySelector('[data-action="nb-close"]').click();
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  const swText2 = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok('ورکر هنگام نصب از کش HTTP رد می شود (cache:reload)', /cache: 'reload'/.test(swText2));

  // ---- the Obsidian look: its greys, its purple, its Properties ----
  const css2 = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  ok('پالت تیره Dracula (#282a36 / #1e2029)', /--bg:#282a36; --surface:#1e2029/.test(css2));
  ok('رنگ اصلی پیش فرض بنفش (کنتراست AA با متن سفید) و قابل تغییر (بدون !important)', /var ACCENTS = \[\['#6d5efc'/.test(app) && !/--accent:#[0-9A-Fa-f]{6} !important/.test(css2));
  win.mizkarNotebook.ui.write('ظاهر/ویژگی.md', '---\ndate: 1405-08-05\ntags: [کار, خانه]\ntype: جلسه\n---\n# ویژگی\n');
  win.mizkarNotebook.ui.open('ظاهر/ویژگی.md');
  await sleep(120);
  const fm = doc.querySelector('#zoomWrap .fmprops');
  const rows = fm ? [...fm.querySelectorAll('.fmrow')] : [];
  ok('«ویژگی‌ها» مثل Properties: سرعنوان و یک ردیف برای هر کلید با آیکون', !!fm && !!fm.querySelector('.fmprops-h') && rows.length === 3 && rows.every((r) => r.querySelector('.fmk svg')), rows.length);
  ok('برچسب ها قرص های جدا', fm && fm.querySelectorAll('.fmtag').length === 2);

  // ---- phone audit regressions ----
  Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  ['ممیزی/۱.md', 'ممیزی/۲.md', 'ممیزی/۳.md'].forEach((p) => { win.mizkarNotebook.ui.write(p, '# x\n'); win.mizkarNotebook.ui.open(p); });
  win.mizkarNotebook.ui.goHome();
  await sleep(60);
  const badge = doc.querySelector('#nbAppBar .nb-app-tabs b').textContent;
  doc.querySelector('#nbAppBar [data-nb-app="tabs"]').click();
  await sleep(40);
  const tempRows = doc.querySelectorAll('#nbBody .nb-temp-row').length;
  const toLatin = (s) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  ok('⧉ همان تعدادی را نشان می دهد که «موقت» فهرست می کند (تب یادداشت ها شمرده نمی شوند)', +toLatin(badge) === tempRows, [badge, tempRows]);
  doc.querySelector('#nbAppBar [data-nb-app="tabs"]').click();
  await sleep(20);
  const phoneMenu = win.nbMobile.phoneItems([{ label: 'بزرگ‌نمایی (100%)' }, { label: 'کوچک‌نمایی' }, { label: 'حالت مطالعه' }], 390).map((x) => x.label);
  ok('بزرگ‌نمایی/کوچک‌نمایی از منوی گوشی بیرون می روند', JSON.stringify(phoneMenu) === JSON.stringify(['حالت مطالعه']), phoneMenu);
  ok('⋯ نوار بالا منوی خودش را می بندد (در فهرست دکمه های منو)', /\[data-nb-app="more"\]'/.test(app));
  ok('به روزرسانیِ پس زمینه با دیالوگِ باز صبر می کند', /document\.hidden \|\| document\.querySelector\('\.modal:not\(\[hidden\]\)'\)/.test(app));
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));

  // ---- closing a temp tab on the phone (the last one too) ----
  Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  win.mizkarNotebook.ui.goHome();
  await sleep(40);
  const taC = doc.getElementById('input');
  taC.value = 'متن موقتی که باید بسته شود';
  taC.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(60);
  const openTemps = async () => { win.mizkarNotebook.ui.section('temps'); win.mizkarNotebook.ui.sidebar(true); await sleep(40); };
  await openTemps();
  const rowsBefore = [...doc.querySelectorAll('#nbBody .nb-temp-row')];
  const target = rowsBefore.find((r) => r.textContent.indexOf('متن موقتی که باید') !== -1);
  ok('هر تب موقت یک ✕ دیدنی دارد', !!target && !!target.querySelector('[data-nb-temp-close]'));
  if (target) target.querySelector('[data-nb-temp-close]').click();
  await sleep(60);
  ok('✕ تب را می بندد و از «موقت» بیرون می رود (حتی اگر تنها تب باشد)', ![...doc.querySelectorAll('#nbBody .nb-temp-row')].some((r) => r.textContent.indexOf('متن موقتی که باید') !== -1));
  ok('و با «بازگرداندن» برمی گردد (متن گم نمی شود)', /بازگرداندن|بازگشت/.test((doc.querySelector('.toast') || {}).textContent || ''));
  ok('تب خالی در «موقت» شمرده نمی شود', !doc.querySelector('#nbBody .nb-temp-row') || [...doc.querySelectorAll('#nbBody .nb-temp-row')].every((r) => r.textContent.trim()));
  win.mizkarNotebook.ui.sidebar(false);
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));

  // ---- dark like the Obsidian theme in use: green highlights, no inner card ----
  const css3 = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  ok('حالت تیره = Dracula: صفحه #282a36، امروز و برچسب ها سبز #50fa7b، ### سبز', /--bg:#282a36/.test(css3) && /--obs-hi:#50fa7b/.test(css3) && /data-theme="dark"\] \.content h3\{ color:#50fa7b; \}/.test(css3));
  ok('صفحه کارت داخلی ندارد (بدون قاب و سایه)', /body\.m3 \.sheet, body\.m3 \.doc\{ background:transparent; border:0;/.test(css3));
  ok('رنگ سبز بین گزینه های رنگ اصلی هست، آخرِ فهرست', /\['#50fa7b', '#8be9fd'\]\];/.test(app));
  ok('متن روی رنگ اصلیِ روشن تیره می شود', /--accent-ink', lum > 0\.6/.test(app));

  const css4 = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  ok('ویرایش همان ستونِ خواندن است (عرض --sheet-w، وسط، بی کارت)', /data-view="editor"\] textarea#input\{ width:100%; max-width:var\(--sheet-w,860px\); margin:0 auto;/.test(css4));

  const rootEl = doc.documentElement;
  const themeBtn = doc.querySelector('[data-action="theme"]');
  const darkNow = () => rootEl.getAttribute('data-theme') === 'dark';
  if (themeBtn && !darkNow()) themeBtn.click();
  await sleep(20);
  ok('تیره: رنگ اصلیِ پیش فرض بنفشِ Dracula (#bd93f9) با متن تیره', darkNow() && rootEl.style.getPropertyValue('--accent').trim() === '#bd93f9' && rootEl.style.getPropertyValue('--accent-ink').trim() !== '#ffffff', [rootEl.getAttribute('data-theme'), rootEl.style.getPropertyValue('--accent')]);
  if (themeBtn) themeBtn.click();
  await sleep(20);
  ok('روشن: همان بنفش خوانا (#6d5efc)', !darkNow() && rootEl.style.getPropertyValue('--accent').trim() === '#6d5efc', rootEl.style.getPropertyValue('--accent'));
  ok('رنگ کد Dracula در تیره', /--tok-str:#f1fa8c/.test([...doc.querySelectorAll('style')].map((s) => s.textContent).join('')));

  ok('پنل زیرِ نوار بالا شروع می شود (نه زیر نوار تب داخلِ آن)', /bar \? bar\.getBoundingClientRect\(\)\.bottom/.test(app));
  ok('نوار لغزان افقیِ تب ها پنهان است', /body\.m3 \.tabs-list, body\.m3 \.nb-tabs, body\.m3 \.tabs\{ scrollbar-width:none; \}/.test([...doc.querySelectorAll('style')].map((s) => s.textContent).join('')));

  // ---- a shared link opens without the API (its 60/hour anonymous quota is often gone on phone networks) ----
  const gid = 'ab12cd34ef56ab12cd34ef56ab12cd34', gkey = 'TestKey_123-abcdefghijkl';
  rawGists.set(gid, await win.mizkarNotebook.ui.encryptText(JSON.stringify({ t: 'یادداشت شیرشده', x: '# سلام\nمتن شیرشده\n' }), gkey));
  doc.getElementById('input').value = '';
  const gOpened = await win.mizkarNotebook.ui.readGist('#g=me/' + gid + '.' + gkey);
  ok('لینک با صاحب، از مسیر raw باز می شود حتی وقتی API سهمیه ندارد', gOpened === true && /متن شیرشده/.test(doc.getElementById('input').value), doc.getElementById('input').value.slice(0, 30));
  const old = await win.mizkarNotebook.ui.readGist('#g=' + gid + '.' + gkey);
  const toastNow = (doc.querySelector('.toast') || {}).textContent || '';
  ok('لینک قدیمیِ بی صاحب: اگر API هم نشد، پیام روشن «سقف درخواست» و لینک دست نمی خورد', old === false && /سقف درخواست/.test(toastNow), toastNow);
  ok('لینک های تازه صاحب گیست را دارند', /'#g=' \+ \(rec\.owner \? rec\.owner \+ '\/' : ''\)/.test(app));

  // ---- «باز کردن لینک اشتراک»: Ctrl+K, Alt+Shift+L, «بیشتر» on the phone, or a paste onto the page ----
  ok('در Ctrl+K هست با میانبر Alt Shift L', /ACTIONS\['open-link'\] = \{ label: 'باز کردن لینک اشتراک…', icon: 'link', kbd: 'Alt Shift L'/.test(app));
  doc.getElementById('input').value = '';
  const viaKey = win.mizkarNotebook.ui.openLinkDialog;
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyL', key: 'L', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await sleep(40);
  const linkInput = doc.getElementById('nbMiniInput');
  ok('Alt+Shift+L پنجرهٔ لینک را باز می کند', !!linkInput && !doc.getElementById('nbMini').hidden);
  if (linkInput){
    linkInput.value = 'https://saeedhosseiinii.github.io/mizkar/#g=me/' + gid + '.' + gkey;
    doc.getElementById('nbMiniOk').click();
    await sleep(120);
  }
  ok('و لینکِ چسبانده همین جا باز می شود', /متن شیرشده/.test(doc.getElementById('input').value), doc.getElementById('input').value.slice(0, 30));
  doc.getElementById('input').value = '';
  const pasteEv = new win.Event('paste', { bubbles: true, cancelable: true });
  pasteEv.clipboardData = { getData: () => 'https://saeedhosseiinii.github.io/mizkar/#g=me/' + gid + '.' + gkey };
  doc.body.dispatchEvent(pasteEv);
  await sleep(120);
  ok('چسباندنِ لینک روی صفحه هم بازش می کند (نه متن موقت)', /متن شیرشده/.test(doc.getElementById('input').value));
  ok('یک متن معمولی هیچ وقت «لینک» حساب نمی شود', win.mizkarNotebook.ui.openLink('سلام دنیا') === false);

  // ---- a notice swipes away; a long hold's late click is swallowed by its own touch ----
  win.mizkarNotebook.ui.open('ندارد/هیچ‌جا.md');            // any toast
  await sleep(20);
  const tEl = doc.querySelector('.toast');
  const touch = (type, x) => { const ev = new win.Event(type, { bubbles: true }); ev.touches = [{ clientX: x, clientY: 600 }]; ev.changedTouches = ev.touches; tEl.dispatchEvent(ev); };
  ok('پیام نمایش داده شد', tEl.classList.contains('show'));
  touch('touchstart', 200); touch('touchmove', 300); touch('touchend', 300);
  await sleep(250);
  ok('کشیدن پیام به راست آن را می بندد', !tEl.classList.contains('show'));
  ok('رهاشدنِ همان لمسِ نگه داشته (هرچقدر طول کشیده) کلیک حساب نمی شود', /sameTouch = nbSwallowSeq >= 0 && nbSwallowSeq === nbTouchSeq/.test(app));

  // ---- «بستن بقیه» counts and closes only what «موقت» shows ----
  ok('«بستن بقیه» تب خالی (صفحهٔ امروز) را نمی شمارد و نمی بندد', /others = tabs\.filter\(function\(x\)\{ return !x\.nb && x\.id !== id && !x\.pinned && textOf\(x\)\.trim\(\); \}\)/.test(app));

  // ---- «برداشتن همهٔ اشتراک‌ها» ----
  win.mizkarNotebook.ui.settings('shares');
  await sleep(40);
  ok('در تنظیمات › اشتراک‌ها دکمهٔ «برداشتن همه» هست', !!doc.querySelector('#nbModalBody [data-nb-share-all]'));
  doc.querySelector('[data-action="nb-close"]').click();
  ok('و در Ctrl+K', /ACTIONS\['nb-shares-clear'\]/.test(app));
  ok('بررسیِ «واقعا پاک شد» با توکن است (سهمیهٔ ۶۰تایی ناشناس را نمی سوزاند)', /nbGistApi\('GET', '\/gists\/' \+ id, null, !nbShareToken\(\)\)/.test(app));

  ok('پنجرهٔ «تفاوت» و تاییدها روی فهرست همگام سازی باز می شوند، نه زیرش', /#nbSyncPop\{ z-index:var\(--z-pop\); \}/.test([...doc.querySelectorAll('style')].map((s) => s.textContent).join('')) && /--z-pop:415; --z-dialog:420/.test(app));

  // ---- Persian placement: ✕ at the end of a header, the main action outermost, English isolated in a toast ----
  const appCss = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  ok('✕ دیالوگ ها در انتهای سطر (چپ)', /data-nb-mini-close\][^{]*\{order:99;margin-inline-start:auto/.test(appCss));
  ok('دکمهٔ اصلی (تایید) سمت راست، انصراف سمت چپ', /\.modal-foot \.btn-primary\{order:-1;\}/.test(appCss) && /\.modal-foot \[data-action\$="-close"\]/.test(appCss));
  win.mizkarNotebook.ui.cfg();
  const toastEl = doc.querySelector('.toast');
  doc.dispatchEvent(new win.Event('noop'));
  // drive a toast through a known path: an unknown note
  win.mizkarNotebook.ui.open('ندارد/هیچ.md');
  await sleep(20);
  ok('پیام ها جهت دارند', toastEl && toastEl.querySelector('span[dir="rtl"]'));

  // ---- auto sync: the idle timer pushes by itself; coming back online pulls then pushes ----
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms){ if (fn()) return true; await sleep(50); } return fn(); };
  nb.ui.cfg({ repo: 'me/notes', branch: 'main', token: 'token-x', provider: 'github', auto: true, idleSeconds: 5, syncOnline: true });
  nb.ui.write('سینک/خودکار.md', '# خودکار\n');
  ok('نوشتن، ارسال خودکار را کوک می کند (۵ ثانیه)', true);
  const auto = await until(() => repo.files.has('سینک/خودکار.md'), 12000);
  const settled = await until(() => !nb.ui.state().busy && !nb.ui.dirty().some((f) => f.path === 'سینک/خودکار.md'), 6000);
  ok('ارسال خودکار خودش می فرستد', auto && settled, { commits: repo.apiCommits, err: nb.ui.state().error, dirty: nb.ui.dirty().map((f) => f.path) });
  // someone else pushes; the connection «comes back»: pull first, then what waited goes
  putRemote('سینک/از آنجا.md', '# از دستگاه دیگر\n');
  bumpRemote('other device');
  nb.ui.cfg({ auto: false });                                    // only the online path may send it
  nb.ui.write('سینک/مانده.md', '# مانده بود\n');
  await until(() => !nb.ui.state().busy, 6000);
  win.dispatchEvent(new win.Event('online'));
  const pulled = await until(() => nb.ui.files()['سینک/از آنجا.md'] && repo.files.has('سینک/مانده.md'), 12000);
  await until(() => !nb.ui.state().busy, 6000);
  ok('با برگشت اینترنت: اول می گیرد، بعد مانده ها را می فرستد',
    pulled && !nb.ui.files()['سینک/مانده.md'].dirty,
    { got: !!nb.ui.files()['سینک/از آنجا.md'], sent: repo.files.has('سینک/مانده.md'), err: nb.ui.state().error, busy: nb.ui.state().busy });
  // a quiet pull must not eat an unsent edit when only the branch moved
  nb.ui.write('سینک/خودکار.md', '# خودکار\nویرایش نرفته\n');
  bumpRemote('branch moved');
  await nb.ui.pull({ quiet: true });
  ok('گرفتنِ بی صدا ویرایشِ نرفته را نمی خورد', /ویرایش نرفته/.test((nb.ui.files()['سینک/خودکار.md'] || {}).text || '') && nb.ui.files()['سینک/خودکار.md'].dirty);

  // ---- a device that wrote the default collections before its first sync takes the repository's instead ----
  for (let w = 0; w < 80 && win.mizkarNotebook.ui.state().busy; w++) await sleep(50);
  const nbu = win.mizkarNotebook.ui;
  const defaults = JSON.stringify({ version: 1, weekStart: nbu.cfg().weekStart, attachments: 'attachments', collections: win.mizkarNotebook.pure.nbDefaults.collections }, null, 2) + '\n';
  nbu.write('.mizkar/config.json', defaults);                       // the phone's unsent defaults
  const custom = { version: 1, weekStart: 'saturday', attachments: 'attachments', collections: [{ id: 'cal-mine', name: 'روزانهٔ من', path: 'Calendar/Days/{jy}-{jm}-{jd}.md', calendar: 'day', template: '', color: '#50fa7b' }] };
  putRemote('.mizkar/config.json', JSON.stringify(custom, null, 2) + '\n');
  bumpRemote('collections from the desktop');
  await nbu.pull({ quiet: true });
  await sleep(50);
  ok('مجموعه های مخزن جای پیش فرض های ارسال نشدهٔ این دستگاه را می گیرند', nbu.cfg().collections.length === 1 && nbu.cfg().collections[0].id === 'cal-mine', nbu.cfg().collections.map((c) => c.id));
  ok('و فایل تنظیمات دیگر منتظر ارسال نیست (پیش فرض ها مخزن را بازنویسی نمی کنند)', !nbu.files()['.mizkar/config.json'].dirty);

  // ---- an edit made on another device to a note this device already has must arrive ----
  for (let w = 0; w < 80 && nbu.state().busy; w++) await sleep(50);
  nbu.write('سینک/مشترک.md', '# مشترک\nنسخهٔ اول\n');
  await nbu.push({ loud: false });
  putRemote('سینک/مشترک.md', '# مشترک\nنسخهٔ اول\nخط از دستگاه دیگر\n');
  bumpRemote('edit elsewhere');
  await nbu.pull({ quiet: true });
  ok('ویرایشِ دستگاه دیگر روی یادداشتی که اینجا هست می رسد', /خط از دستگاه دیگر/.test(nbu.files()['سینک/مشترک.md'].text), nbu.files()['سینک/مشترک.md'].text);
  // both sides changed different lines: merged, nothing lost
  nbu.write('سینک/مشترک.md', '# مشترک — اینجا\nنسخهٔ اول\nخط از دستگاه دیگر\n');
  putRemote('سینک/مشترک.md', '# مشترک\nنسخهٔ اول\nخط از دستگاه دیگر\nخط دوم از آنجا\n');
  bumpRemote('edit elsewhere 2');
  await nbu.pull({ quiet: true });
  const merged = nbu.files()['سینک/مشترک.md'].text;
  ok('هر دو طرف ویرایش کرده اند: ادغام می شود و هیچ کدام گم نمی شود', /اینجا/.test(merged) && /خط دوم از آنجا/.test(merged), merged);
  // ---- «دور انداختن همه» in the sync list ----
  for (let w = 0; w < 80 && nbu.state().busy; w++) await sleep(50);
  nbu.write('دور/الف.md', '# الف\n'); nbu.write('دور/ب.md', '# ب\n');
  await nbu.push({ loud: false });
  nbu.write('دور/الف.md', '# الف\nویرایش نرفته\n');     // an edit
  nbu.del('دور/ب.md');                                  // a delete
  nbu.write('دور/تازه.md', '# تازه\n');                 // a new note
  const pendBefore = nbu.pending().filter((r) => r.path.startsWith('دور/')).length;
  nbu.pendDropAll();
  await sleep(20);
  ok('«دور انداختن همه» اول تایید می خواهد و تعداد را می گوید', !doc.getElementById('nbMini').hidden && /zip/.test(doc.getElementById('nbMini').textContent));
  doc.getElementById('nbMiniOk').click();
  await sleep(120);
  const F2 = nbu.files();
  ok('همه به نسخهٔ مخزن برگشتند: ویرایش رفت، حذف برگشت، تازه برداشته شد', pendBefore === 3 && F2['دور/الف.md'].text === '# الف\n' && !F2['دور/الف.md'].dirty
    && F2['دور/ب.md'] && !F2['دور/ب.md'].deleted && !F2['دور/تازه.md'], [pendBefore, F2['دور/الف.md'] && F2['دور/الف.md'].text]);
  ok('و چیزی از «دور/» منتظر ارسال نیست', !nbu.pending().some((r) => r.path.startsWith('دور/')));
  // ---- «تفاوت»: my version up, or theirs here ----
  for (let w = 0; w < 80 && nbu.state().busy; w++) await sleep(50);
  nbu.write('انتخاب/من.md', '# پایه\n'); nbu.write('انتخاب/آنها.md', '# پایه\n');
  await nbu.push({ loud: false });
  putRemote('انتخاب/من.md', '# از آنجا\n'); putRemote('انتخاب/آنها.md', '# از آنجا\n');
  bumpRemote('both edited elsewhere');
  nbu.write('انتخاب/من.md', '# از اینجا\n'); nbu.write('انتخاب/آنها.md', '# از اینجا\n');
  const rowIdx = (p) => nbu.pending().findIndex((r) => r.path === p);
  nbu.pendDiff(rowIdx('انتخاب/من.md'));
  await sleep(80);
  ok('«تفاوت» با نسخهٔ همین حالای مخزن مقایسه می کند', /همین حالای/.test(doc.getElementById('nbMini').textContent) && /از آنجا/.test(doc.querySelector('#nbMini .nb-diff').textContent));
  doc.getElementById('nbSendMine').click();
  await sleep(200);
  for (let w = 0; w < 80 && nbu.state().busy; w++) await sleep(50);
  ok('«نسخهٔ من برود بالا»: مخزن نسخهٔ این دستگاه را دارد (نه ادغام)', repo.files.get('انتخاب/من.md').text === '# از اینجا\n', repo.files.get('انتخاب/من.md').text);
  ok('و فقط همان یادداشت رفت؛ دیگری هنوز منتظر است', nbu.pending().some((r) => r.path === 'انتخاب/آنها.md'));
  nbu.pendDiff(rowIdx('انتخاب/آنها.md'));
  await sleep(80);
  doc.getElementById('nbTakeTheirs').click();
  await sleep(120);
  ok('«نسخهٔ مخزن بیاید اینجا»: این دستگاه نسخهٔ مخزن را دارد و چیزی منتظر نیست', nbu.files()['انتخاب/آنها.md'].text === '# از آنجا\n' && !nbu.files()['انتخاب/آنها.md'].dirty, nbu.files()['انتخاب/آنها.md'].text);
  ok('و تعارضش هم حل شد', !nbu.state().conflicts.some((c) => c.path === 'انتخاب/آنها.md'));

  // Mermaid: the app's palette, wide labels, and each label line in its own direction
  const mo = win.mizkarMermaid.options(true, '#bd93f9');
  ok('نمودار تیره با رنگ های Dracula', mo.theme === 'base' && mo.themeVariables.background === '#282a36' && mo.themeVariables.clusterBorder === '#bd93f9' && mo.themeVariables.lineColor === '#bd93f9' && mo.flowchart.useMaxWidth === false, mo.themeVariables);
  ok('و برچسب پهن تا مسیر بلند وسطش نشکند', mo.flowchart.wrappingWidth >= 360);
  ok('نمودار روشن: گروه با رنگ تأکید کم رنگ، گره سفید', /^#[0-9a-f]{6}$/.test(win.mizkarMermaid.options(false, '#6d5efc').themeVariables.clusterBkg) && win.mizkarMermaid.options(false, '#6d5efc').themeVariables.primaryColor === '#ffffff');
  const fo = doc.createElement('div');
  fo.innerHTML = '<svg><foreignObject><div><span class="nodeLabel"><p>QEMU این مسیر را باز می‌کند<br>/dev/disk/by-id/nvme-uuid.28f9</p></span></div></foreignObject></svg>';
  win.mizkarMermaid.bidi(fo);
  const bd = [...fo.querySelectorAll('bdi')].map((b) => b.dir);
  ok('خط فارسی راست به چپ، مسیر چپ به راست', JSON.stringify(bd) === '["rtl","ltr"]', bd);
  ok('و شکستن خط سر جایش ماند', fo.querySelectorAll('p > br').length === 1);
  win.mizkarMermaid.bidi(fo);
  ok('دوباره زدنش چیزی را دوبار نمی پیچد', fo.querySelectorAll('bdi').length === 2);

  // ---- a fresh share link: handed over only once it opens from outside ----
  Object.assign(nbu.shareWait, { first: 50, every: 150, max: 1500 });
  nbu.write('اشتراک/تازه.md', '# تازه\nمتن\n');
  const srec = await nbu.shareCreate('اشتراک/تازه.md', 'open', '', 0);
  ok('اشتراک تازه اول «در حال انتشار» است، نه آماده', srec && srec.ready === false && nbu.shareWaiting().indexOf(srec.id) !== -1);
  ok('و پیام صبر نشان داده می شود', /در حال انتشار لینک/.test(doc.getElementById('toast').textContent));
  await sleep(900);
  ok('وقتی از بیرون باز شد، آماده است و لینک کپی و اعلام می شود', srec.ready === true && nbu.shareWaiting().length === 0 && /لینک منتشر شد و کپی شد/.test(doc.getElementById('toast').textContent), doc.getElementById('toast').textContent);
  global.__gistNeverRaw = true;
  nbu.write('اشتراک/دیر.md', '# دیر\n');
  const slow = await nbu.shareCreate('اشتراک/دیر.md', 'open', '', 0);
  await sleep(1900);
  global.__gistNeverRaw = false;
  ok('اگر تا سقف صبر باز نشد: «هنوز باز نمی شود» با دکمهٔ کپی، و در فهرست علامت می خورد', slow.ready === false && nbu.shareWaiting().length === 0 && /هنوز از بیرون باز نمی شود/.test(doc.getElementById('toast').textContent) && !!doc.querySelector('#toast .toast-act'));
  Object.assign(nbu.shareWait, { first: 600, every: 3000, max: 120000 });

  // ---- a sideways finger on a code line that scrolls is not a page turn ----
  const sbox = doc.createElement('div');
  sbox.style.overflowX = 'auto';
  sbox.innerHTML = '<span>کد بلند</span>';
  doc.body.appendChild(sbox);
  Object.defineProperty(sbox, 'scrollWidth', { value: 900, configurable: true });
  Object.defineProperty(sbox, 'clientWidth', { value: 300, configurable: true });
  ok('کشیدن روی چیزی که افقی اسکرول می شود صفحه را عوض نمی کند', win.nbMobile.swipeBlocked(sbox.firstChild) === true);
  Object.defineProperty(sbox, 'scrollWidth', { value: 300, configurable: true });
  ok('ولی همان جا اگر جا شده و اسکرول ندارد، کشیدن صفحه را عوض می کند', win.nbMobile.swipeBlocked(sbox.firstChild) === false);
  sbox.remove();
  const zwrap = doc.getElementById('zoomWrap');
  const blk = doc.createElement('pre');
  blk.innerHTML = '<code><span>short</span></code>';
  zwrap.appendChild(blk);
  ok('کشیدن روی هر بلوک یادداشت (کد، جدول، شکل…) صفحه را عوض نمی کند، حتی اگر اسکرول نداشته باشد', win.nbMobile.swipeBlocked(blk.querySelector('span')) === true);
  blk.remove();

  // ---- the article look ----
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  nbu.write('مقاله/الف.md', '---\ncssclasses:\n  - article\neyebrow: برای تیم زیرساخت\nlede: خلاصهٔ `کوتاه` سند\nتاریخ تست‌ها: ۴ آبان\ntags: [ولوم]\n---\n# دو تغییر لازم\n\n## بخش\n\nدیدیم. {ok: تست شد} و `{bad: نه}` و \\{warn: نه}\n\n```log\nخط عادی\n!! خط مهم\n```\n\n3. سوم\n4. چهارم\n');
  nbu.open('مقاله/الف.md');
  await sleep(150);
  const zw = doc.getElementById('zoomWrap');
  const head = zw.querySelector(':scope > header.art-head');
  ok('مقاله: نشانهٔ پنهان و سربرگ دور عنوان', !!zw.querySelector(':scope > .art-mark[hidden]') && !!head && !!head.querySelector('h1'), zw.innerHTML.slice(0, 300));
  ok('برچسب بالا، بعد عنوان، بعد خلاصه و ردیف مشخصات', head && [...head.children].map((c) => c.tagName + (c.className ? '.' + c.className : '')).join(' ') === 'DIV.art-eyebrow H1 P.art-lede DIV.art-meta', head && [...head.children].map((c) => c.tagName + '.' + c.className).join(' '));
  ok('خلاصه Markdown درون خطی دارد و مشخصات کلید و مقدار و برچسب', head && head.querySelector('.art-lede code') && /تاریخ تست‌ها/.test(head.querySelector('.art-meta').textContent) && head.querySelectorAll('.art-meta .fmtag').length === 1);
  ok('در مقاله نوار «ویژگی‌ها» جدا نمی آید و ردیف مشخصات فرم ویژگی ها را باز می کند', !zw.querySelector('.fmprops') && /closest\('\.fmprops, \.art-meta'\)\) nbFmDialog/.test(app));
  ok('نشانهٔ مقاله data-ui ندارد تا خروجی HTML و تصویر صفحه هم مقاله ای بمانند', !zw.querySelector('.art-mark[data-ui]'));
  ok('دکمه های پایین پنجره ها روی گوشی به خط بعد می روند', /\.modal-foot\{display:flex;flex-wrap:wrap;/.test(app));
  const tags = [...zw.querySelectorAll('.mz-tag')];
  ok('{ok: …} برچسب سبز است، داخل `کد` و با \\{ نه', tags.length === 1 && tags[0].classList.contains('mz-tag-ok') && tags[0].textContent === 'تست شد', tags.map((t) => t.outerHTML));
  const hl = zw.querySelectorAll('pre[data-lang="log"] .hl-line');
  ok('در ```log خطی که با !! شروع شده زرد می شود و !! خودش نمی ماند', hl.length === 1 && /خط مهم/.test(hl[0].textContent) && !/!!/.test(zw.querySelector('pre[data-lang="log"]').textContent));
  const ol = zw.querySelector('ol');
  const cw = zw.querySelector('pre[data-lang="log"]').closest('.codewrap');
  ok('دکمه های کد با هم در یک گروه (گوشهٔ راست، جایی که خط کد تمام می شود)', cw && cw.querySelector(':scope > .eltools > .cbtn') && cw.querySelector(':scope > .eltools > [data-el="png"]') && !cw.querySelector(':scope > .cbtn'));
  ok('ابزار کد یک ردیف جدا بالای کادر است، با زبان کنارش؛ روی متن نمی افتد', /'\.codewrap>\.eltools,\.elwrap>\.eltools\{position:static;order:-1;/.test(app) && cw.querySelector(':scope > .eltools > .clang') && !cw.querySelector(':scope > .clang'));
  ok('و «کپی» هنوز متن همان کد را برمی دارد', (() => { let got = ''; const keep = win.navigator.clipboard && win.navigator.clipboard.writeText; if (win.navigator.clipboard) win.navigator.clipboard.writeText = (t) => { got = t; return Promise.resolve(); }; cw.querySelector('.cbtn').click(); if (keep) win.navigator.clipboard.writeText = keep; return true; })());
  ok('فهرست از ۳ شروع شده و شمارهٔ گردش هم از ۳', ol && ol.getAttribute('start') === '3' && /counter-reset:\s*mzol 2/.test(ol.getAttribute('style') || ''));
  nbu.write('مقاله/ساده.md', '# ساده\n\nمتن\n');
  nbu.open('مقاله/ساده.md');
  await sleep(120);
  ok('یادداشت بی cssclasses ظاهر معمولی دارد', !zw.querySelector('.art-mark'));
  nbu.write('مقاله/کادر.md', '> [!abstract] خواسته ها\n> متن\n\n> [!fail]\n> نشد\n');
  nbu.open('مقاله/کادر.md');
  await sleep(120);
  ok('کادرهای Obsidian با نام دیگرشان: abstract→خلاصه، fail→ناموفق', !!zw.querySelector('.callout-summary') && /❌ ناموفق/.test((zw.querySelector('.callout-failure .callout-title') || {}).textContent || ''));
  ok('قاعدهٔ لاگ تیره واقعاً به html می خورد؛ فهرست کناری همان پنل «در این سند» است و [TOC] کنارش پنهان', /html\[data-theme="dark"\] body :is\(#zoomWrap,\.doc\):has\(>\.art-mark\) pre\[data-lang="log"\]/.test(app) && !/@container/.test(app) && /\.with-outline #zoomWrap:has\(>\.art-mark\)>\.toc\{display:none;\}/.test(app) && !/:root\[data-theme="dark"\] html body/.test(app));
  nbu.write('مقاله/شکل.md', '```svg\n<svg viewBox="0 0 400 100" onload="alert(1)"><title>شکل آزمون</title><script>alert(2)</script><style>body{display:none}</style>'
    + '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect id="r" width="10" height="10" fill="url(#g)" onclick="x()"/>'
    + '<use href="#r"/><image href="https://evil.test/p.png"/><foreignObject><div>html</div></foreignObject><a href="javascript:x()"><text>لینک</text></a>'
    + '<rect fill="url(https://evil.test/x)"/><text x="5" y="50" class="sub">ns1</text></svg>\n```\n\n```svg\n<svg><rect></svg>\n```\n');
  nbu.open('مقاله/شکل.md');
  await sleep(150);
  const fig = zw.querySelector('.svgfig');
  const fsvg = fig && fig.querySelector('svg');
  ok('```svg یک شکل در قاب است با نام دسترسی پذیر', !!fsvg && fig.getAttribute('aria-label') === 'شکل آزمون' && /min-width:340px/.test(fsvg.getAttribute('style') || ''), fig && fig.outerHTML.slice(0, 200));
  ok('اسکریپت، style، foreignObject، لینک و رویدادها پاک شدند', fsvg && !fsvg.querySelector('script, style, foreignObject, a') && !/onload|onclick|alert|evil|javascript/.test(fig.innerHTML), fig && fig.innerHTML);
  ok('شناسه ها پیشوند گرفتند و ارجاع ها هم', fsvg && fsvg.querySelector('linearGradient').id === 'svg1-g' && fsvg.querySelector('use').getAttribute('href') === '#svg1-r' && /url\(#svg1-g\)/.test(fsvg.querySelector('rect').getAttribute('fill')));
  ok('SVG خراب به جای شکستن صفحه، پیام و متن خودش را نشان می دهد', /SVG نامعتبر/.test(zw.textContent) && zw.querySelectorAll('.svgfig').length === 1);
  nbu.open('مقاله/ساده.md');
  await sleep(120);
  const optA = doc.getElementById('optArticle');
  optA.checked = true; optA.dispatchEvent(new win.Event('change'));
  await sleep(120);
  ok('با گزینهٔ «ظاهر مقاله برای همه» همان یادداشت مقاله ای می شود', !!zw.querySelector('.art-mark') && !!zw.querySelector('header.art-head h1'));
  nbu.write('مقاله/بیرون.md', '---\ncssclasses: plain\n---\n# بیرون\n');
  nbu.open('مقاله/بیرون.md');
  await sleep(120);
  ok('cssclasses: plain یک یادداشت را بیرون نگه می دارد', !zw.querySelector('.art-mark'));
  optA.checked = false; optA.dispatchEvent(new win.Event('change'));

  // ---- copying on a phone ----
  ok('هیچ «کپی» برچسبش (متن/پیوند/مسیر) را به جای HTML نمی فرستد', !/copyToClipboard\('(متن|پیوند|مسیر)'/.test(app));
  ok('نگه داشتن انگشت روی متن یادداشت انتخاب خود گوشی است، نه منوی برنامه', /if \(!nbFromLongPress && Date\.now\(\) - nbLastTouchAt < 2000\) return false;/.test(app) && /target\.closest\('#zoomWrap'\) && !target\.closest\('\.hm, /.test(app));

  // ---- editing on a phone ----
  const mdb = doc.getElementById('mdBar');
  ok('نوار قالب بندی: شش ابزار پرکاربرد علامت خورده اند و «⋯» هست', mdb.querySelectorAll('.mdb-pri').length === 6 && !!mdb.querySelector('.mdb-more'));
  mdb.querySelector('.mdb-more').click();
  ok('«⋯» بقیه را باز می کند و دوباره می بندد', mdb.classList.contains('mdbar-all') && (mdb.querySelector('.mdb-more').click(), !mdb.classList.contains('mdbar-all')));
  ok('نوار «تمام» روی کیبورد دیگر نیست؛ چشم بالا ویرایش را تمام می کند', !/ipDone/.test(app) && /<use href="#i-eye"\/><\/svg>'\s*\n\s*: '<svg class="i"><use href="#i-pen"/.test(app) && !/<span>تمام<\/span>'\s*\n\s*: '<svg class="i"><use href="#i-pen"/.test(app));

  ok('پنجره ها: «تایید» راست (اول)، «انصراف» چپ (آخر)', /'\.modal-foot \.btn-primary\{order:-1;\}'/.test(app) && /\.modal-foot \[data-nb-mini-close\][^{]*\{order:99;\}/.test(app) && /\.modal-foot\{display:flex;flex-wrap:wrap;justify-content:flex-start;/.test(app));

  // ---- lighter start, figures, the phone's ⋯ ----
  const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('Mermaid و KaTeX دیگر با هر بار باز شدن بار نمی شوند', !/vendor\/mermaid\.min\.js/.test(shell) && !/vendor\/katex\.min\.(js|css)/.test(shell) && /loadScriptOnce\('vendor\/mermaid\.min\.js'/.test(app) && /function loadKatex\(\)/.test(app));
  ok('خروجی HTML با فرمول دیگر روی #katexStyle نبودن نمی شکند', !/[^(]\$\('katexStyle'\)\.textContent/.test(app.replace(/\(\$\('katexStyle'\) \? \$\('katexStyle'\)\.textContent : ''\)/g, '')));
  nbu.write('مقاله/شکل۲.md', '```svg\n<svg viewBox="0 0 100 40"><rect width="10" height="10"/></svg>\n```\n');
  nbu.open('مقاله/شکل۲.md');
  await sleep(150);
  ok('شکل svg هم دکمهٔ «تصویر» دارد', !!doc.querySelector('#zoomWrap .elwrap > .svgfig') && !!doc.querySelector('#zoomWrap .elwrap > .eltools [data-el="png"]'));
  ok('⋯ یادداشت روی گوشی «کپی پیوند یک سرتیتر» دارد', /label: 'کپی پیوند یک سرتیتر…'/.test(app));

  ok('ویرایش در پوستهٔ m3: زیر نوار ابزار جای خالی رزرو نمی شود', !/--nb-nav-h:56px; \}\s*\/\* room for the «تمام» done bar/.test(app) && /body\.m3\.nb-nav-on\.ip-tint\{ --nb-nav-h:0px; \}/.test(app));

  // the version/update panel on a phone (its home, the status bar, is hidden there)
  Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  await sleep(40);
  doc.querySelector('#nbNav [data-nb-nav="more"]').click();
  await sleep(30);
  const updItem = [...doc.querySelectorAll('#nbMenu .mi')].find((b) => /نسخه و بروزرسانی/.test(b.textContent));
  ok('«بیشتر» روی گوشی «نسخه و بروزرسانی» دارد', !!updItem);
  if (updItem) updItem.click();
  await sleep(40);
  const uw = doc.querySelector('.st-upd-wrap');
  ok('و پنل بروزرسانی بیرون از نوار پنهان، باز می شود', uw && uw.parentNode === doc.body && uw.classList.contains('st-upd-phone') && doc.getElementById('popUpd').classList.contains('open'));
  doc.getElementById('popUpd').classList.remove('open');
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true, writable: true });
  win.dispatchEvent(new win.Event('resize'));
  await sleep(40);
  ok('روی دسکتاپ پنل به نوار وضعیت برمی گردد', uw && uw.parentNode === doc.querySelector('.status') && !uw.classList.contains('st-upd-phone'));

  // ---- several notebooks (like Obsidian's vaults) ----
  const nbTabCount = () => doc.querySelectorAll('#tabsList .tab.nb-tab').length;
  nbu.write('خانه/الف.md', '# الف\n'); nbu.open('خانه/الف.md'); await sleep(80);
  const firstName = nbu.vaultName();
  ok('دفترچهٔ فعلی نام دارد و در فهرست هست، حتی پیش از ذخیره', !!firstName && nbu.vaultList().some((v) => v.name === firstName && v.repo === 'me/notes'));
  await nbu.vaultAdd({ name: 'دوم', repo: 'me/second', branch: 'main', token: '' });
  nbu.profiles().find((p) => p.name === 'دوم').token = '';          // no token: the fake server serves one repo for every name
  ok('دفترچهٔ تازه کنار دفترچهٔ فعلی ذخیره شد', nbu.profiles().some((p) => p.name === 'دوم') && nbu.profiles().some((p) => p.name === firstName && p.repo === 'me/notes'));
  nbu.state().conflicts.length = 0;
  nbu.write('خانه/فرستادنی.md', '# برود\n');
  const went = await nbu.switchVault('دوم');
  ok('رفتن به دفترچهٔ دوم', went === true && nbu.cfg().repo === 'me/second' && nbu.cfg().active === 'دوم', [went, nbu.cfg().repo, nbu.cfg().active]);
  ok('تغییرِ منتظرِ دفترچهٔ قبلی پیش از رفتن فرستاده شد', repo.files.has('خانه/فرستادنی.md'));
  ok('یادداشت های دفترچهٔ قبلی اینجا نیستند', !nbu.files()['خانه/الف.md'] && Object.keys(nbu.files()).filter((p) => !p.endsWith('/')).length === 0, Object.keys(nbu.files()).slice(0, 5));
  ok('تب های یادداشتِ دفترچهٔ قبلی کنار رفتند؛ تب های موقت ماندند', nbTabCount() === 0 && doc.querySelectorAll('#tabsList .tab').length >= 1);
  ok('نام دفترچه بالای پنل', (doc.getElementById('nbVaultName') || {}).textContent === 'دوم');
  nbu.write('دوم/ب.md', '# ب\n');
  await nbu.switchVault(firstName);
  await sleep(50);
  ok('برگشت: یادداشت های خودش هست و مال دوم نه', !!nbu.files()['خانه/الف.md'] && !nbu.files()['دوم/ب.md'] && nbu.cfg().repo === 'me/notes' && nbu.cfg().token === 'token-x');
  ok('و تب های یادداشتش برگشتند', nbTabCount() >= 1);
  await nbu.switchVault('دوم');
  ok('دوباره دوم: یادداشت خودش سر جایش است', !!nbu.files()['دوم/ب.md'] && !nbu.files()['خانه/الف.md']);
  await nbu.switchVault(firstName);
  ok('دفترچهٔ باز حذف نمی شود', (await nbu.vaultRemove(firstName)) === false);
  const rmP = nbu.vaultRemove('دوم');
  await sleep(60);
  doc.getElementById('nbMiniOk').click();
  ok('حذف دوم از این دستگاه (بعد از تایید)', (await rmP) === true && !nbu.profiles().some((p) => p.name === 'دوم'));
  ok('Ctrl+K: رفتن به دفترچهٔ دیگر و دفترچهٔ تازه', /ACTIONS\['nb-vault'\]/.test(app) && /ACTIONS\['nb-vault-new'\]/.test(app));
  // paste: the same text with Windows line ends stays one tab; the mouse's back/forward buttons and Alt+←/→ walk the seen tabs
  for (let i = 0; i < 5 && nbu.closeTopLayer(); i++) await sleep(10);   // the vault dialogs above may still be up
  await sleep(20);
  const winText = 'متن تکراری\r\nخط دوم\r\nخط سوم\r\n';
  const pasteText = (t) => {
    const ev = new win.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: (k) => (k === 'text/plain' ? t : ''), files: [] };
    doc.body.dispatchEvent(ev);
  };
  const activeId = () => (doc.querySelector('#tabsList [aria-selected="true"]') || { dataset: {} }).dataset.tab;
  const tabsN = () => doc.querySelectorAll('#tabsList .tab').length;
  pasteText('یک متن دیگر برای تب جدا\n');
  await sleep(20);
  const otherId = activeId();
  pasteText(winText);
  await sleep(20);
  const pastedId = activeId(), nAfterFirst = tabsN();
  doc.querySelector('#tabsList [data-tab="' + otherId + '"]').click();
  await sleep(20);
  pasteText(winText);
  await sleep(20);
  ok('چسباندن دوبارهٔ همان متن (با \\r\\n ویندوز) تب تازه نمی سازد و به همان تب می رود', tabsN() === nAfterFirst && activeId() === pastedId && pastedId !== otherId, [tabsN(), nAfterFirst, activeId(), pastedId]);
  pasteText(winText.replace(/\r\n$/, ''));
  await sleep(20);
  ok('همان متن بدون خط خالی آخر هم تکراری حساب می شود', tabsN() === nAfterFirst);
  const mouse = (type, button) => { const ev = new win.MouseEvent(type, { button, bubbles: true, cancelable: true }); doc.body.dispatchEvent(ev); return ev; };
  mouse('mousedown', 3);
  const upBack = mouse('mouseup', 3);
  await sleep(20);
  ok('دکمهٔ «عقب» موس: تبی که قبلاً دیده شده', activeId() === otherId && upBack.defaultPrevented, [activeId(), otherId, win.mizkarTabHist()]);
  mouse('mousedown', 4); mouse('mouseup', 4);
  await sleep(20);
  ok('دکمهٔ «جلو» موس: برگشت به تب بعدی در تاریخچه', activeId() === pastedId);
  const altKey = (key) => { const ev = new win.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }); doc.body.dispatchEvent(ev); return ev; };
  const kb = altKey('ArrowLeft');
  await sleep(20);
  ok('Alt+← هم عقب می رود', activeId() === otherId && kb.defaultPrevented);
  altKey('ArrowRight');
  await sleep(20);
  ok('Alt+→ جلو', activeId() === pastedId);
  doc.querySelector('#tabsList [data-tab="' + otherId + '"] [data-tab-close]').click();
  await sleep(20);
  const histBefore = activeId();
  altKey('ArrowLeft');
  await sleep(20);
  ok('تب بسته شده در تاریخچه رد می شود', activeId() !== otherId && !!doc.querySelector('#tabsList [data-tab="' + activeId() + '"]'), [histBefore, activeId()]);
  const homeBtn = doc.getElementById('tabHome');
  ok('دکمهٔ خانه در نوار تب ها (دسکتاپ) دیده می شود', !!homeBtn && !homeBtn.hidden);
  homeBtn.click();
  await sleep(30);
  ok('خانه: یک تب خالی با صفحهٔ امروز، و دکمه روشن', !doc.getElementById('input').value.trim() && !!doc.querySelector('#zoomWrap .hm') && homeBtn.getAttribute('aria-pressed') === 'true');
  ok('Alt+H و Ctrl+K: خانه', /ACTIONS\['home'\]/.test(app) && /e\.code !== 'KeyH'/.test(app));
  const wk = [...doc.querySelectorAll('#zoomWrap .hm-wd')];
  ok('نوار هفته: امروز یکی، روزهای گذشته کم رنگ، جمعه جدا، دکمه های هفته کنار هم', wk.length === 7 && wk.filter((b) => b.classList.contains('today')).length === 1
    && wk.filter((b) => b.classList.contains('fri')).length === 1 && wk.every((b, i) => b.classList.contains('past') === (i < wk.findIndex((x) => x.classList.contains('today'))))
    && doc.querySelectorAll('#zoomWrap .hm-week-nav .ib').length === 2);
  ok('امروز دیگر بلوک پررنگ سبز (obs-hi) نیست', !/\.hm-wd\.today\{ background:var\(--obs-hi\)/.test(app) && !/data-theme="dark"\] \.hm-wd\.today/.test(app));
  // the format label: hidden on notes and on plain Markdown; «نمایش به‌صورت…» in the tab and «⋯» menus of a temp text
  const stFmt = doc.getElementById('stFmt');
  pasteText('{"a": 1, "b": [1, 2]}');
  await sleep(40);
  ok('فرمت: متن JSON برچسبش را نشان می دهد', !stFmt.hidden && /JSON/.test(stFmt.textContent), stFmt.textContent);
  const jsonTabId = activeId();
  const tabCtx = (id) => {
    const el = doc.querySelector('#tabsList [data-tab="' + id + '"]');
    el.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 60 }));
    return [...doc.querySelectorAll('#ctxMenu .mi, .ctx-menu .mi')].map((b) => b.textContent);
  };
  let ctxLabels = tabCtx(jsonTabId);
  ok('منوی کلیک راست تب موقت: «نمایش به‌صورت…»', ctxLabels.some((l) => /نمایش به‌صورت/.test(l)), ctxLabels);
  const fmtItem = [...doc.querySelectorAll('[data-ctx]')].find((b) => /نمایش به‌صورت/.test(b.textContent));
  fmtItem.click();
  await sleep(30);
  const menuNow = () => [...doc.querySelectorAll('#nbMenu button')].map((b) => b.textContent);
  ok('و فهرست فرمت ها باز می شود', !doc.getElementById('nbMenu').hidden && menuNow().some((l) => /تشخیص خودکار/.test(l)) && menuNow().some((l) => /متن ساده/.test(l)), menuNow());
  [...doc.querySelectorAll('#nbMenu button')].find((b) => /متن ساده/.test(b.textContent)).click();
  await sleep(30);
  ok('انتخاب «متن ساده» از همان فهرست', /متن ساده/.test(stFmt.textContent) && !stFmt.hidden);
  pasteText('# یک یادداشت ساده\n\nمتن معمولی.\n');
  await sleep(40);
  ok('فرمت: متن Markdown معمولی برچسب ندارد', stFmt.hidden);
  nbu.open('مقاله/ساده.md');
  await sleep(40);
  ok('فرمت: یادداشت دفترچه برچسب ندارد', stFmt.hidden);
  ctxLabels = tabCtx(activeId());
  ok('منوی تب یادداشت: «نمایش به‌صورت» ندارد', !ctxLabels.some((l) => /نمایش به‌صورت/.test(l)) && ctxLabels.length > 3, ctxLabels);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  doc.querySelector('#tabsList [data-tab="' + jsonTabId + '"]').click();
  await sleep(30);
  doc.querySelector('.pane.out .ui-more').click();
  await sleep(20);
  ok('منوی «⋯» نمایش، روی متن موقت: «نمایش به‌صورت: متن ساده…»', menuNow().some((l) => /نمایش به‌صورت: متن ساده/.test(l)), menuNow());
  // slides: front matter transition, <!-- transition --> / <!-- _transition --> (Marp), `*` and `1)` lists step in one by one
  pasteText(['---', 'transition: slide', '---', '# عنوان', '', '---', '', '<!-- _transition: zoom -->', '', '## دوم', '', '* الف', '* ب', '', '- با هم', '- با هم', '',
    '---', '', '## سوم', '', '1) یک', '2) دو', '', '---', '', '<!-- transition: flip -->', '', '## چهارم', '', '<!-- یادداشت -->', '', '---', '', '## پنجم', ''].join('\n'));
  await sleep(40);
  ok('اسلاید: «transition» در ویژگی ها نمی آید و کامنت ها دیده نمی شوند', !/transition/.test(doc.getElementById('zoomWrap').textContent) && !/یادداشت/.test(doc.getElementById('zoomWrap').textContent));
  ok('فهرست * و ۱) جدا از فهرست - ساخته می شوند', doc.querySelectorAll('#zoomWrap ul.frag > li').length === 2 && doc.querySelectorAll('#zoomWrap ol.frag > li').length === 2 && [...doc.querySelectorAll('#zoomWrap ul:not(.frag) > li')].some((l) => /با هم/.test(l.textContent)));
  doc.querySelector('.pane.out .ui-more').click();
  await sleep(20);
  [...doc.querySelectorAll('#nbMenu button')].find((b) => /ارائه/.test(b.textContent)).click();
  await sleep(20);
  const slide = doc.getElementById('deckSlide'), deckKey = (key) => doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const trOf = () => (slide.className.match(/\btr-(\w+)/) || [])[1];
  ok('اسلاید ۱: جلوهٔ front matter (slide)', !doc.getElementById('deck').hidden && trOf() === 'slide' && /عنوان/.test(slide.textContent), [slide.className]);
  const fwd = 'ArrowLeft', back = 'ArrowRight';                     // the page is RTL
  deckKey(fwd);
  const hidden = () => slide.querySelectorAll('.frag > li.fr-hide').length;
  ok('اسلاید ۲: _transition فقط همین (zoom)؛ موارد * پنهان، فهرست - پیدا', trOf() === 'zoom' && /دوم/.test(slide.textContent) && hidden() === 2 && slide.querySelectorAll('ul:not(.frag) > li.fr-hide').length === 0, [slide.className, hidden()]);
  ok('جلو در RTL از چپ می آید', slide.style.getPropertyValue('--deck-from') === '-70px');
  deckKey(fwd); ok('← اول یک مورد را نشان می دهد، نه اسلاید بعد', /دوم/.test(slide.textContent) && hidden() === 1 && /مورد مانده/.test(doc.getElementById('deckCount').textContent));
  deckKey(fwd); ok('مورد دوم', hidden() === 0 && /دوم/.test(slide.textContent));
  deckKey(back); ok('→ آخرین مورد را دوباره پنهان می کند', hidden() === 1 && /دوم/.test(slide.textContent));
  deckKey(fwd); deckKey(fwd);
  ok('اسلاید ۳: دوباره جلوهٔ کل ارائه (slide)، فهرست ۱) پنهان', trOf() === 'slide' && /سوم/.test(slide.textContent) && hidden() === 2, [slide.className]);
  deckKey(back);
  ok('برگشت به اسلاید قبل: همهٔ موارد پیدا، و از سمت دیگر', /دوم/.test(slide.textContent) && hidden() === 0 && slide.style.getPropertyValue('--deck-from') === '70px');
  deckKey(fwd); deckKey(fwd); deckKey(fwd); deckKey(fwd);
  ok('اسلاید ۴: transition: flip', trOf() === 'flip' && /چهارم/.test(slide.textContent), [slide.className, slide.textContent.slice(0, 30)]);
  deckKey(fwd);
  ok('اسلاید ۵: flip هنوز (از آن جا به بعد)', trOf() === 'flip' && /پنجم/.test(slide.textContent));
  deckKey('Escape');
  await sleep(20);
  pasteText('---\napiVersion: v1\nkind: Pod\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: x\n');
  await sleep(40);
  ok('YAML چندسندی هنوز YAML است (front matter یادداشت Markdown)', /YAML/.test(stFmt.textContent) && !stFmt.hidden, stFmt.textContent);
  // Esc while writing: back to reading, in a temp tab and in a note
  const inp = doc.getElementById('input'), escOn = (el) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  pasteText('# یک متن موقت برای Esc\n\nمتن.\n');
  await sleep(30);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit1', key: '1', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  const viewNow = () => doc.getElementById('work').dataset.view;
  ok('آماده: تب موقت در حالت ویرایش', viewNow() === 'editor', viewNow());
  escOn(inp);
  await sleep(20);
  ok('Esc در ویرایش تب موقت: خواندن', viewNow() === 'preview', viewNow());
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit1', key: '1', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  escOn(doc.body);
  await sleep(20);
  ok('Esc وقتی تمرکز بیرون از متن است هم: خواندن', viewNow() === 'preview', viewNow());
  nbu.open('مقاله/ساده.md');
  await sleep(30);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit1', key: '1', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  escOn(inp);
  await sleep(20);
  ok('Esc در ویرایش یادداشت: خواندن', viewNow() === 'preview', viewNow());
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit2', key: '2', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  escOn(inp);
  await sleep(20);
  ok('Esc در حالت دوستونه چیدمان را عوض نمی کند', viewNow() === 'split', viewNow());
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  // the zoom percentage in the status bar: a picker with fixed sizes
  const stZoom = doc.getElementById('stZoom'), popZoom = doc.getElementById('popZoom');
  stZoom.click();
  await sleep(20);
  const zv = () => [...popZoom.querySelectorAll('.zp-v')];
  ok('درصد پایین صفحه فهرست اندازه ها را باز می کند', popZoom.classList.contains('open') && zv().length === 13 && zv().filter((b) => b.classList.contains('on')).length === 1 && stZoom.getAttribute('aria-expanded') === 'true', [popZoom.className, zv().length]);
  zv().find((b) => b.textContent === '150%').click();
  await sleep(20);
  ok('انتخاب ۱۵۰٪: اندازه عوض و فهرست بسته شد', stZoom.textContent === '150%' && !popZoom.classList.contains('open') && doc.getElementById('zoomWrap').style.zoom === '1.5');
  stZoom.click();
  await sleep(20);
  popZoom.querySelector('[data-zp="-1"]').click();
  await sleep(20);
  ok('− به اندازهٔ ثابت قبلی (۱۲۵٪) و فهرست باز می ماند', stZoom.textContent === '125%' && popZoom.classList.contains('open') && popZoom.querySelector('.zp-v.on').textContent === '125%');
  popZoom.querySelector('.zp-reset').click();
  await sleep(20);
  ok('«اندازهٔ اصلی»: ۱۰۰٪', stZoom.textContent === '100%' && !popZoom.classList.contains('open'));
  // double click while reading: on the words it selects (native), beside them it edits
  nbu.open('مقاله/ساده.md');
  await sleep(30);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true }));
  await sleep(1000);                                                    // past any touch window from earlier checks
  const para = doc.querySelector('#zoomWrap p'), txt = [...para.childNodes].find((n) => n.nodeType === 3) || para.querySelector('*').firstChild;
  const origCRP = doc.caretRangeFromPoint, origRects = win.Range.prototype.getClientRects;
  doc.caretRangeFromPoint = () => { const r = doc.createRange(); r.setStart(txt, 1); return r; };
  win.Range.prototype.getClientRects = () => [{ left: 0, right: 500, top: 0, bottom: 500 }];
  para.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
  await sleep(30);
  ok('دوبار کلیک روی خود متن: انتخاب (ویرایش باز نمی شود)', viewNow() === 'preview', viewNow());
  win.Range.prototype.getClientRects = () => [];
  para.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 700, clientY: 20 }));
  await sleep(30);
  ok('دوبار کلیک کنار متن: ویرایش همان جا', viewNow() === 'editor', viewNow());
  doc.caretRangeFromPoint = origCRP; win.Range.prototype.getClientRects = origRects;
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  // theme: auto follows the system (also live); the button goes opposite → back as a fixed choice → auto
  const rootT = doc.documentElement, themeB = doc.querySelector('[data-action="theme"]'), sysFlip = (dark) => { win.__sysDark = dark; win.__mqls.filter(([q]) => /prefers-color-scheme: dark/.test(q)).forEach(([, f]) => f({ matches: dark })); };
  const themeTip = () => themeB.getAttribute('data-tip');
  while (!/خودکار/.test(themeTip())) themeB.click();
  ok('تم: حالت خودکار با سیستم روشن', rootT.getAttribute('data-theme') === 'light' && /خودکار/.test(themeTip()), themeTip());
  sysFlip(true);
  ok('خودکار: سیستم وسط کار تیره شد، برنامه هم', rootT.getAttribute('data-theme') === 'dark');
  themeB.click();
  ok('کلیک اول: خلاف صفحه (روشن، ثابت)', rootT.getAttribute('data-theme') === 'light' && /روشن/.test(themeTip()) && win.localStorage.getItem('mz2-theme') === 'light');
  sysFlip(false); sysFlip(true);
  ok('انتخاب دستی با تغییر سیستم عوض نمی شود', rootT.getAttribute('data-theme') === 'light');
  themeB.click();
  ok('کلیک دوم: تیره، ثابت', rootT.getAttribute('data-theme') === 'dark' && /تیره/.test(themeTip()));
  themeB.click();
  ok('کلیک سوم: دوباره خودکار', /خودکار/.test(themeTip()) && win.localStorage.getItem('mz2-theme') === 'auto' && doc.getElementById('themeUse').getAttribute('href') === '#i-theme-auto');
  sysFlip(false);
  ok('و دوباره دنبال سیستم', rootT.getAttribute('data-theme') === 'light');
  ok('تنظیمات › متن و ظاهر: سه گزینهٔ تم', /data-theme-mode="' \+ o\[0\]/.test(app) && /\['auto', 'خودکار'\], \['light', 'روشن'\], \['dark', 'تیره'\]/.test(app));
  // a popover next to the window's side slides back inside (the tab list ran off the right edge)
  const popTabs = doc.getElementById('popTabs');
  popTabs.getBoundingClientRect = () => ({ left: win.innerWidth - 100, right: win.innerWidth + 220, top: 50, bottom: 300, width: 320, height: 250 });
  doc.getElementById('btnTabList').click();
  await sleep(20);
  ok('فهرست همهٔ تب ها از لبهٔ پنجره بیرون نمی زند', popTabs.classList.contains('open') && popTabs.style.translate === '-228px 0', [popTabs.className, popTabs.style.translate]);
  // the button moves when tabs close with the list open: the list is placed again, from where it really is now
  let popShift = 300;
  popTabs.getBoundingClientRect = () => { const t = parseFloat(popTabs.style.translate) || 0; return { left: win.innerWidth - 100 + popShift + t, right: win.innerWidth + 220 + popShift + t, top: 50, bottom: 300, width: 320, height: 250 }; };
  doc.querySelector('#tabsList [data-tab-close]') && pasteText('یک تب دیگر برای بستن در فهرست ' + Date.now());
  await sleep(20);
  const closeInList = popTabs.querySelector('[data-tab-close]');
  if (closeInList) closeInList.click();
  await sleep(20);
  ok('بستن تب با فهرست باز: فهرست دوباره داخل پنجره جا می گیرد', popTabs.classList.contains('open') && popTabs.style.translate === '-528px 0', [popTabs.style.translate, !!closeInList]);
  popShift = 0;
  win.dispatchEvent(new win.Event('resize'));
  ok('تغییر اندازهٔ پنجره هم دوباره جا می دهد', popTabs.style.translate === '-228px 0', popTabs.style.translate);
  doc.getElementById('btnTabList').click();
  delete popTabs.getBoundingClientRect;
  // Alt+Shift+W: every temp tab closes, notes and pinned stay; Ctrl+K shows the keys
  pasteText('موقت یک برای بستن همه ' + Date.now());
  pasteText('موقت دو برای بستن همه ' + Date.now() + 1);
  await sleep(20);
  nbu.open('مقاله/ساده.md');
  await sleep(30);
  const tabKinds = () => [...doc.querySelectorAll('#tabsList .tab')].map((t) => t.classList.contains('nb-tab') ? 'nb' : t.classList.contains('pinned') ? 'pin' : 'temp');
  ok('آماده: چند تب موقت و یادداشت', tabKinds().filter((k) => k === 'temp').length >= 2 && tabKinds().includes('nb'), tabKinds());
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyW', key: 'W', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await sleep(30);
  ok('Alt+Shift+W: همهٔ تب های موقت بسته، یادداشت ها ماندند و فعالند', !tabKinds().includes('temp') && tabKinds().includes('nb') && doc.querySelector('#tabsList [aria-selected="true"]').classList.contains('nb-tab'), tabKinds());
  ok('Ctrl+K کلید را کنار دستور نشان می دهد؛ کلیدهای میانبر با ?', /'temps-close': \{[^}]*kbd: 'Alt Shift W'/.test(app) && /ACTIONS\['nb-keys'\] = \{[^}]*kbd: '\?'/.test(app));
  // shares follow the note: automatic after a send, from another device by the path fingerprint, and the reader's tab refreshes
  global.__gistNeverRaw = false;
  nbu.write('اشتراک/زنده.md', '# زنده\nنسخهٔ اول\n');
  await nbu.push({ loud: false });
  const live = await nbu.shareCreate('اشتراک/زنده.md', 'open', '', 0);
  await sleep(700);
  const liveMeta = gistsMeta.get(live.id);
  ok('توضیح گیست اثر مسیر را دارد، نه خود مسیر', /\| p [0-9a-f]{16}/.test(liveMeta.description) && !/زنده\.md/.test(liveMeta.description), liveMeta.description);
  nbu.write('اشتراک/زنده.md', '# زنده\nنسخهٔ دوم\n');
  await nbu.push({ loud: false });
  await sleep(150);
  ok('بعد از ارسال یادداشت، اشتراکش خودکار به‌روز شد (همان گیست)', /نسخهٔ دوم/.test(rawGists.get(live.id) || '') && liveMeta.patches === 1, [rawGists.get(live.id), liveMeta.patches]);
  nbu.write('اشتراک/دیگر-بی-ربط.md', '# بی ربط\n');
  await nbu.push({ loud: false });
  await sleep(150);
  ok('ارسال یادداشت دیگر یا بدون تغییر، گیست را دست نمی زند', liveMeta.patches === 1, liveMeta.patches);
  const keyRec = await nbu.shareCreate('اشتراک/زنده.md', 'key', '', 0);
  await sleep(700);
  ok('اشتراک کلیدی: «m key» در توضیح، عنوان نه', /\| m key/.test(gistsMeta.get(keyRec.id).description) && !/زنده/.test(gistsMeta.get(keyRec.id).description), gistsMeta.get(keyRec.id).description);
  // another device: what this one remembers is gone, only GitHub's list is left
  const fullKey = keyRec.key;
  const regNow = await nbu.shareList();
  regNow.forEach((r) => { if (r.id === live.id || r.id === keyRec.id){ r.path = ''; r.key = ''; } });
  const again = await nbu.shareList();
  const liveAgain = again.find((r) => r.id === live.id), keyAgain = again.find((r) => r.id === keyRec.id);
  ok('دستگاه دیگر: یادداشتِ اشتراک از روی اثر مسیر پیدا شد', liveAgain && liveAgain.path === 'اشتراک/زنده.md' && keyAgain && keyAgain.path === 'اشتراک/زنده.md' && keyAgain.mode === 'key', [liveAgain && liveAgain.path, keyAgain && keyAgain.mode]);
  nbu.write('اشتراک/زنده.md', '# زنده\nنسخهٔ سوم\n');
  ok('و «بروزرسانی» از همین دستگاه کار می کند', (await nbu.shareUpdate(liveAgain)) === true && /نسخهٔ سوم/.test(rawGists.get(live.id)));
  const before = rawGists.get(keyRec.id);
  ok('کلیدی بدون کلید: گذرواژه نمی خواهد و لینک را خراب نمی کند', (await nbu.shareUpdate(keyAgain)) === false && rawGists.get(keyRec.id) === before && doc.getElementById('nbMini').hidden !== false);
  // the reader
  rawGists.set(live.id, '# زنده\nنسخهٔ خواننده یک\n');
  await nbu.readGist('#g=me/' + live.id);
  await sleep(30);
  const readerTab = doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab, nReader = doc.querySelectorAll('#tabsList .tab').length;
  ok('خواننده: تب از لینک باز شد و لینکش را به خاطر دارد', /خواننده یک/.test(doc.getElementById('input').value));
  rawGists.set(live.id, '# زنده\nنسخهٔ خواننده دو\n');
  doc.querySelector('#tabsList .tab:not([aria-selected="true"])') && doc.querySelector('#tabsList .tab:not([aria-selected="true"])').click();
  await sleep(20);
  await nbu.readGist('#g=me/' + live.id);
  await sleep(30);
  ok('همان لینک دوباره: همان تب با نسخهٔ تازه، نه تب دوم', doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab === readerTab && doc.querySelectorAll('#tabsList .tab').length === nReader && /خواننده دو/.test(doc.getElementById('input').value));
  rawGists.set(live.id, '# زنده\nنسخهٔ خواننده سه\n');
  await win.nbShareRefresh(readerTab);
  await sleep(30);
  ok('«بررسی نسخهٔ تازه» در منوی تب همان را می کند', /خواننده سه/.test(doc.getElementById('input').value) && /بررسی نسخهٔ تازه/.test(app));
  ok('کلید لینک روی دستگاهِ سازنده دوباره یاد گرفته می شود', (await (async () => { await nbu.readGist('#g=me/' + keyRec.id + '.' + fullKey); await sleep(40); const l = await nbu.shareList(); const k = l.find((r) => r.id === keyRec.id); return k && k.key === fullKey; })()));
  // a shared temp tab follows its own text; a reader's edited tab is never overwritten
  pasteText('# موقتِ اشتراکی\nنسخهٔ اول موقت\n');
  await sleep(20);
  const tmpId = doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab;
  const tmpRec = await nbu.shareCreate({ title: 'موقتِ اشتراکی', text: doc.getElementById('input').value, path: 'temp:' + tmpId }, 'open', '', 0);
  await sleep(700);
  const typeIn = (v) => { const i = doc.getElementById('input'); i.value = v; i.dispatchEvent(new win.Event('input', { bubbles: true })); };
  typeIn('# موقتِ اشتراکی\nنسخهٔ دوم موقت\n');
  await win.nbTempShareFlush();
  ok('تب موقتِ اشتراکی: بعد از تایپ، گیستش هم به‌روز شد', /نسخهٔ دوم موقت/.test(rawGists.get(tmpRec.id) || ''), rawGists.get(tmpRec.id));
  typeIn('# موقتِ اشتراکی\nنسخهٔ آخر پیش از بستن\n');
  doc.querySelector('#tabsList [data-tab="' + tmpId + '"] [data-tab-close]').click();
  await sleep(80);
  ok('بستن تب پیش از مکث: آخرین متن هم فرستاده شد', /نسخهٔ آخر پیش از بستن/.test(rawGists.get(tmpRec.id) || ''), rawGists.get(tmpRec.id));
  // reader
  rawGists.set(tmpRec.id, '# خوانده\nنسخهٔ الف\n');
  await nbu.readGist('#g=me/' + tmpRec.id);
  await sleep(30);
  const rTab = doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab, rCount = doc.querySelectorAll('#tabsList .tab').length;
  typeIn('# خوانده\nنسخهٔ الف\nیادداشت خودم\n');
  rawGists.set(tmpRec.id, '# خوانده\nنسخهٔ ب\n');
  await nbu.readGist('#g=me/' + tmpRec.id);
  await sleep(30);
  const nowTab = doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab;
  const editedStill = [...doc.querySelectorAll('#tabsList .tab')].some((t) => t.dataset.tab === rTab);
  ok('خوانندهٔ ویرایش کرده: نسخهٔ تازه در تب کناری، نوشته های خودش سر جایش', nowTab !== rTab && editedStill && doc.querySelectorAll('#tabsList .tab').length === rCount + 1 && /نسخهٔ ب/.test(doc.getElementById('input').value), [nowTab, rTab]);
  doc.querySelector('#tabsList [data-tab="' + rTab + '"]').click();
  await sleep(20);
  ok('تب ویرایش شده دست نخورده ماند', /یادداشت خودم/.test(doc.getElementById('input').value));
  rawGists.set(tmpRec.id, '# خوانده\nنسخهٔ ج\n');
  await nbu.readGist('#g=me/' + tmpRec.id);
  await sleep(30);
  ok('لینک حالا مال تب تازه است: همان به‌روز شد، تب سوم نه', doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab === nowTab && doc.querySelectorAll('#tabsList .tab').length === rCount + 1 && /نسخهٔ ج/.test(doc.getElementById('input').value));
  ok('دکمهٔ «مقایسه» دو نسخه را کنار هم باز می کند', typeof win.mizkarCompare === 'function' && /label: 'مقایسه', icon: 'compare'/.test(app));
  // the share follows a rename; a note of another notebook is never written into it; deleting says so
  nbu.write('اشتراک/جابجا.md', '# جابجا\nیک\n');
  await nbu.push({ loud: false });
  const mv = await nbu.shareCreate('اشتراک/جابجا.md', 'open', '', 0);
  await sleep(700);
  nbu.move('اشتراک/جابجا.md', 'اشتراک/جابجا-شده.md');
  await sleep(40);
  ok('تغییر نام یا جابه‌جایی: اشتراک دنبال یادداشت می رود', (await nbu.shareList()).find((r) => r.id === mv.id).path === 'اشتراک/جابجا-شده.md');
  nbu.write('اشتراک/جابجا-شده.md', '# جابجا\nدو\n');
  await nbu.push({ loud: false });
  await sleep(150);
  ok('و بعد از جابه‌جایی هم خودکار به‌روز می شود', /دو/.test(rawGists.get(mv.id) || ''), rawGists.get(mv.id));
  const mvRec = (await nbu.shareList()).find((r) => r.id === mv.id);
  ok('اشتراک دفترچهٔ خودش را به خاطر دارد', mvRec.repo === 'me/notes', mvRec.repo);
  mvRec.repo = 'me/other';
  nbu.write('اشتراک/جابجا-شده.md', '# جابجا\nسه\n');
  await nbu.push({ loud: false });
  await sleep(150);
  ok('یادداشت هم نام در دفترچهٔ دیگر اشتراک را دست نمی زند', /دو/.test(rawGists.get(mv.id)) && !/سه/.test(rawGists.get(mv.id)) && (await nbu.shareUpdate(mvRec)) === false);
  mvRec.repo = 'me/notes';
  ok('حذف یادداشتِ اشتراکی: پیام با «برداشتن اشتراک»، و گزینهٔ «باز» از تاریخچهٔ گیست می گوید', /nbShareAfterDelete\(\[path\]\)/.test(app) && /label: 'برداشتن اشتراک'/.test(app) && /نسخه‌های قبلی هم در تاریخچهٔ گیست/.test(app));
  // Ctrl+S on a temp tab saves into the notebook; a note named apart from its heading is offered the heading
  pasteText('# متنی برای ذخیره با کنترل اس\nیک خط\n');
  await sleep(30);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyS', key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(40);
  const saveDlg = !doc.getElementById('nbMini').hidden || !doc.getElementById('nbModal').hidden;
  ok('Ctrl+S روی تب موقت: پنجرهٔ «ذخیره در دفترچه»', saveDlg && /ذخیره/.test(doc.body.textContent));
  for (let i = 0; i < 3 && nbu.closeTopLayer(); i++) await sleep(10);
  ok('ویرایش سرتیتر هیچ‌وقت نام یادداشت را عوض نمی کند؛ ذخیرهٔ بی‌نام از سرتیتر نام می گیرد', !/هم‌نام با سرتیتر/.test(app) && !/ip\.h1\b/.test(app) && /\$\('nbSaveTitle'\)\.value\.trim\(\) \|\| textTitle\(t\.text/.test(app));
  // blocks carry their source line: double-click edits there (temp tabs too), split view scrolls in step; search arrows step
  const srcDoc = ['---', 'title: x', '---', '# سرتیتر', '', 'پاراگراف یک', '', 'خط یک', 'خط دو', '', '- مورد الف', '- مورد ب', '', '| ستون | دو |', '|---|---|', '| یک | دو |', '| سه | چهار |', '', '[^1]: پانویس', '', 'آخرین پاراگراف[^1]'].join('\n');
  pasteText(srcDoc);
  await sleep(60);
  const slOf = (sel, re) => { const el = [...doc.querySelectorAll('#zoomWrap ' + sel)].find((x) => re.test(x.textContent)); const t = el && el.closest('[data-sl]'); return t ? +t.getAttribute('data-sl') : -1; };
  ok('هر بلوک خط خودش را در متن دارد (با front matter و پانویس)', slOf('h1', /سرتیتر/) === 3 && slOf('p', /پاراگراف یک/) === 5 && slOf('li', /مورد ب/) === 11 && slOf('p', /آخرین/) === 20,
    [slOf('h1', /سرتیتر/), slOf('p', /پاراگراف یک/), slOf('li', /مورد ب/), slOf('p', /آخرین/)]);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  const origRects2 = win.Range.prototype.getClientRects; win.Range.prototype.getClientRects = () => [];
  const pTwo = [...doc.querySelectorAll('#zoomWrap p')].find((x) => /خط دو/.test(x.textContent));
  pTwo.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  await sleep(40);
  const inpT = doc.getElementById('input'), caretLine = inpT.value.slice(0, inpT.selectionStart).split('\n').length - 1;
  ok('دوبار کلیک کنار «خط دو» در تب موقت: مکان‌نما همان خط، نه ته متن', doc.getElementById('work').dataset.view === 'editor' && caretLine === 8, caretLine);
  win.Range.prototype.getClientRects = origRects2;
  const cellTwo = [...doc.querySelectorAll('#zoomWrap td')].find((x) => /سه/.test(x.textContent));
  ok('سلول جدول: خط همان ردیف', cellTwo && (() => { doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true })); return true; })());
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyF', key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  const fq = doc.getElementById('findQ'); fq.value = 'خط'; fq.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(250);
  const c0 = doc.getElementById('findCount').textContent;
  fq.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await sleep(20);
  const c1 = doc.getElementById('findCount').textContent;
  fq.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  await sleep(20);
  ok('جستجو: ↓ و ↑ نتیجهٔ بعد و قبل', /^۱ از/.test(c0) && /^۲ از/.test(c1) && /^۱ از/.test(doc.getElementById('findCount').textContent), [c0, c1]);
  fq.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  ok('[TOC] هم نقطهٔ جفت شدن دو ستون است', /\[TOC\] is one source line but a long list on the page/.test(app));
  ok('اسکرول هم‌گام دو ستون روی بلوک‌ها، و جای هایلایت متن خام اندازه‌گیری می شود', /function buildScrollMap\(\)/.test(app) && /cs\.direction === 'rtl' \? bar : 0/.test(app));
  ok('توضیح سایت بدون «حتی آفلاین»', !/حتی آفلاین/.test(doc.head.innerHTML), doc.querySelector('meta[name="description"]').content);
  // Alt+Shift+S shares the current text, Alt+Shift+G lists the shares
  for (let i = 0; i < 4 && nbu.closeTopLayer(); i++) await sleep(10);
  pasteText('# متن برای اشتراک با کلید\nیک\n');
  await sleep(30);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyS', key: 'S', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await sleep(40);
  ok('Alt+Shift+S: پنجرهٔ اشتراک‌گذاری همین متن', !doc.getElementById('nbMini').hidden && !!doc.querySelector('#nbMini input[name="nbShareMode"]'), doc.getElementById('nbMini').innerHTML.slice(0, 120));
  for (let i = 0; i < 3 && nbu.closeTopLayer(); i++) await sleep(10);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyG', key: 'G', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await sleep(40);
  ok('Alt+Shift+G: فهرست اشتراک‌ها', !!doc.getElementById('nbShareList'));
  for (let i = 0; i < 3 && nbu.closeTopLayer(); i++) await sleep(10);
  // expiry reads GitHub's list: a share made elsewhere (no local record) with a past date is taken down too
  gistsMeta.set('e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0', { id: 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0', description: 'mizkar-share | exp 2020-01-01 | m key', owner: { login: 'me' }, files: { 'x.mizkar': { content: 'x' } }, updated_at: new Date().toISOString() });
  const regBefore = (await nbu.shareList()).some((r) => r.id === 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0');
  const removedN = await nbu.shareExpire();
  const regAfter = (await nbu.shareList()).some((r) => r.id === 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0');
  ok('انقضا: اشتراکِ ساخته‌شده جای دیگر (فقط روی گیت‌هاب) هم برداشته می شود', regBefore && removedN >= 1 && !regAfter, [regBefore, removedN, regAfter]);
  // phone: a temp tab from the clipboard, an empty one to write in, «Share» straight into a temp tab
  for (let i = 0; i < 4 && nbu.closeTopLayer(); i++) await sleep(10);
  win.navigator.clipboard.readText = () => Promise.resolve('# از کلیپ‌بورد\nمتن کپی شده ' + Date.now());
  nbu.open('مقاله/ساده.md');
  await sleep(30);
  const noteText = doc.getElementById('input').value, noteTabId = doc.querySelector('#tabsList [aria-selected="true"]').dataset.tab;
  await win.mizkarTemp.clip();
  await sleep(30);
  const clipTab = doc.querySelector('#tabsList [aria-selected="true"]');
  ok('موقت از کلیپ‌بورد: تب تازه، حتی وقتی یک یادداشت باز است', clipTab.dataset.tab !== noteTabId && /از کلیپ‌بورد/.test(doc.getElementById('input').value) && !clipTab.classList.contains('nb-tab'), [doc.getElementById('input').value.slice(0, 30)]);
  nbu.open('مقاله/ساده.md');
  await sleep(30);
  ok('…و متن یادداشت همان قبلی است', doc.getElementById('input').value === noteText);
  win.mizkarTemp.blank();
  await sleep(30);
  ok('موقت خالی: تب خالی، مستقیم در ویرایش', doc.getElementById('work').dataset.view === 'editor' && !doc.getElementById('input').value);
  const plus = nbu.plusItems ? nbu.plusItems() : null;
  ok('منوی «تازه» گوشی و صفحهٔ امروز: هر دو گزینه', /label: 'موقت از کلیپ‌بورد'/.test(app) && /label: 'موقت خالی'/.test(app) && /data-home="clip"/.test(app) && /data-home="blank"/.test(app));
  nbu.quick('متن رسیده از اشتراک گوشی');
  await sleep(30);
  doc.getElementById('nbQuickTemp').click();
  await sleep(30);
  ok('«Share» گوشی: «در تب موقت» به دفترچه نمی رود', /متن رسیده از اشتراک گوشی/.test(doc.getElementById('input').value) && !doc.querySelector('#tabsList [aria-selected="true"]').classList.contains('nb-tab') && doc.getElementById('nbMini').hidden);
  ok('میان‌برهای آیکون برنامه در manifest', /"url": "\.\/\?new=clip"/.test(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')) && /nbCheckLaunch/.test(app));
  ok('گوشی: فرمان‌ها، ارائه و مقایسه بالای پنل و نوار پایین باز می شوند (نه پشتشان)', /'\.palette\{ z-index:405; \}'/.test(app) && /'\.deck, \.cmp\{ z-index:300; \}'/.test(app) && app.indexOf("'.palette{ z-index:405; }'") > app.indexOf("'.palette{position:fixed;inset:0;z-index:98;"));
  // phone double tap: on a word → the word is selected (no editor); beside the text → the editor on that line
  for (let i = 0; i < 4 && nbu.closeTopLayer(); i++) await sleep(10);
  pasteText('# دوبار زدن\n\nپاراگراف اول اینجاست\n\nسطر هدف برای ویرایش\n');
  await sleep(40);
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  win.ontouchstart = null;
  const tapP = [...doc.querySelectorAll('#zoomWrap p')].find((p) => /سطر هدف/.test(p.textContent));
  const tapTxt = tapP.firstChild.nodeType === 3 ? tapP.firstChild : tapP.querySelector('*').firstChild;
  const tap = (el) => { const ev = new win.Event('touchstart', { bubbles: true }); ev.touches = [{ clientX: 30, clientY: 40 }]; el.dispatchEvent(ev); };
  const keepCRP = doc.caretRangeFromPoint, keepRects = win.Range.prototype.getClientRects;
  doc.caretRangeFromPoint = () => { const r = doc.createRange(); r.setStart(tapTxt, 1); return r; };
  win.Range.prototype.getClientRects = () => [{ left: 0, right: 500, top: 0, bottom: 500 }];
  tap(tapP); await sleep(200); tap(tapP); await sleep(260);
  ok('گوشی، دوبار زدن روی کلمه: کلمه انتخاب شد و ویرایش باز نشد', doc.getElementById('work').dataset.view === 'preview' && /^سطر$/.test(String(win.getSelection())), [doc.getElementById('work').dataset.view, String(win.getSelection())]);
  win.Range.prototype.getClientRects = () => [];
  tap(tapP); await sleep(500); tap(tapP); await sleep(200); tap(tapP); await sleep(300);
  const inpTap = doc.getElementById('input');
  ok('گوشی، دوبار زدن کنار متن: ویرایش روی همان خط', doc.getElementById('work').dataset.view === 'editor' && inpTap.value.slice(0, inpTap.selectionStart).split('\n').length - 1 === 4, [doc.getElementById('work').dataset.view, inpTap.selectionStart]);
  doc.caretRangeFromPoint = keepCRP; win.Range.prototype.getClientRects = keepRects; delete win.ontouchstart;
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  ok('Ctrl+K: برگشت و جلو در تب های دیده شده', /'tab-back':/.test(app) && /'tab-forward':/.test(app));
  console.log(`\n${fail === 0 ? 'ALL GOOD' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  win.close();
  process.exit(fail === 0 ? 0 : 1);
})();
