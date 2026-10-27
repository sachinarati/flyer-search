// Node harness: load the vendored PDF.js, parse the real flyer PDF,
// run pdf-extract.js logic, and write a report to _extract_report.txt.
// This validates the in-browser extractor against the known PDF.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');     // Store Kiro
const appv2 = __dirname;                         // app-v2
const out = [];
const L = s => out.push(String(s));

// --- minimal browser-ish globals for pdf.min.js ---
const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.navigator = { userAgent: 'node' };
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.queueMicrotask = queueMicrotask;
sandbox.Promise = Promise;
sandbox.URL = URL;
sandbox.atob = s => Buffer.from(s, 'base64').toString('binary');
sandbox.btoa = s => Buffer.from(s, 'binary').toString('base64');
function stubNode(){ const n={ style:{}, children:[], setAttribute(){}, appendChild(c){this.children.push(c);return c;}, append(){}, remove(){}, addEventListener(){}, removeEventListener(){}, getContext(){return null;} }; return n; }
sandbox.document = {
  currentScript: { src: '' },
  createElement: () => stubNode(),
  documentElement: stubNode(),
  head: stubNode(), body: stubNode(),
  getElementsByTagName: () => [stubNode()],
  addEventListener(){}, removeEventListener(){}
};
if (typeof MessageChannel !== 'undefined') sandbox.MessageChannel = MessageChannel;
if (typeof Worker !== 'undefined') sandbox.Worker = Worker;
if (typeof structuredClone !== 'undefined') sandbox.structuredClone = structuredClone;
else sandbox.structuredClone = (o) => JSON.parse(JSON.stringify(o));
sandbox.TextDecoder = TextDecoder;
sandbox.TextEncoder = TextEncoder;
sandbox.Uint8Array = Uint8Array; sandbox.Uint16Array = Uint16Array; sandbox.Uint32Array = Uint32Array;
sandbox.ArrayBuffer = ArrayBuffer; sandbox.Int8Array = Int8Array; sandbox.Float32Array = Float32Array; sandbox.Float64Array = Float64Array;
sandbox.DataView = DataView;
if (typeof ReadableStream !== 'undefined') sandbox.ReadableStream = ReadableStream;
if (typeof WritableStream !== 'undefined') sandbox.WritableStream = WritableStream;
if (typeof TransformStream !== 'undefined') sandbox.TransformStream = TransformStream;
if (typeof queueMicrotask !== 'undefined') sandbox.queueMicrotask = queueMicrotask;
vm.createContext(sandbox);

function run(file) {
  const code = fs.readFileSync(path.join(appv2, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

(async () => {
  try {
    run('vendor/pdf.min.js');
    const pdfjsLib = sandbox.pdfjsLib || sandbox.window.pdfjsLib;
    if (!pdfjsLib) { L('ERROR: pdfjsLib not found after loading pdf.min.js'); return finish(); }
    L('pdf.min.js loaded; version=' + (pdfjsLib.version || '?'));
    // Load the worker build into the SAME context so PDF.js can use the
    // in-context worker (window.pdfjsWorker) instead of a real/fake worker.
    run('vendor/pdf.worker.min.js');
    L('worker in-context: ' + (sandbox.pdfjsWorker ? 'yes' : 'no'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    // load recipes/icons/extractor into the same sandbox
    run('recipes.js'); run('icons.js'); run('pdf-extract.js');
    const FlyerPDF = sandbox.FlyerPDF;
    if (!FlyerPDF) { L('ERROR: FlyerPDF missing'); return finish(); }

    // pick the known PDF
    const pdfName = 'チラシ全店版　テキスト版.pdf';
    const pdfPath = path.join(root, pdfName);
    if (!fs.existsSync(pdfPath)) { L('ERROR: PDF not found at ' + pdfPath); return finish(); }
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    L('PDF bytes=' + data.length);

    // extract uses the browser worker path './vendor/...'; disable worker to run in Node
    const origGetDocument = pdfjsLib.getDocument.bind(pdfjsLib);
    pdfjsLib.getDocument = (opts) => origGetDocument(Object.assign({ disableWorker: true, isEvalSupported: false }, opts));

    const result = await FlyerPDF.extract(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), (c, t) => {}, pdfName);
    const p = result.products;
    L('pages=' + result.pages + ' rawRows=' + result.rawRowCount + ' products=' + p.length);

    // department breakdown
    const byDept = {};
    p.forEach(x => byDept[x.department] = (byDept[x.department] || 0) + 1);
    L('-- departments --');
    Object.keys(byDept).sort((a, b) => byDept[b] - byDept[a]).forEach(k => L('  ' + k + ' = ' + byDept[k]));

    const withPrice = p.filter(x => x.price != null).length;
    const le300 = p.filter(x => x.price != null && x.price <= 300).length;
    const warn = p.filter(x => x.date_warning).length;
    L('with price=' + withPrice + ' / <=300=' + le300 + ' / date_warning=' + warn);

    L('-- first 8 --');
    p.slice(0, 8).forEach(x => L('  ' + x.id + ' [' + x.department + '] ' + x.name + ' | ' + x.price + '/' + x.tax_price + ' | ' + x.spec + ' | ' + x.from_date + '-' + x.to_date + ' | ' + x.manufacturer));
    L('-- last 5 --');
    p.slice(-5).forEach(x => L('  ' + x.id + ' [' + x.department + '] ' + x.name + ' | ' + x.price + '/' + x.tax_price));

    // schema check on first record
    const need = ['id','name','department','source_department','department_source','manufacturer','spec','price','tax_price','price_note','from_date','to_date','jan','source_page','date_warning'];
    const miss = need.filter(k => !(k in (p[0] || {})));
    L('schema missing keys: ' + (miss.length ? miss.join(',') : 'NONE'));

    L('EXTRACT TEST DONE');
  } catch (e) {
    L('EXCEPTION: ' + (e && e.stack ? e.stack : e));
  }
  finish();
})();

function finish() {
  fs.writeFileSync(path.join(root, '_extract_report.txt'), out.join('\n'), 'utf8');
  console.log('report written');
}
