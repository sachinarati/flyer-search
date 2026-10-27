/* =============================================================
   pdf-extract.js
   ブラウザ内で「チラシ全店版 テキスト版.pdf」形式のPDFを解析し、
   products.json と同じ構造の商品配列に変換する。

   元の抽出ロジック(extract_pdf_dataset.py / PyMuPDF)を
   PDF.js の getTextContent() 座標で再現したもの。

   列(X座標の範囲):
     department 20-60 / from_date 60-100 / to_date 100-140 /
     jan 140-190 / manufacturer 190-240 / name 240-345 /
     spec 345-400 / price 400-450 / tax 450-500 / remarks 500-600
   行アンカー: from_date 列(x 60-100)に 20###### が入る位置。

   使い方:
     const result = await FlyerPDF.extract(arrayBuffer, onProgress);
     // result = { products:[...], meta:{...}, pages:N }
   ============================================================= */
(function () {
  "use strict";

  // 列定義 [名前, x下限, x上限]
  var COLS = [
    ["department", 20, 60], ["from_date", 60, 100], ["to_date", 100, 140],
    ["jan", 140, 190], ["manufacturer", 190, 240], ["name", 240, 345],
    ["spec", 345, 400], ["price_text", 400, 450], ["tax_text", 450, 500],
    ["remarks", 500, 600]
  ];
  var DATE_RE = /^(20\d{6})$/;

  // Kangxi Radicals (U+2F00–U+2FD5) を通常の漢字へ対応付ける表。
  // このPDFは「⻘果」「⽔産」「精⾁」のように、漢字そっくりだが別コードの
  // 部首文字を使っているため、NFKCだけでは揃わない。ここで正規の漢字に戻す。
  var KANGXI = "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉釆里金長門阜隶隹雨靑非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠";
  // CJK Radicals Supplement (U+2E80–U+2EF3) → 通常漢字。
  // 本チラシに現れる主要字を網羅。例: ⻘(U+2ED8)→青 が重要。
  var CJK_SUP = {
    "\u2ED8":"青",  // ⻘ CJK RADICAL BLUE → 青
    "\u2E85":"人", "\u2E86":"人",
    "\u2E8C":"小",
    "\u2E97":"手",
    "\u2EA6":"水", "\u2EA7":"水",
    "\u2EA9":"爪",
    "\u2EAA":"火",
    "\u2EBB":"肉", "\u2EBC":"肉",
    "\u2EBD":"艸", "\u2EBE":"艸", "\u2EBF":"艸", "\u2EC0":"艸",
    "\u2ECC":"辵", "\u2ECD":"辵",
    "\u2ED4":"食", "\u2ED5":"食", "\u2ED6":"食",
    "\u2EDB":"長",
    "\u2EE4":"頁",
    "\u2EEB":"馬",
    "\u2EF3":"龜"
  };

  // 部首そっくり文字 → 通常漢字
  function foldRadicals(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xFFFF) { out += s[i] + s[i + 1]; i++; continue; }
      if (cp >= 0x2F00 && cp <= 0x2FD5) {          // Kangxi Radicals
        var idx = cp - 0x2F00;
        out += (idx < KANGXI.length) ? KANGXI[idx] : s[i];
      } else if (cp >= 0x2E80 && cp <= 0x2EF3) {   // CJK Radicals Supplement
        out += CJK_SUP[s[i]] || s[i];
      } else {
        out += s[i];
      }
    }
    return out;
  }

  // --- 文字正規化 (Python の nfc 相当 + 部首文字の正規化) ---
  function nfc(text) {
    if (text == null) return "";
    var t = String(text);
    try { t = t.normalize("NFKC"); } catch (e) { /* 古い環境でも継続 */ }
    t = foldRadicals(t);                 // ⻘→青 / ⽔→水 / ⾁→肉 など
    try { t = t.normalize("NFKC"); } catch (e) {}
    t = t.replace(/\u3000/g, " ").replace(/\u00a0/g, " ");
    return t.replace(/\s+/g, " ").trim();
  }

  function normDept(value) {
    var v = nfc(value).replace(/\s+/g, "");
    var map = { "ベーカ": "ベーカリー", "リー": "ベーカリー" };
    return map[v] || v;
  }

  function parseMoneyField(txt) {
    var s = nfc(txt).replace(/,/g, "");
    var m = /^\s*(\d{1,6})\s*$/.exec(s);
    return m ? parseInt(m[1], 10) : null;
  }

  function parsePriceText(text) {
    var t = nfc(text).replace(/,/g, "");
    if (t.indexOf("店頭") !== -1 && t.indexOf("価格") !== -1) return null;
    var m = /(?:各\s*)?(\d{1,6})\s*円/.exec(t);
    return m ? parseInt(m[1], 10) : null;
  }

  // 部門が空のとき、商品名から部門を推定 (Python の cat_guess)
  function catGuess(name) {
    var n = name;
    if (/牛乳|ヨーグルト|チーズ|バター|乳製品|生クリーム/.test(n)) return "洋日配";
    if (/豆腐|納豆|こんにゃく|漬物|キムチ|もずく|しらたき/.test(n)) return "和日配";
    if (/牛肉|豚肉|鶏肉|精肉|肩肉|ロース肉|バラ肉|もも肉|むね肉|ラム/.test(n)) return "精肉";
    if (/刺身|まぐろ|鮭|ほたて|かき|さんま|かつお|ぶり|水産|えび/.test(n)) return "水産";
    if (/野菜|キャベツ|白菜|ねぎ|しめじ|えのき|しいたけ|みかん|柿|りんご|マスカット|栗|果物/.test(n)) return "青果";
    if (/天丼|豚丼|わっぱ飯|コロッケ|惣菜|弁当|だし茶飯/.test(n)) return "デリカ";
    if (/パン|ピザ|ハンバーガー/.test(n)) return "ベーカリー";
    return "加食";
  }

  // --- 1ページ分の文字を集める。PDF.js の items を文字単位に展開して
  //     Python の rawdict(char単位)に近づける ---
  function collectChars(textContent, viewportHeight) {
    var chars = [];
    var items = textContent.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var str = it.str;
      if (!str) continue;
      var tr = it.transform; // [a,b,c,d,e,f] : e=x, f=y(下原点)
      var x0 = tr[4];
      var yTop = viewportHeight - tr[5]; // 上原点に変換(PyMuPDFと向きを合わせる)
      var w = it.width || 0;
      var n = str.length;
      var cw = n > 0 ? (w / n) : 0;
      // 文字ごとに概算X座標を割り当てる(等幅近似)
      for (var k = 0; k < n; k++) {
        var ch = str[k];
        if (ch === " " || ch === "\u3000") continue;
        chars.push({ x: x0 + cw * k, y: Math.round(yTop * 10) / 10, c: ch });
      }
    }
    return chars;
  }

  // Python parse_page のロジック
  function parsePage(chars, pageNumber) {
    // FROM-date 列(60<=x<100)で 20###### を含む y をアンカーとする
    var linesByY = {};
    chars.forEach(function (c) {
      if (c.x >= 60 && c.x < 100) {
        var key = c.y;
        (linesByY[key] = linesByY[key] || []).push(c);
      }
    });
    var anchors = [];
    Object.keys(linesByY).forEach(function (yKey) {
      var cs = linesByY[yKey].slice().sort(function (a, b) { return a.x - b.x; });
      var txt = cs.map(function (c) { return c.c; }).join("");
      if (DATE_RE.test(nfc(txt).replace(/\s+/g, ""))) anchors.push(parseFloat(yKey));
    });
    anchors = Array.from(new Set(anchors)).sort(function (a, b) { return a - b; });

    var rows = [];
    anchors.forEach(function (y) {
      var columns = {};
      COLS.forEach(function (col) {
        var name = col[0], x0 = col[1], x1 = col[2];
        var picked = [];
        for (var i = 0; i < chars.length; i++) {
          var c = chars[i];
          if (!(c.x >= x0 && c.x < x1)) continue;
          // 最も近いアンカーに属する文字だけ採用(折返しセルを同じ行に束ねる)
          var nearest = anchors[0], best = Math.abs(anchors[0] - c.y);
          for (var a = 1; a < anchors.length; a++) {
            var d = Math.abs(anchors[a] - c.y);
            if (d < best) { best = d; nearest = anchors[a]; }
          }
          if (nearest === y && Math.abs(y - c.y) <= 25.0 && c.y >= 28.0) picked.push(c);
        }
        // ベースライン(y)ごとに左→右で連結
        var byBaseline = {};
        picked.forEach(function (c) { (byBaseline[c.y] = byBaseline[c.y] || []).push(c); });
        var chunks = [];
        Object.keys(byBaseline).map(Number).sort(function (a, b) { return a - b; }).forEach(function (yy) {
          var line = byBaseline[yy].slice().sort(function (a, b) { return a.x - b.x; })
            .map(function (c) { return c.c; }).join("");
          chunks.push(line);
        });
        columns[name] = nfc(chunks.join(" "));
      });
      columns.page = pageNumber;
      rows.push(columns);
    });
    return rows;
  }

  // 生の行 -> 商品レコード (Python main のロジック)
  function rowsToProducts(rawRows) {
    var products = [];
    rawRows.forEach(function (r) {
      var name = nfc(r.name);
      if (!name) return;

      // 部門が無く価格も無い → セクション見出しとして除外
      if (!r.department && !(parseMoneyField(r.price_text) || parsePriceText(r.remarks))) return;

      var price = parseMoneyField(r.price_text);
      var tax = parseMoneyField(r.tax_text);
      if (price === null) price = parsePriceText(r.remarks);
      if (tax === null) {
        var m = /\(\s*各?\s*(\d{1,6})\s*円\s*\)/.exec(nfc(r.remarks));
        if (m) tax = parseInt(m[1], 10);
      }

      // 価格情報が全く無い行は(店頭価格表記を除き)除外
      if (price === null && tax === null &&
          !(nfc(r.remarks).indexOf("価格は店頭にて") !== -1 && name.indexOf("開催") === -1)) return;
      if (name.length < 2) return;

      // 販促バナーが名前列に紛れたものを除外
      if (/開催|お値打ち商品多数|均一セール|第三回|グルメマッチ/.test(name) && price === null && tax === null) return;

      // 日本語商品名は空白を使わない慣習に合わせて詰める
      name = name.replace(/\s+/g, "");
      if (name.indexOf("ブルガリアヨーグルト果実の深みブラッドオレンジ&") === 0) {
        name = "ブルガリアヨーグルト果実の深みブラッドオレンジ&フルーツミックス";
      }
      var maker = nfc(r.manufacturer).replace(/\s+/g, "");
      var spec = nfc(r.spec).replace(/\s+/g, "");
      if (name.indexOf("チラシ全店版") === 0 || name.indexOf("テキスト版") === 0) {
        name = name.replace(/^(?:チラシ全店版|テキスト版)/, "");
      }

      var dept = normDept(r.department);
      dept = dept.replace(/https?:\/\/.*$/, "");
      if (/2026\/10\/20|9:29|チラシ全店版|テキスト版/.test(dept)) dept = "";
      if (["20261017", "20261018", "20261019", "20261020", ""].indexOf(dept) !== -1) dept = "";

      var fromM = /20\d{6}/.exec(nfc(r.from_date));
      var toM = /20\d{6}/.exec(nfc(r.to_date));
      var fromDate = fromM ? fromM[0] : "";
      var toDate = toM ? toM[0] : "";

      products.push({
        id: products.length + 1,
        name: name,
        department: dept || catGuess(name),
        source_department: dept,
        department_source: dept ? "pdf" : "inferred",
        manufacturer: maker,
        spec: spec,
        price: price,
        tax_price: tax,
        price_note: nfc(r.remarks),
        from_date: fromDate,
        to_date: toDate,
        jan: nfc(r.jan),
        source_page: r.page,
        date_warning: !!(fromDate && toDate && fromDate > toDate)
      });
    });

    // 重複除去(行高のエッジケースで生じる完全重複のみ)
    var seen = {}, clean = [];
    products.forEach(function (p) {
      var key = [p.name, p.price, p.tax_price, p.from_date, p.to_date].join("|");
      if (seen[key]) return;
      seen[key] = 1;
      p.id = clean.length + 1;
      clean.push(p);
    });
    return clean;
  }

  // --- メイン: ArrayBuffer -> {products, meta, pages} ---
  async function extract(arrayBuffer, onProgress, fileName) {
    if (!window.pdfjsLib) throw new Error("PDF.js が読み込まれていません (vendor/pdf.min.js)。");
    var pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";

    // getDocument は渡したバッファを消費するため、再試行用に複製しておく
    var srcBytes = new Uint8Array(arrayBuffer.byteLength);
    srcBytes.set(new Uint8Array(arrayBuffer));
    var retryBytes = srcBytes.slice();

    var pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: srcBytes }).promise;
    } catch (err) {
      // file:// などで Worker を起動できない場合、メインスレッドで再試行
      try {
        pdf = await pdfjsLib.getDocument({ data: retryBytes, disableWorker: true }).promise;
      } catch (err2) {
        throw new Error("PDFワーカーを起動できませんでした。ローカルサーバー(例: npx serve .)で開くか、対応ブラウザをお試しください。 詳細: " + (err2 && err2.message ? err2.message : err2));
      }
    }
    var numPages = pdf.numPages;
    var rawRows = [];

    for (var pageNo = 1; pageNo <= numPages; pageNo++) {
      if (onProgress) onProgress(pageNo, numPages);
      var page = await pdf.getPage(pageNo);
      var viewport = page.getViewport({ scale: 1.0 });
      var textContent = await page.getTextContent();
      var chars = collectChars(textContent, viewport.height);
      var rows = parsePage(chars, pageNo);
      rawRows = rawRows.concat(rows);
    }

    var products = rowsToProducts(rawRows);
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var meta = {
      source_file: fileName || "uploaded.pdf",
      source_url: "",
      extracted_at: now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate())
    };
    return { products: products, meta: meta, pages: numPages, rawRowCount: rawRows.length };
  }

  window.FlyerPDF = {
    extract: extract,
    // テスト/再利用のため内部関数も公開
    _internal: { nfc: nfc, parsePage: parsePage, rowsToProducts: rowsToProducts, parseMoneyField: parseMoneyField, parsePriceText: parsePriceText, catGuess: catGuess }
  };
})();
