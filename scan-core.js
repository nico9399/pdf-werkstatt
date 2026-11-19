/* PDF Werkstatt – Scanner-Kern: Blatt erkennen, entzerren, wie einen Scan aufhellen.
   Arbeitet nur mit OpenCV-Matrizen und läuft komplett lokal. */
(function (root) {
  'use strict';

  function orderCorners(pts) {
    // Reihenfolge: oben links, oben rechts, unten rechts, unten links
    var bySum = pts.slice().sort(function (a, b) { return (a.x + a.y) - (b.x + b.y); });
    var byDiff = pts.slice().sort(function (a, b) { return (a.y - a.x) - (b.y - b.x); });
    return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
  }

  function polyArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; a += p[i].x * p[j].y - p[j].x * p[i].y; }
    return Math.abs(a) / 2;
  }

  function matToPts(m) {
    var out = [];
    for (var i = 0; i < m.rows; i++) out.push({ x: m.data32S[i * 2], y: m.data32S[i * 2 + 1] });
    return out;
  }

  // Größte viereckige Kontur in einem Binärbild suchen
  function findQuad(cv, bin, minArea) {
    var contours = new cv.MatVector(), hier = new cv.Mat(), best = null, bestArea = 0;
    cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    var list = [];
    for (var i = 0; i < contours.size(); i++) { var c = contours.get(i); list.push({ c: c, a: cv.contourArea(c) }); }
    list.sort(function (a, b) { return b.a - a.a; });
    for (var k = 0; k < Math.min(list.length, 6); k++) {
      var item = list[k];
      if (item.a < minArea) break;
      var peri = cv.arcLength(item.c, true);
      for (var eps = 0.015; eps <= 0.06 && !best; eps += 0.01) {
        var approx = new cv.Mat();
        cv.approxPolyDP(item.c, approx, eps * peri, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          var pts = matToPts(approx), ar = polyArea(pts);
          if (ar > bestArea && ar >= minArea) { best = pts; bestArea = ar; }
        }
        approx.delete();
      }
      if (best) break;
    }
    // Notlösung: kleinstes umschließendes Rechteck der größten Kontur
    if (!best && list.length && list[0].a >= minArea * 1.2) {
      var rr = cv.minAreaRect(list[0].c);
      var pts2 = cv.RotatedRect.points(rr).map(function (p) { return { x: p.x, y: p.y }; });
      best = pts2;
    }
    list.forEach(function (it) { it.c.delete(); });
    contours.delete(); hier.delete();
    return best;
  }

  /** Ecken des Blatts finden. src: RGBA-Mat. Rückgabe: 4 Punkte (Bild-Koordinaten) oder null. */
  function detectCorners(cv, src) {
    var maxSide = 900, s = Math.min(1, maxSide / Math.max(src.cols, src.rows));
    var small = new cv.Mat(), gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat(), bin = new cv.Mat();
    cv.resize(src, small, new cv.Size(Math.round(src.cols * s), Math.round(src.rows * s)), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    var minArea = small.cols * small.rows * 0.12;
    var kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    var quad = null;

    // 1) Kanten
    var tries = [[30, 90], [60, 160], [15, 50]];
    for (var t = 0; t < tries.length && !quad; t++) {
      cv.Canny(blur, edges, tries[t][0], tries[t][1]);
      cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      quad = findQuad(cv, edges, minArea);
    }
    // 2) Helligkeit: Papier ist meist heller als der Untergrund
    if (!quad) {
      cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 3);
      quad = findQuad(cv, bin, minArea);
    }
    small.delete(); gray.delete(); blur.delete(); edges.delete(); bin.delete(); kernel.delete();
    if (!quad) return null;
    var pts = orderCorners(quad.map(function (p) { return { x: p.x / s, y: p.y / s }; }));
    // Leicht nach innen ziehen: die Kantensuche liegt sonst ein paar Pixel außerhalb des Blatts
    var cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4, cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    return pts.map(function (p) { return { x: p.x + (cx - p.x) * 0.012, y: p.y + (cy - p.y) * 0.012 }; });
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /** Blatt gerade ziehen. corners: [TL,TR,BR,BL]. Gibt RGBA-Mat zurück (Aufrufer löscht). */
  function warp(cv, src, corners, maxSide) {
    var c = corners;
    var w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]));
    var h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]));
    var k = Math.min(1, (maxSide || 2400) / Math.max(w, h));
    w = Math.max(10, Math.round(w * k)); h = Math.max(10, Math.round(h * k));
    var from = cv.matFromArray(4, 1, cv.CV_32FC2, [c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y]);
    var to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    var M = cv.getPerspectiveTransform(from, to), out = new cv.Mat();
    cv.warpPerspective(src, out, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    from.delete(); to.delete(); M.delete();
    return out;
  }

  // Hintergrund (Papier inkl. Schatten) schätzen – auf verkleinertem Bild für Tempo
  function background(cv, plane) {
    var s = Math.min(1, 700 / Math.max(plane.cols, plane.rows));
    var small = new cv.Mat(), bg = new cv.Mat();
    cv.resize(plane, small, new cv.Size(Math.max(8, Math.round(plane.cols * s)), Math.max(8, Math.round(plane.rows * s))), 0, 0, cv.INTER_AREA);
    var kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
    cv.dilate(small, small, kernel);           // Schrift „wegwischen“
    cv.medianBlur(small, small, 21);           // glatte Papierfläche
    cv.GaussianBlur(small, small, new cv.Size(0, 0), 6);
    cv.resize(small, bg, new cv.Size(plane.cols, plane.rows), 0, 0, cv.INTER_LINEAR);
    small.delete(); kernel.delete();
    return bg;
  }

  function lut(cv, fn) {
    var arr = new Uint8Array(256);
    for (var i = 0; i < 256; i++) arr[i] = Math.max(0, Math.min(255, Math.round(fn(i))));
    return cv.matFromArray(1, 256, cv.CV_8U, Array.prototype.slice.call(arr));
  }

  // Ebene durch ihren Hintergrund teilen -> Schatten weg, Papier weiß
  function flatten(cv, plane) {
    var bg = background(cv, plane), out = new cv.Mat();
    cv.divide(plane, bg, out, 255);
    bg.delete();
    return out;
  }

  /** Filter anwenden. mode: 'doc' | 'gray' | 'color'. Gibt RGBA-Mat zurück. */
  function enhance(cv, rgba, mode) {
    var out = new cv.Mat();
    if (mode === 'color') {
      var rgb = new cv.Mat(); cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      var planes = new cv.MatVector(); cv.split(rgb, planes);
      var merged = new cv.MatVector(), table = lut(cv, function (v) { return v >= 245 ? 255 : Math.pow(v / 245, 1.25) * 255; });
      for (var i = 0; i < 3; i++) {
        var p = planes.get(i), f = flatten(cv, p), l = new cv.Mat();
        cv.LUT(f, table, l); merged.push_back(l); p.delete(); f.delete(); l.delete();
      }
      var res = new cv.Mat(); cv.merge(merged, res);
      cv.cvtColor(res, out, cv.COLOR_RGB2RGBA);
      rgb.delete(); planes.delete(); merged.delete(); res.delete(); table.delete();
      return out;
    }
    var gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    var flat = flatten(cv, gray), mapped = new cv.Mat(), t2;
    if (mode === 'doc') {
      // Papier rein weiß, Schrift satt schwarz, weicher Übergang gegen Treppchen
      t2 = lut(cv, function (v) { if (v >= 215) return 255; if (v <= 95) return 0; var x = (v - 95) / 120; return Math.pow(x, 1.6) * 255; });
    } else {
      t2 = lut(cv, function (v) { return v >= 240 ? 255 : Math.pow(v / 240, 1.35) * 255; });
    }
    cv.LUT(flat, t2, mapped);
    cv.cvtColor(mapped, out, cv.COLOR_GRAY2RGBA);
    gray.delete(); flat.delete(); mapped.delete(); t2.delete();
    return out;
  }

  /** Mat um 90°-Schritte drehen (im Uhrzeigersinn). */
  function rotate(cv, src, deg) {
    var out = new cv.Mat();
    var d = ((deg % 360) + 360) % 360;
    if (d === 90) cv.rotate(src, out, cv.ROTATE_90_CLOCKWISE);
    else if (d === 180) cv.rotate(src, out, cv.ROTATE_180);
    else if (d === 270) cv.rotate(src, out, cv.ROTATE_90_COUNTERCLOCKWISE);
    else src.copyTo(out);
    return out;
  }

  var api = { detectCorners: detectCorners, warp: warp, enhance: enhance, rotate: rotate, orderCorners: orderCorners };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ScanCore = api;
})(typeof self !== 'undefined' ? self : this);
