#!/usr/bin/env python3
"""Build a self-contained offline HTML preview of the 'Last 400m' concept on the
REAL 송정동 finals-sample data (두리발 dropoffs × 무장애가게 audit).

Reads the DIVE sample archive in data/, computes the enterable/usable chain and
Barrier DNA, and writes analysis/last400m_songjeong.html with all data inlined
(opens via file://, no server, no network, no basemap dependency).

Run: python3 analysis/build_last400m_preview.py
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import common  # noqa: E402

ARC = next(os.path.join(ROOT, "data", n) for n in os.listdir(os.path.join(ROOT, "data"))
           if n.endswith(".zip") and "샘플 데이터" in n)
Z = zipfile.ZipFile(ARC)
FIELDS = ["일층", "경사로", "입구턱", "입구무턱", "테이블석", "화장실턱",
          "화장실무턱", "장애인화장실", "엘리베이터", "주차장", "장애인주차장", "테이크아웃"]


def extract(sub):
    e = next(x for x in Z.namelist() if sub in x and x.endswith(".xlsx"))
    p = os.path.join("/tmp", "_l4_%s.xlsx" % sub)
    open(p, "wb").write(Z.read(e))
    return p


# --- shops ------------------------------------------------------------------
rows = list(common.iter_xlsx_rows(extract("무장애가게")))
h = rows[0]
idx = {n: h.index(n) for n in h}
shops = []
for r in rows[1:]:
    f = {k: (r[idx[k]] or "").strip() for k in FIELDS}
    shops.append({
        "name": r[idx["상호명"]],
        "cat": r[idx["상권업종중분류명"]],
        "lat": float(r[idx["위도"]]),
        "lng": float(r[idx["경도"]]),
        "f": f,
    })

# --- dropoffs (completed = 하차시간 present) --------------------------------
dr = list(common.iter_xlsx_rows(extract("두리발운행")))
hd = dr[0]
xi, yi, ci = hd.index("목적지X좌표"), hd.index("목적지Y좌표"), hd.index("하차시간")
drops = []
for r in dr[1:]:
    if (r[ci] or "").strip() and r[xi] and r[yi]:
        try:
            drops.append([round(float(r[xi]), 6), round(float(r[yi]), 6)])
        except ValueError:
            pass

data = {"shops": shops, "drops": drops, "fields": FIELDS}
OUT = os.path.join(ROOT, "analysis", "last400m_songjeong.html")

HTML = r"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>도착 이후 400m — 송정동</title>
<style>
:root{
  --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --border:rgba(255,255,255,.10);
  --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
  --demand:#3987e5;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.45}
.wrap{max-width:1160px;margin:0 auto;padding:28px 22px 60px}
.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font-size:26px;margin:6px 0 4px;font-weight:650}
.sub{color:var(--ink2);font-size:14px;max-width:70ch}
.sub b{color:var(--ink);font-weight:600}
.grid{display:grid;grid-template-columns:1.35fr 1fr;gap:20px;margin-top:22px}
@media(max-width:880px){.grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px}
.card h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);
  margin:0 0 12px;font-weight:600}
#map{width:100%;height:auto;display:block;border-radius:10px;background:#111}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{background:#242422;border:1px solid var(--border);color:var(--ink2);border-radius:8px;
  padding:7px 11px;font-size:12.5px;cursor:pointer;font-family:inherit}
.btn:hover{color:var(--ink)}
.btn.on{background:#33322e;color:var(--ink);border-color:rgba(255,255,255,.25)}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;font-size:12.5px;color:var(--ink2)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block;box-shadow:0 0 0 2px var(--surface)}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tile{background:#141413;border:1px solid var(--border);border-radius:11px;padding:12px 13px}
.tile .v{font-size:26px;font-weight:650;letter-spacing:-.01em}
.tile .l{font-size:11.5px;color:var(--muted);margin-top:2px}
.hero{grid-column:1/-1;background:linear-gradient(180deg,#241416,#161413);
  border-color:rgba(208,59,59,.35)}
.hero .v{font-size:46px;color:#ff6b6b;line-height:1}
.hero .l{font-size:13px;color:var(--ink2);margin-top:6px}
.funnel{display:flex;flex-direction:column;gap:6px}
.frow{display:grid;grid-template-columns:96px 1fr 42px;align-items:center;gap:10px;font-size:12.5px}
.ftrack{height:20px;background:#141413;border-radius:5px;overflow:hidden}
.ffill{height:100%;border-radius:5px}
.frow .fl{color:var(--ink2)} .frow .fn{color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.bars{display:flex;flex-direction:column;gap:9px}
.brow{display:grid;grid-template-columns:120px 1fr 30px;align-items:center;gap:10px;font-size:12.5px}
.btrack{height:16px;background:#141413;border-radius:4px;overflow:hidden}
.bfill{height:100%;border-radius:4px}
.brow .bl{color:var(--ink2)} .brow .bn{color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
#tip{position:fixed;pointer-events:none;background:#000;border:1px solid var(--border);
  border-radius:9px;padding:9px 11px;font-size:12px;max-width:250px;opacity:0;transition:opacity .1s;z-index:9}
#tip b{color:#fff} #tip .row{color:var(--ink2);display:flex;justify-content:space-between;gap:14px;margin-top:2px}
#tip .ok{color:#4fd14f} #tip .no{color:#ff6b6b}
.detail{margin-top:14px;color:var(--ink2);font-size:13px;min-height:20px}
.detail b{color:var(--ink)}
details{margin-top:22px;color:var(--ink2)} summary{cursor:pointer;font-size:13px;color:var(--muted)}
table{border-collapse:collapse;width:100%;margin-top:10px;font-size:12px}
th,td{border-bottom:1px solid var(--grid);padding:5px 8px;text-align:left}
th{color:var(--muted);font-weight:600}
.note{color:var(--muted);font-size:11.5px;margin-top:6px}
.simcap{font-size:12.5px;color:var(--warning);margin-top:8px;min-height:18px}
</style></head>
<body class="viz-root" data-palette="#fab219,#d03b3b,#0ca30c,#3987e5">
<div class="wrap">
  <div class="kicker">The Last 400m · 도착 이후 400m</div>
  <h1>송정동 접근성 인터벤션 랩 <span style="color:var(--muted);font-size:15px;font-weight:400">— 실데이터 미리보기</span></h1>
  <p class="sub">두리발이 실제로 <b>내려준 지점</b>과 윌체어 <b>무장애가게 감사 데이터</b>를 겹쳐,
    도착 이후 실제로 <b>들어갈 수 있는 선택지</b>가 몇 개인지, 사슬이 어디서 끊기는지 봅니다.
    표본: 해운대구 송정동. <span style="color:var(--muted)">proximity 기준, 좌표는 실측.</span></p>

  <div class="grid">
    <div class="card">
      <h2>도착지 × 무장애가게 접근성</h2>
      <svg id="map" preserveAspectRatio="xMidYMid meet"></svg>
      <div class="controls">
        <button class="btn on" id="tDemand">두리발 도착 표시</button>
        <button class="btn on" id="tShops">무장애가게 표시</button>
        <button class="btn" id="tSim">입구 무턱화 시뮬 (before → after)</button>
      </div>
      <div class="simcap" id="simcap"></div>
      <div class="legend">
        <span><i class="dot" style="background:var(--critical)"></i>진입 불가 (문턱·계단)</span>
        <span><i class="dot" style="background:var(--warning)"></i>진입 가능·완비 아님</span>
        <span><i class="dot" style="background:var(--good)"></i>완비 (장애인화장실까지)</span>
        <span><i class="dot" style="background:var(--demand);box-shadow:none;opacity:.5"></i>두리발 도착</span>
      </div>
      <div class="detail" id="detail">지도의 매장에 마우스를 올리면 12개 감사 항목이 보입니다.</div>
    </div>

    <div class="card">
      <h2>이 미시존이 말하는 것</h2>
      <div class="tiles">
        <div class="tile hero"><div class="v" id="hComfort">0</div>
          <div class="l">21개 무장애가게 중 <b>장애인화장실까지 완비</b>된 곳</div></div>
        <div class="tile"><div class="v" id="sDrops">0</div><div class="l">두리발 도착 (13개월)</div></div>
        <div class="tile"><div class="v" id="sShops">21</div><div class="l">무장애가게</div></div>
        <div class="tile"><div class="v" id="sEnter">18</div><div class="l">진입 가능</div></div>
        <div class="tile"><div class="v" id="sUse">17</div><div class="l">내부 이용 가능</div></div>
      </div>

      <h2 style="margin-top:20px">이동완성 사슬 — 어디서 줄어드나</h2>
      <div class="funnel" id="funnel"></div>

      <h2 style="margin-top:20px">Barrier DNA — 사슬이 끊기는 지점</h2>
      <div class="bars" id="bars"></div>
      <div class="note">지배적 broken-link 기준 매장 분류. 진입=critical, 내부이용=serious, 편의=warning.</div>
    </div>
  </div>

  <details><summary>표 보기 (21개 매장 · 접근성 원자료)</summary>
    <table id="tbl"><thead><tr><th>상호명</th><th>업종</th><th>일층</th><th>경사로</th>
      <th>입구턱</th><th>엘리베이터</th><th>테이블석</th><th>장애인화장실</th><th>판정</th></tr></thead>
      <tbody></tbody></table>
  </details>
  <p class="note">출처: 2026 DIVE Hackathon 부산시설공단·윌체어 샘플 데이터 (송정동 추출). 완비 0곳은 표본 사실이며 인과 주장이 아닙니다.</p>
</div>
<div id="tip"></div>

<script>
const DATA = __DATA__;
const C = {critical:'#d03b3b', warning:'#fab219', good:'#0ca30c', serious:'#ec835a', demand:'#3987e5'};
const $ = s => document.querySelector(s);

function statusOf(s, sim){
  const f = s.f;
  const entry_ok = sim || f['입구턱']!=='Y' || f['입구무턱']==='Y' || f['경사로']==='Y';
  const floor_ok = f['일층']==='Y' || f['엘리베이터']==='Y';
  const enterable = entry_ok && floor_ok;
  const usable = enterable && f['테이블석']==='Y';
  const comfort = usable && f['장애인화장실']==='Y';
  const barrier = !entry_ok?'입구(진입)': !floor_ok?'층이동':
                  f['테이블석']!=='Y'?'내부이용': f['장애인화장실']!=='Y'?'편의(화장실)':'완비';
  const cls = !enterable?'critical': comfort?'good':'warning';
  return {enterable,usable,comfort,barrier,cls};
}

// --- projection -------------------------------------------------------------
const lats=DATA.shops.map(s=>s.lat).concat(DATA.drops.map(d=>d[0]));
const lngs=DATA.shops.map(s=>s.lng).concat(DATA.drops.map(d=>d[1]));
const pad=0.0009;
const latMin=Math.min(...lats)-pad, latMax=Math.max(...lats)+pad;
const lngMin=Math.min(...lngs)-pad, lngMax=Math.max(...lngs)+pad;
const kx=Math.cos((latMin+latMax)/2*Math.PI/180);
const W=660, H=Math.round(W*(latMax-latMin)/((lngMax-lngMin)*kx));
const px=lng=>(lng-lngMin)/(lngMax-lngMin)*W;
const py=lat=>(latMax-lat)/(latMax-latMin)*H;
const map=$('#map'); map.setAttribute('viewBox',`0 0 ${W} ${H}`);
const NS='http://www.w3.org/2000/svg';
function el(t,a){const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e;}

let showDemand=true, showShops=true, sim=false;

function render(){
  map.innerHTML='';
  // demand dots
  if(showDemand){
    const g=el('g',{});
    for(const d of DATA.drops) g.appendChild(el('circle',{cx:px(d[1]),cy:py(d[0]),r:2.1,
      fill:C.demand,'fill-opacity':.16}));
    map.appendChild(g);
  }
  // shops
  if(showShops){
    DATA.shops.forEach((s,i)=>{
      const st=statusOf(s,sim);
      const c=el('circle',{cx:px(s.lng),cy:py(s.lat),r:7,fill:C[st.cls],
        stroke:'#1a1a19','stroke-width':2,style:'cursor:pointer'});
      c.addEventListener('mousemove',e=>tip(e,s,st));
      c.addEventListener('mouseleave',hideTip);
      map.appendChild(c);
    });
  }
  recompute();
}

function recompute(){
  const st=DATA.shops.map(s=>statusOf(s,sim));
  const nEnter=st.filter(x=>x.enterable).length;
  const nUse=st.filter(x=>x.usable).length;
  const nComf=st.filter(x=>x.comfort).length;
  const N=DATA.shops.length;
  $('#sDrops').textContent=DATA.drops.length.toLocaleString();
  $('#sShops').textContent=N; $('#sEnter').textContent=nEnter;
  $('#sUse').textContent=nUse; $('#hComfort').textContent=nComf;

  // funnel
  const stages=[['무장애가게',N,C.demand],['진입 가능',nEnter,C.warning],
    ['내부 이용',nUse,C.serious],['완비',nComf,C.good]];
  $('#funnel').innerHTML=stages.map(([l,n,c])=>
    `<div class="frow"><span class="fl">${l}</span>
      <span class="ftrack"><span class="ffill" style="width:${100*n/N}%;background:${c}"></span></span>
      <span class="fn">${n}</span></div>`).join('');

  // barrier DNA
  const cnt={}; st.forEach(x=>cnt[x.barrier]=(cnt[x.barrier]||0)+1);
  const order=[['입구(진입)',C.critical],['층이동',C.critical],['내부이용',C.serious],
    ['편의(화장실)',C.warning],['완비',C.good]];
  const mx=Math.max(1,...Object.values(cnt));
  $('#bars').innerHTML=order.filter(([k])=>cnt[k]).map(([k,c])=>
    `<div class="brow"><span class="bl">${k}</span>
      <span class="btrack"><span class="bfill" style="width:${100*cnt[k]/mx}%;background:${c}"></span></span>
      <span class="bn">${cnt[k]}</span></div>`).join('');

  // sim caption
  const base=DATA.shops.map(s=>statusOf(s,false)).filter(x=>x.enterable).length;
  $('#simcap').textContent = sim
    ? `입구 무턱화 시뮬: 진입 가능 ${base} → ${nEnter} (+${nEnter-base}곳). 완비는 여전히 ${nComf} — 화장실이 다음 병목.`
    : '';

  // table
  const tb=$('#tbl').querySelector('tbody');
  tb.innerHTML=DATA.shops.map((s,i)=>{const x=st[i];const g=v=>v==='Y'?'<span style="color:#4fd14f">Y</span>':'<span style="color:#8a8">N</span>';
    return `<tr><td>${s.name}</td><td>${s.cat}</td><td>${g(s.f['일층'])}</td><td>${g(s.f['경사로'])}</td>
      <td>${g(s.f['입구턱'])}</td><td>${g(s.f['엘리베이터'])}</td><td>${g(s.f['테이블석'])}</td>
      <td>${g(s.f['장애인화장실'])}</td><td style="color:${C[x.cls]}">${x.barrier}</td></tr>`;}).join('');
}

const tipEl=$('#tip');
function tip(e,s,st){
  const f=s.f, row=(k)=>`<div class="row"><span>${k}</span><span class="${f[k]==='Y'?'ok':'no'}">${f[k]}</span></div>`;
  tipEl.innerHTML=`<b>${s.name}</b> <span style="color:#898781">${s.cat}</span>`+
    ['경사로','입구턱','입구무턱','일층','엘리베이터','테이블석','장애인화장실'].map(row).join('')+
    `<div class="row" style="margin-top:5px;border-top:1px solid #333;padding-top:4px">
      <span>판정</span><span style="color:${C[st.cls]}">${st.barrier}</span></div>`;
  tipEl.style.opacity=1;
  tipEl.style.left=Math.min(e.clientX+14,innerWidth-260)+'px';
  tipEl.style.top=(e.clientY+14)+'px';
  $('#detail').innerHTML=`<b>${s.name}</b> — ${st.enterable?'진입 가능':'진입 불가'}, 판정 <b style="color:${C[st.cls]}">${st.barrier}</b>`;
}
function hideTip(){tipEl.style.opacity=0;}

function tog(id,fn){const b=$(id);b.addEventListener('click',()=>{fn();b.classList.toggle('on');render();});}
tog('#tDemand',()=>showDemand=!showDemand);
tog('#tShops',()=>showShops=!showShops);
$('#tSim').addEventListener('click',()=>{sim=!sim;$('#tSim').classList.toggle('on');render();});

render();
</script>
</body></html>"""

open(OUT, "w", encoding="utf-8").write(HTML.replace("__DATA__", json.dumps(data, ensure_ascii=False)))
print("shops:", len(shops), "| dropoffs:", len(drops))
print("wrote", OUT, "(%d KB)" % (os.path.getsize(OUT) // 1024))
