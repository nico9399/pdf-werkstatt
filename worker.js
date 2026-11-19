/* PDF Werkstatt – Ghostscript-Worker. Läuft komplett lokal im Browser. */
let gsPromise = null;
let lineHandler = function () {};

// Diese Ghostscript-Version schreibt direkt in console.log/warn -> Ausgabe abfangen (für Fortschritt & Fehler)
console.log = function () { lineHandler(Array.prototype.join.call(arguments, ' ')); };
console.warn = console.error = console.log;

importScripts('gs.js'); // definiert die Fabrikfunktion "Module"

let currentJob = null;
function post(msg, transfer) { msg.job = currentJob; self.postMessage(msg, transfer || []); }

async function loadWasmBytes() {
  const res = await fetch('gs.wasm');
  if (!res.ok) throw new Error('Engine konnte nicht geladen werden (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 16177271;
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    post({ type: 'loading', pct: 100 });
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    post({ type: 'loading', pct: Math.min(99, Math.round((got / total) * 100)) });
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  post({ type: 'loading', pct: 100 });
  return out.buffer;
}

function getGs() {
  if (!gsPromise) {
    gsPromise = loadWasmBytes().then(function (bytes) {
      return Module({
        noInitialRun: true,
        print: function (l) { lineHandler(String(l)); },
        printErr: function (l) { lineHandler(String(l)); },
        instantiateWasm: function (imports, ok) {
          WebAssembly.instantiate(bytes, imports)
            .then(function (r) { ok(r.instance); })
            .catch(function (e) { post({ type: 'error', message: 'Engine-Start fehlgeschlagen: ' + e.message }); });
          return {};
        }
      });
    });
    gsPromise.catch(function () { gsPromise = null; });
  }
  return gsPromise;
}

function buildArgs(o) {
  const dpi = Math.round(o.dpi);
  const qf = Number(o.qf).toFixed(2);
  const sub = '/Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2]';
  const dict = '<< /QFactor ' + qf + ' ' + sub + ' >>';
  const distiller = '<< /ColorACSImageDict ' + dict + ' /GrayACSImageDict ' + dict +
    ' /ColorImageDict ' + dict + ' /GrayImageDict ' + dict + ' >> setdistillerparams';
  const a = [
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-dPDFSETTINGS=' + (dpi >= 250 ? '/printer' : '/ebook'),
    '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true', '-dDownsampleMonoImages=true',
    '-dColorImageDownsampleType=/Bicubic', '-dGrayImageDownsampleType=/Bicubic', '-dMonoImageDownsampleType=/Subsample',
    '-dColorImageResolution=' + dpi, '-dGrayImageResolution=' + dpi, '-dMonoImageResolution=' + Math.min(600, dpi * 2),
    '-dColorImageDownsampleThreshold=1.1', '-dGrayImageDownsampleThreshold=1.1', '-dMonoImageDownsampleThreshold=1.1',
    '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true', '-dEmbedAllFonts=true', '-dCompressPages=true'
  ];
  if (o.gray) {
    a.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray',
      '-dAutoFilterGrayImages=false', '-dGrayImageFilter=/DCTEncode');
  }
  a.push('-sOutputFile=/out.pdf', '-c', distiller, '-f', '/in.pdf');
  return a;
}

// Nur verschlüsseln, Bilder unverändert lassen (JPEGs werden durchgereicht)
function buildEncryptArgs(o) {
  return [
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
    '-dPassThroughJPEGImages=true', '-dPassThroughJPXImages=true',
    '-dAutoFilterColorImages=false', '-dAutoFilterGrayImages=false', '-dColorImageFilter=/FlateEncode', '-dGrayImageFilter=/FlateEncode',
    '-sOwnerPassword=' + o.password, '-sUserPassword=' + o.password,
    '-dEncryptionR=3', '-dKeyLength=128', '-dPermissions=-4',
    '-sOutputFile=/out.pdf', '/in.pdf'
  ];
}

function safeUnlink(FS, p) { try { FS.unlink(p); } catch (e) { /* egal */ } }

self.onmessage = async function (ev) {
  const msg = ev.data || {};
  if (msg.type === 'preload') {
    try { await getGs(); post({ type: 'ready' }); }
    catch (e) { post({ type: 'error', message: e.message || String(e) }); }
    return;
  }
  if (msg.type !== 'compress' && msg.type !== 'encrypt') return;
  currentJob = msg.job || null;

  let gs;
  try { gs = await getGs(); post({ type: 'ready' }); }
  catch (e) { post({ type: 'error', message: e.message || String(e) }); return; }

  const log = [];
  let totalPages = 0;
  lineHandler = function (line) {
    log.push(line);
    if (log.length > 200) log.shift();
    const m = /Processing pages \d+ through (\d+)/.exec(line);
    if (m) { totalPages = Number(m[1]); post({ type: 'progress', page: 0, total: totalPages }); return; }
    const p = /^Page (\d+)/.exec(line);
    if (p) post({ type: 'progress', page: Number(p[1]), total: totalPages });
  };

  const FS = gs.FS;
  safeUnlink(FS, '/in.pdf'); safeUnlink(FS, '/out.pdf');
  let rc = -1;
  try {
    FS.writeFile('/in.pdf', new Uint8Array(msg.data));
    rc = gs.callMain(msg.type === 'encrypt' ? buildEncryptArgs(msg.options) : buildArgs(msg.options));
  } catch (e) {
    rc = (e && typeof e.status === 'number') ? e.status : -1;
    if (rc === -1) gsPromise = null; // Engine abgestürzt -> beim nächsten Mal neu starten
    log.push(String(e && e.message || e));
  }
  safeUnlink(FS, '/in.pdf');

  let out = null;
  try { out = FS.readFile('/out.pdf'); } catch (e) { out = null; }
  safeUnlink(FS, '/out.pdf');

  const text = log.join('\n');
  if (rc !== 0 || !out || out.length < 100 || totalPages === 0) {
    let reason = 'Die Datei konnte nicht verarbeitet werden.';
    if (/password/i.test(text)) reason = 'Die PDF ist mit einem Passwort geschützt. Bitte entferne zuerst den Schutz.';
    else if (totalPages === 0 || /Unrecoverable|undefined in|syntaxerror|not a PDF|No pages/i.test(text)) reason = 'Die PDF scheint beschädigt oder kein gültiges PDF zu sein.';
    post({ type: 'error', message: reason });
    return;
  }
  const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  post({ type: 'done', data: buf, pages: totalPages }, [buf]);
};
