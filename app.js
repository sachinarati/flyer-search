/* =============================================================
   静鉄ストア チラシ商品検索 v2 — アプリ本体
   v1 の全機能(検索・詳細・レシピ・複数選択)に加えて:
   - チラシPDFをブラウザ内で取り込み → products.json 構造へ変換
   - JSON の読み込み / 保存(GitHub公開用)
   - 取り込んだデータは localStorage に保持(再読込でも残る)
   ============================================================= */
(function () {
  "use strict";

  var RECIPES = window.RECIPES || [];
  var ING = window.INGREDIENT_KEYWORDS || {};
  var TAX_RATE = 0.08;
  var STORE_KEY = "flyer_v2_data";
  var fmtTime = window.formatCookTime || function (m) { return m != null ? ("約" + m + "分") : ""; };
  function youtubeSearchUrl(dish){ return "https://www.youtube.com/results?search_query=" + encodeURIComponent(dish + " 作り方 レシピ"); }

  // 可変データ(PDF/JSONで差し替え)
  var PRODUCTS = [];
  var META = {};
  var BY_ID = {};
  var selected = {};

  // ---------- ユーティリティ ----------
  function toHalf(s){ return (s||"").replace(/[０-９]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xFEE0);}); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
  function displayPrice(p){ if(p.tax_price!=null)return p.tax_price; if(p.price!=null)return p.price; return null; }
  function filterPrice(p){ if(p.price!=null)return p.price; if(p.tax_price!=null)return p.tax_price; return null; }
  function fmtDate(s){ if(!s||s.length!==8)return null; return s.slice(0,4)+"/"+s.slice(4,6)+"/"+s.slice(6,8); }
  var icon = window.getProductIcon || function(){return "🛒";};
  var ricon = window.getRecipeIcon || function(){return "🍽️";};
  var deptColor = window.getDeptColor || function(){return "#eef0ee";};

  // =============================================================
  //  データ設定
  // =============================================================
  function setData(products, meta, persist) {
    PRODUCTS = (products || []).slice();
    META = meta || {};
    BY_ID = {};
    PRODUCTS.forEach(function (p) { BY_ID[p.id] = p; });
    selected = {};
    if (persist) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ products: PRODUCTS, meta: META })); } catch (e) {}
    }
    refreshAll();
  }
  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var obj = JSON.parse(raw);
      if (obj && obj.products && obj.products.length) { setData(obj.products, obj.meta, false); return true; }
    } catch (e) {}
    return false;
  }

  function refreshAll() {
    populateDepartments();
    updateDataStatus();
    updateTray();
    // ドロップゾーンはデータがあれば隠す
    document.getElementById("dropzone").style.display = PRODUCTS.length ? "none" : "block";
    doSearch();
    if (document.getElementById("tabRecipe").classList.contains("active")) renderRecipes();
  }

  function updateDataStatus() {
    var el = document.getElementById("dataStatus");
    if (!PRODUCTS.length) { el.innerHTML = "まだデータがありません。チラシPDFを取り込んでください。"; return; }
    var src = META.source_file ? esc(META.source_file) : "取込データ";
    el.innerHTML = "読み込み済み: <b>" + PRODUCTS.length + "</b> 件（" + src + (META.extracted_at ? " / " + esc(META.extracted_at) : "") + "）";
  }

  // =============================================================
  //  自然文クエリ解析（v1と同一）
  // =============================================================
  var DEPT_WORDS = {
    "精肉":"精肉","お肉":"精肉","肉":"精肉","水産":"水産","海鮮":"水産","さかな":"水産","魚":"水産",
    "青果":"青果","野菜":"青果","やさい":"青果","果物":"青果","くだもの":"青果","フルーツ":"青果",
    "デリカ":"デリカ","惣菜":"デリカ","そうざい":"デリカ","お弁当":"デリカ","弁当":"デリカ",
    "ベーカリー":"ベーカリー","パン":"ベーカリー","加食":"加食","お菓子":"加食","菓子":"加食"
  };
  var DEPT_EXACT = { "洋日配":1,"和日配":1,"とうふ屋上野":1 };

  function parseQuery(raw) {
    var q = toHalf((raw||"").trim());
    var res = { text: raw||"", maxPrice:null, minPrice:null, dept:null, cheapest:false, keywords:[] };
    if (!q) return res;
    var work = q;
    if (/(一番|いちばん|最も|もっとも)?\s*(安い|やすい|最安|激安)/.test(work)) {
      res.cheapest = true;
      work = work.replace(/(一番|いちばん|最も|もっとも)?\s*(安い|やすい|最安|激安)(順|もの|の)?/g, " ");
    }
    var mMax = work.match(/(\d{1,6})\s*円?\s*(以下|まで|未満|いない)/);
    if (mMax) { res.maxPrice = parseInt(mMax[1],10); work = work.replace(mMax[0]," "); }
    var mMin = work.match(/(\d{1,6})\s*円?\s*(以上|から)/);
    if (mMin) { res.minPrice = parseInt(mMin[1],10); work = work.replace(mMin[0]," "); }
    var exactHit = null;
    for (var ex in DEPT_EXACT) { if (work.indexOf(ex)!==-1){ exactHit=ex; break; } }
    if (exactHit) { res.dept=exactHit; work=work.split(exactHit).join(" "); }
    else {
      var aliases = Object.keys(DEPT_WORDS).sort(function(a,b){return b.length-a.length;});
      for (var ai=0; ai<aliases.length; ai++){ var w=aliases[ai]; if(work.indexOf(w)!==-1){res.dept=DEPT_WORDS[w]; work=work.split(w).join(" "); break;} }
    }
    work = work.replace(/[のでをにはが、。]/g," ").replace(/\s+/g," ").trim();
    if (work) res.keywords = work.split(" ").filter(Boolean);
    return res;
  }
  function runSearch(raw, deptOverride, sortMode) {
    var pq = parseQuery(raw);
    if (deptOverride) pq.dept = deptOverride;
    var list = PRODUCTS.filter(function (p) {
      if (pq.dept && p.department !== pq.dept) return false;
      var fp = filterPrice(p);
      if (pq.maxPrice!=null){ if(fp==null||fp>pq.maxPrice) return false; }
      if (pq.minPrice!=null){ if(fp==null||fp<pq.minPrice) return false; }
      if (pq.keywords.length) {
        var hay = (p.name+" "+(p.manufacturer||"")+" "+(p.spec||"")+" "+p.department);
        for (var i=0;i<pq.keywords.length;i++){ if(hay.indexOf(pq.keywords[i])===-1) return false; }
      }
      return true;
    });
    var mode = sortMode || "relevance";
    if (pq.cheapest && mode==="relevance") mode="price_asc";
    sortList(list, mode);
    return { list:list, parsed:pq, effectiveSort:mode };
  }
  function sortList(list, mode) {
    if (mode==="price_asc") list.sort(function(a,b){return priceKey(a,1)-priceKey(b,1);});
    else if (mode==="price_desc") list.sort(function(a,b){return priceKey(b,-1)-priceKey(a,-1);});
    else if (mode==="name") list.sort(function(a,b){return a.name.localeCompare(b.name,"ja");});
  }
  function priceKey(p,dir){ var v=filterPrice(p); if(v==null) return dir>0?Number.MAX_SAFE_INTEGER:-1; return v; }

  // =============================================================
  //  カード描画（v1と同一）
  // =============================================================
  function priceInline(p) {
    var dp = displayPrice(p);
    if (dp==null) return '<div class="price"><span class="nopriceval">'+esc(p.price_note||"価格は店頭にて")+'</span></div>';
    var taxLine;
    if (p.tax_price!=null && p.price!=null) taxLine='税抜 '+p.price.toLocaleString()+'円 / 税込 '+p.tax_price.toLocaleString()+'円';
    else if (p.tax_price!=null) taxLine='税込価格';
    else taxLine='税抜価格';
    return '<div class="price"><span class="yen">'+dp.toLocaleString()+'</span><span class="unit">円</span></div><div class="tax">'+taxLine+'</div>';
  }
  function cardHTML(p) {
    var note = "";
    if (p.date_warning) note='<div class="note">⚠ 掲載期間要確認</div>';
    else if (p.price_note && displayPrice(p)!=null) note='<div class="note">'+esc(p.price_note)+'</div>';
    var sel = selected[p.id] ? " selected" : "";
    return '<div class="card'+sel+'" data-id="'+p.id+'">' +
      '<div class="imgtile" style="background:'+deptColor(p.department)+'">' +
        '<span class="selbox" data-act="select" data-id="'+p.id+'" title="選択">✓</span>' +
        '<span class="dept">'+esc(p.department)+'</span>'+icon(p) +
      '</div><div class="body">' +
        '<div class="name">'+esc(p.name)+'</div>' +
        (p.manufacturer?'<div class="maker">'+esc(p.manufacturer)+'</div>':'') +
        (p.spec?'<div class="spec">'+esc(p.spec)+'</div>':'') +
        priceInline(p)+note +
        '<div class="btns"><button class="btn-detail" data-act="detail" data-id="'+p.id+'">📋 詳細</button>' +
        '<button class="btn-recipe" data-act="recipe" data-id="'+p.id+'">🍳 レシピ</button></div>' +
      '</div></div>';
  }
  function render(result) {
    var box = document.getElementById("results");
    var list = result.list;
    document.getElementById("count").innerHTML = PRODUCTS.length ? ('該当 <b>'+list.length+'</b> 件') : '';
    if (!PRODUCTS.length) { box.innerHTML = ''; return; }
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">🔍</div>該当する商品が見つかりませんでした。</div>'; return; }
    var html = '<div class="grid">';
    for (var i=0;i<list.length;i++) html += cardHTML(list[i]);
    box.innerHTML = html + '</div>';
  }

  // =============================================================
  //  レシピ照合（v1と同一）
  // =============================================================
  function categoriesOf(name){ var cats=[]; for(var cat in ING){var kws=ING[cat];for(var i=0;i<kws.length;i++){if(name.indexOf(kws[i])!==-1){cats.push(cat);break;}}} return cats; }
  function catsFromNames(names){ var set={}; names.forEach(function(n){categoriesOf(n).forEach(function(c){set[c]=true;});}); return set; }
  function availableIngredients(){ var a={}; PRODUCTS.forEach(function(p){categoriesOf(p.name).forEach(function(c){(a[c]=a[c]||[]).push(p.name);});}); return a; }
  function buildRecipes(avail, genreFilter, onlyMakeable, sortBy) {
    var out=[];
    RECIPES.forEach(function(r){
      if(genreFilter && r.genre!==genreFilter) return;
      var needHave=r.need.filter(function(c){return avail[c];});
      var makeable=needHave.length===r.need.length;
      if(onlyMakeable && !makeable) return;
      var niceHave=(r.nice||[]).filter(function(c){return avail[c];});
      out.push({recipe:r,makeable:makeable,needHave:needHave,niceHave:niceHave,avail:avail,score:(makeable?1000:0)+needHave.length*10+niceHave.length});
    });
    if (sortBy==="time_asc") out.sort(function(a,b){ return (a.recipe.time||999)-(b.recipe.time||999) || b.score-a.score; });
    else out.sort(function(a,b){return b.score-a.score;});
    return out;
  }
  function ingTag(cat, avail) {
    if (avail[cat]) {
      var arr=avail[cat]; var sample=(typeof arr[0]==="string")?arr[0]:""; var extra=arr.length>1?" 他":"";
      return '<span class="ing-tag have">✓ '+esc(cat)+(sample?' <span class="prod">('+esc(sample)+extra+')</span>':'')+'</span>';
    }
    return '<span class="ing-tag miss">'+esc(cat)+'</span>';
  }
  function recipeCardHTML(it) {
    var r=it.recipe;
    var badge=it.makeable?'<span class="badge ok">今すぐ作れる</span>':'<span class="badge soon">あと'+(r.need.length-it.needHave.length)+'品でOK</span>';
    var timeBadge=(r.time!=null)?'<span class="badge time">⏱ '+esc(fmtTime(r.time))+'</span>':'';
    var timeTile=(r.time!=null)?'<span class="rtime">⏱ '+esc(fmtTime(r.time))+'</span>':'';
    var needTags=r.need.map(function(c){return ingTag(c,it.avail);}).join("");
    var niceTags=(r.nice||[]).map(function(c){return ingTag(c,it.avail);}).join("");
    var prods={}; r.need.concat(r.nice||[]).forEach(function(c){(it.avail[c]||[]).forEach(function(n){if(typeof n==="string")prods[n]=1;});});
    var prodList=Object.keys(prods);
    var matched=prodList.length?'<details class="matched"><summary>セール該当商品を見る ('+prodList.length+'件)</summary><ul>'+prodList.map(function(n){return '<li>'+esc(n)+'</li>';}).join("")+'</ul></details>':'';
    var yt='<a class="yt-btn" href="'+youtubeSearchUrl(r.name)+'" target="_blank" rel="noopener">▶ YouTubeで作り方</a>';
    return '<div class="recipe-card"><div class="rhead">'+ricon(r.name)+timeTile+'</div><div class="rbody">' +
      '<h3>'+esc(r.name)+badge+timeBadge+'<span class="badge genre">'+esc(r.genre)+'</span></h3>' +
      '<div class="tip">💡 '+esc(r.tip)+'</div>' +
      '<div class="ing-row"><span class="lbl">必要な食材</span>'+needTags+'</div>' +
      (niceTags?'<div class="ing-row"><span class="lbl">あると良い</span>'+niceTags+'</div>':'')+matched +
      '<div>'+yt+'</div></div></div>';
  }
  function renderRecipes() {
    var box = document.getElementById("recipeResults");
    if (!PRODUCTS.length) { box.innerHTML = '<div class="empty"><div class="big">🍳</div>先にチラシPDFを取り込んでください。</div>'; return; }
    var genre=document.getElementById("genreSel").value;
    var only=document.getElementById("onlyMakeable").checked;
    var sortBy=document.getElementById("recipeSort").value;
    var items=buildRecipes(availableIngredients(),genre,only,sortBy);
    if (!items.length) { box.innerHTML='<div class="empty"><div class="big">🍳</div>条件に合う献立が見つかりませんでした。</div>'; return; }
    box.innerHTML='<div class="rgrid">'+items.map(recipeCardHTML).join("")+'</div>';
  }

  // =============================================================
  //  モーダル（v1と同一）
  // =============================================================
  var modalBack=null, mbody=null, mheadIcon=null, mhead=null;
  function openModal(){ modalBack.classList.add("show"); }
  function closeModal(){ modalBack.classList.remove("show"); }

  function showDetail(p) {
    mhead.style.background = deptColor(p.department);
    mheadIcon.textContent = icon(p);
    var priceBig, dp=displayPrice(p);
    if (dp==null) priceBig='<div class="priceBig"><div class="main">'+esc(p.price_note||"価格は店頭にて")+'</div></div>';
    else {
      var ex=p.price, inc=p.tax_price, taxAmt=null;
      if (ex!=null&&inc!=null) taxAmt=inc-ex;
      else if (ex!=null){ inc=Math.floor(ex*(1+TAX_RATE)); taxAmt=inc-ex; }
      else if (inc!=null){ ex=Math.round(inc/(1+TAX_RATE)); taxAmt=inc-ex; }
      var mainIsInc=(p.tax_price!=null);
      priceBig='<div class="priceBig"><div class="main">'+(mainIsInc?inc:ex).toLocaleString()+'<small>円 ('+(mainIsInc?'税込':'税抜')+')</small></div>' +
        '<div class="subp">税抜 '+(ex!=null?ex.toLocaleString()+'円':'—')+'　消費税 約'+(taxAmt!=null?taxAmt.toLocaleString()+'円':'—')+'　税込 '+(inc!=null?inc.toLocaleString()+'円':'—')+'</div>' +
        (p.tax_price==null?'<div class="subp">※税込・消費税は税率'+Math.round(TAX_RATE*100)+'%での目安です</div>':(p.price==null?'<div class="subp">※税抜・消費税は税率'+Math.round(TAX_RATE*100)+'%での目安です</div>':''))+'</div>';
    }
    var from=fmtDate(p.from_date), to=fmtDate(p.to_date), periodHtml;
    if (p.date_warning) periodHtml='<div class="period warn">🗓 <b>販売期間</b><div class="big">'+(from||"?")+" 〜 "+(to||"?")+'</div>⚠ 元チラシの日付が前後している可能性があります。店頭でご確認ください。</div>';
    else if (from||to) periodHtml='<div class="period">🗓 <b>販売期間</b><div class="big">'+(from||"?")+" 〜 "+(to||"?")+'</div></div>';
    else periodHtml='<div class="period">🗓 販売期間は元チラシをご確認ください。</div>';

    var myCats=categoriesOf(p.name), recipeHits=relatedRecipes(myCats), recHtml="";
    if (recipeHits.length) {
      recHtml='<div class="mrecipes"><b>🍳 この商品で作れる料理</b>'+recipeHits.slice(0,6).map(function(h){
        var tt=(h.recipe.time!=null)?' <span class="mk">⏱'+esc(fmtTime(h.recipe.time))+'</span>':'';
        return '<div class="mrecipe-item"><span class="ic">'+ricon(h.recipe.name)+'</span><span><div class="nm">'+esc(h.recipe.name)+'</div><span class="mk">'+(h.makeable?'<span class="badge ok">今すぐ作れる</span>':'<span class="badge soon">あと'+(h.recipe.need.length-h.have)+'品でOK</span>')+'</span>'+tt+'</span><a class="yt" href="'+youtubeSearchUrl(h.recipe.name)+'" target="_blank" rel="noopener">▶作り方</a></div>';
      }).join("")+'</div>';
    }
    var rows=(p.manufacturer?drow("メーカー・産地",p.manufacturer):"")+(p.spec?drow("規格",p.spec):"")+drow("部門",p.department)+(p.jan?drow("JANコード",p.jan):"")+(p.source_page?drow("元チラシページ",p.source_page+" ページ"):"");
    mbody.innerHTML='<span class="mdept">'+esc(p.department)+'</span><h2>'+esc(p.name)+'</h2>'+priceBig+periodHtml+rows+recHtml+'<div class="mnote">価格・在庫のリアルタイム照会は行いません。重要な情報は店頭・元チラシでご確認ください。</div>';
    openModal();
  }
  function drow(k,v){ return '<div class="drow"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>'; }

  function relatedRecipes(cats) {
    var all=availableIngredients(), set={}; cats.forEach(function(c){set[c]=true;});
    var hits=[];
    RECIPES.forEach(function(r){
      var usesThis=r.need.some(function(c){return set[c];})||(r.nice||[]).some(function(c){return set[c];});
      if(!usesThis)return;
      var have=r.need.filter(function(c){return all[c];}).length;
      hits.push({recipe:r,makeable:have===r.need.length,have:have,useNeed:r.need.filter(function(c){return set[c];}).length});
    });
    hits.sort(function(a,b){return (b.useNeed-a.useNeed)||(b.makeable-a.makeable)||(b.have-a.have);});
    return hits;
  }
  function showRecipeFor(p) {
    mhead.style.background="#fff4e9"; mheadIcon.textContent=icon(p);
    var cats=categoriesOf(p.name), hits=relatedRecipes(cats), body;
    if (!hits.length) body='<p>この商品に直接ひもづくレシピは見つかりませんでした。<br>「献立ヒント」タブもお試しください。</p>';
    else body=hits.map(function(h){
      var r=h.recipe;
      var tt=(r.time!=null)?' <span class="mk">⏱'+esc(fmtTime(r.time))+'</span>':'';
      return '<div class="mrecipe-item"><span class="ic">'+ricon(r.name)+'</span><span><div class="nm">'+esc(r.name)+'</div><span class="mk">'+(h.makeable?'<span class="badge ok">今すぐ作れる</span>':'<span class="badge soon">あと'+(r.need.length-h.have)+'品でOK</span>')+' <span class="badge genre">'+esc(r.genre)+'</span></span>'+tt+'<div class="tip" style="font-size:12px">💡 '+esc(r.tip)+'</div></span><a class="yt" href="'+youtubeSearchUrl(r.name)+'" target="_blank" rel="noopener">▶作り方</a></div>';
    }).join("");
    mbody.innerHTML='<span class="mdept">'+esc(p.department)+'</span><h2>🍳 '+esc(p.name)+' の活用レシピ</h2>'+(cats.length?'<div class="mnote" style="margin:0 0 10px">食材カテゴリ: '+cats.map(esc).join("、")+'</div>':'')+body+'<div class="mnote">「今すぐ作れる」は、必要な食材がすべてチラシのセール品でそろう場合です。</div>';
    openModal();
  }
  function showMakeFromSelected() {
    var ids=Object.keys(selected); if(!ids.length)return;
    var names=ids.map(function(id){return BY_ID[id]?BY_ID[id].name:"";}).filter(Boolean);
    var avail=catsFromNames(names), availMap={};
    Object.keys(avail).forEach(function(c){ availMap[c]=names.filter(function(n){return categoriesOf(n).indexOf(c)!==-1;}); });
    var items=buildRecipes(availMap,"",false,"score");
    var makeable=items.filter(function(x){return x.makeable;});
    var soon=items.filter(function(x){return !x.makeable && x.needHave.length>0;});
    mhead.style.background="#fff4e9"; mheadIcon.textContent="🧺";
    var catList=Object.keys(avail);
    var head='<h2>🧺 選んだ '+names.length+' 品で作れる料理</h2><div class="mnote" style="margin:0 0 6px">選択: '+names.map(esc).join("、")+'</div><div class="mnote" style="margin:0 0 12px">そろう食材: '+(catList.length?catList.map(esc).join("、"):"—")+'</div>';
    function block(title,arr){
      if(!arr.length)return "";
      return '<div style="margin-bottom:6px"><b>'+title+'</b></div>'+arr.map(function(h){
        var r=h.recipe;
        var tt=(r.time!=null)?' <span class="mk">⏱'+esc(fmtTime(r.time))+'</span>':'';
        return '<div class="mrecipe-item"><span class="ic">'+ricon(r.name)+'</span><span><div class="nm">'+esc(r.name)+'</div><span class="mk">'+(h.makeable?'<span class="badge ok">今すぐ作れる</span>':'<span class="badge soon">あと'+(r.need.length-h.needHave.length)+'品でOK (不足: '+r.need.filter(function(c){return !availMap[c];}).map(esc).join("、")+')</span>')+' <span class="badge genre">'+esc(r.genre)+'</span></span>'+tt+'<div class="tip" style="font-size:12px">💡 '+esc(r.tip)+'</div></span><a class="yt" href="'+youtubeSearchUrl(r.name)+'" target="_blank" rel="noopener">▶作り方</a></div>';
      }).join("");
    }
    var body;
    if(!makeable.length && !soon.length) body='<p>選んだ商品だけでは、登録レシピに一致する料理が見つかりませんでした。<br>肉・野菜・主食など組み合わせを変えてみてください。</p>';
    else body=block("✅ 今すぐ作れる ("+makeable.length+")",makeable)+(soon.length?'<div style="height:10px"></div>'+block("🟠 もう少しで作れる ("+soon.length+")",soon.slice(0,8)):"");
    mbody.innerHTML=head+body+'<div class="mnote">選んだ商品に含まれる食材から判定しています。調理の分量・手順は一般的な目安です。</div>';
    openModal();
  }

  // =============================================================
  //  選択トレイ（v1と同一）
  // =============================================================
  function toggleSelect(id){ if(selected[id])delete selected[id]; else selected[id]=true; updateTray(); var card=document.querySelector('.card[data-id="'+id+'"]'); if(card)card.classList.toggle("selected",!!selected[id]); }
  function clearSelection(){ selected={}; updateTray(); document.querySelectorAll(".card.selected").forEach(function(c){c.classList.remove("selected");}); }
  function updateTray() {
    var ids=Object.keys(selected), tray=document.getElementById("tray");
    document.getElementById("selCount").textContent=ids.length;
    document.getElementById("selItems").innerHTML=ids.map(function(id){
      var p=BY_ID[id]; if(!p)return "";
      return '<span class="pill">'+icon(p)+' '+esc(p.name.length>14?p.name.slice(0,14)+"…":p.name)+' <span class="x" data-rm="'+id+'">×</span></span>';
    }).join("");
    tray.classList.toggle("show",ids.length>0);
  }

  // =============================================================
  //  PDF取り込み / JSON入出力
  // =============================================================
  function showProgress(show){ document.getElementById("progress").classList.toggle("show",!!show); if(show){document.getElementById("progFill").style.width="0%";} }
  function setProgress(cur,total,msg){ var pct=total?Math.round(cur/total*100):0; document.getElementById("progFill").style.width=pct+"%"; document.getElementById("progLabel").textContent=msg||("ページ "+cur+" / "+total+" を解析中…"); }

  async function handlePdfFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { alert("PDFファイルを選んでください。"); return; }
    showProgress(true);
    setProgress(0,1,"PDFを読み込み中…");
    try {
      var buf = await file.arrayBuffer();
      var result = await window.FlyerPDF.extract(buf, function(cur,total){ setProgress(cur,total); }, file.name);
      showProgress(false);
      if (!result.products.length) {
        alert("商品データを取り出せませんでした。\nテキスト版（文字が選択できる）の『チラシ全店版 テキスト版.pdf』形式かご確認ください。");
        return;
      }
      setData(result.products, result.meta, true);
      alert("取り込み完了: " + result.products.length + " 件の商品を読み込みました。");
    } catch (e) {
      showProgress(false);
      alert("PDFの解析中にエラーが発生しました:\n" + (e && e.message ? e.message : e));
    }
  }

  // =============================================================
  //  イベント / 初期化
  // =============================================================
  function onResultsClick(e) {
    var t = e.target;
    var act = t.getAttribute("data-act");
    if (!act) { var sb = t.closest ? t.closest("[data-act]") : null; if (sb){ act=sb.getAttribute("data-act"); t=sb; } }
    if (!act) return;
    var id = t.getAttribute("data-id"), p = BY_ID[id];
    if (act==="detail"&&p) showDetail(p);
    else if (act==="recipe"&&p) showRecipeFor(p);
    else if (act==="select"&&id) toggleSelect(id);
  }
  function populateDepartments() {
    var sel = document.getElementById("deptSel");
    sel.innerHTML = '<option value="">すべて</option>';
    var seen={}, order=[];
    PRODUCTS.forEach(function(p){ if(!seen[p.department]){seen[p.department]=1; order.push(p.department);} });
    order.forEach(function(d){ var o=document.createElement("option"); o.value=d; o.textContent=d; sel.appendChild(o); });
  }
  function doSearch() {
    var raw=document.getElementById("q").value, dept=document.getElementById("deptSel").value, sort=document.getElementById("sortSel").value;
    var result=runSearch(raw,dept,sort);
    if (result.effectiveSort && result.effectiveSort!==sort) document.getElementById("sortSel").value=result.effectiveSort;
    render(result);
    var mi=document.getElementById("metaInfo");
    mi.textContent = META.extracted_at ? (" (取得: "+META.extracted_at+" / "+PRODUCTS.length+"件)") : "";
  }
  function initTabs() {
    var tabs=document.querySelectorAll(".tab");
    tabs.forEach(function(t){
      t.addEventListener("click",function(){
        tabs.forEach(function(x){x.classList.remove("active");}); t.classList.add("active");
        document.querySelectorAll(".panel").forEach(function(p){p.classList.remove("active");});
        document.getElementById("panel-"+t.dataset.tab).classList.add("active");
        if (t.dataset.tab==="recipe") renderRecipes();
      });
    });
  }

  function init() {
    modalBack=document.getElementById("modalBack"); mbody=document.getElementById("mbody");
    mheadIcon=document.getElementById("mheadIcon"); mhead=document.getElementById("mhead");

    initTabs();

    document.getElementById("searchBtn").addEventListener("click", doSearch);
    document.getElementById("q").addEventListener("keydown", function(e){ if(e.key==="Enter") doSearch(); });
    document.getElementById("deptSel").addEventListener("change", doSearch);
    document.getElementById("sortSel").addEventListener("change", doSearch);
    document.querySelectorAll(".chip").forEach(function(c){
      c.addEventListener("click", function(){ document.getElementById("q").value=c.dataset.q; document.getElementById("deptSel").value=""; document.getElementById("sortSel").value="relevance"; doSearch(); });
    });
    document.getElementById("genreSel").addEventListener("change", renderRecipes);
    document.getElementById("onlyMakeable").addEventListener("change", renderRecipes);
    document.getElementById("recipeSort").addEventListener("change", renderRecipes);
    document.getElementById("results").addEventListener("click", onResultsClick);
    document.getElementById("makeBtn").addEventListener("click", showMakeFromSelected);
    document.getElementById("clearSel").addEventListener("click", clearSelection);
    document.getElementById("selItems").addEventListener("click", function(e){ var rm=e.target.getAttribute("data-rm"); if(rm) toggleSelect(rm); });
    document.getElementById("mclose").addEventListener("click", closeModal);
    modalBack.addEventListener("click", function(e){ if(e.target===modalBack) closeModal(); });
    document.addEventListener("keydown", function(e){ if(e.key==="Escape") closeModal(); });

    // --- PDF / JSON 取り込み ---
    var pdfInput=document.getElementById("pdfInput");
    document.getElementById("uploadBtn").addEventListener("click", function(){ pdfInput.click(); });
    pdfInput.addEventListener("change", function(){ if(pdfInput.files[0]){ handlePdfFile(pdfInput.files[0]); pdfInput.value=""; } });

    // --- ドロップゾーン ---
    var dz=document.getElementById("dropzone");
    dz.addEventListener("click", function(){ pdfInput.click(); });
    ["dragenter","dragover"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.add("drag"); }); });
    ["dragleave","drop"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.remove("drag"); }); });
    dz.addEventListener("drop", function(e){ var f=e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) handlePdfFile(f); });
    // ページ全体へのドロップも受け付ける(データがある状態でも差し替え可能)
    ["dragover","drop"].forEach(function(ev){ document.addEventListener(ev,function(e){ e.preventDefault(); }); });
    document.addEventListener("drop", function(e){
      if (e.target.closest && e.target.closest("#dropzone")) return; // dz側で処理済み
      var f=e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /\.pdf$/i.test(f.name)) handlePdfFile(f);
    });

    // 保存済みデータがあれば復元、なければ空の案内
    if (!loadFromStorage()) { refreshAll(); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
