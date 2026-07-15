// Builds public/data/welfare_programs.json ("장애유형별 복지 운영 프로그램 추천") from 5
// gu-level 장애인복지관 program CSVs (남구/영도구/사하구/금정구/사상구). Each source has a
// different schema and (in one case) a different encoding; see the per-source loaders below.
//
// Run: node scripts/build_welfare_programs.mjs
// Input paths (raw CSV exports) are hardcoded below, matching the convention in
// scripts/build_tourism.mjs (external raw inputs live outside the repo, in Downloads).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = "C:\\Users\\김태국\\Downloads";
const OUT_PATH = path.join(ROOT, "public", "data", "welfare_programs.json");

// The 15 official disability types, in the order given by the team.
const DISABILITY_TYPES = [
  "지체", "시각", "청각", "언어", "지적", "뇌병변", "자폐성", "정신",
  "신장", "심장", "호흡기", "간", "안면", "장루_요루", "뇌전증",
];

// ---------------------------------------------------------------------------
// CSV parsing (RFC4180-ish: quoted fields may contain commas/newlines/escaped quotes)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readRecords(filePath, encoding) {
  const buf = fs.readFileSync(filePath);
  let text = new TextDecoder(encoding).decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const rec = {};
    header.forEach((h, i) => { rec[h.trim()] = (r[i] ?? "").trim(); });
    return rec;
  });
}

// ---------------------------------------------------------------------------
// Disability-type classifier
// ---------------------------------------------------------------------------
// Tier 1: explicit type name in the target text (split on +/,/、/·).
// Tier 2: target text is generic ("장애인" etc.) — infer from program name +
//         description using a keyword table grounded in the actual source text.
// Tier 3: nothing matched — isGeneral (공통), shown under every type filter.

// Order matters: check longer/more-specific tokens ("장루", "요루") before any
// that could substring-collide. "간" is deliberately narrow (간장애/간질환) to
// avoid false positives on unrelated words.
const EXPLICIT_TYPE_PATTERNS = [
  ["지체", /지체/],
  ["시각", /시각/],
  ["청각", /청각/],
  ["언어", /언어장애/],
  ["지적", /지적/],
  ["뇌병변", /뇌병변/],
  ["자폐성", /자폐/],
  ["정신", /정신장애/],
  ["신장", /신장장애/],
  ["심장", /심장장애/],
  ["호흡기", /호흡기/],
  ["간", /간장애|간질환/],
  ["안면", /안면장애/],
  ["장루_요루", /장루|요루/],
  ["뇌전증", /뇌전증|간질(?!환)/],
];

// Tier 2 content-inference table. Only consulted when the target text is
// generic. Keyed by disability type; values are regexes matched against
// "프로그램명 + 내용" combined. Grounded in program names actually observed
// in the 5 source files (e.g. 남구 "보행운동"/"언어재활실", 사상구 "언어치료").
const CONTENT_INFERENCE = [
  ["언어", /언어치료|언어재활|언어발달/],
  ["지적", /감각통합|인지치료|전산화인지|인지\s*발달/],
  ["지체", /보행운동|보행훈련|물리치료|로봇재활|운동재활|근력\s*강화/],
  ["청각", /수어|청각/],
  ["시각", /점자|시각/],
];

function splitTargetTokens(text) {
  return text
    .split(/[+,、·]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// "내부·비가시장애" — types whose day-to-day activity restrictions are rarely
// implied by generic 장애인 program text (unlike 지체/시각/청각 등 physical/
// sensory access barriers). Confirmed with the team: 공통(tier 3) programs
// are assumed usable by these 7 types even without an explicit mention, so
// they no longer show as 0-count dead ends in the by-type breakdown. 시각·
// 청각 are deliberately excluded — sensory access is a real constraint and
// the source data never mentions them, so those stay honestly at 0.
const INVISIBLE_DISABILITY_TYPES = ["신장", "심장", "호흡기", "간", "안면", "장루_요루", "뇌전증"];

function classify(targetText, contentText) {
  const types = new Set();
  let tier = 1;

  const tokens = splitTargetTokens(targetText);
  for (const token of tokens) {
    if (/발달장애/.test(token)) {
      types.add("지적");
      types.add("자폐성");
      continue;
    }
    for (const [type, re] of EXPLICIT_TYPE_PATTERNS) {
      if (re.test(token)) types.add(type);
    }
  }

  if (types.size === 0) {
    // Tier 1 found nothing (target text is generic, unrecognized, or empty) —
    // fall back to inferring from the program name + description.
    tier = 2;
    for (const [type, re] of CONTENT_INFERENCE) {
      if (re.test(contentText)) types.add(type);
    }
  }

  const isGeneral = types.size === 0;
  if (isGeneral) {
    tier = 3; // 공통
    for (const type of INVISIBLE_DISABILITY_TYPES) types.add(type);
  }

  const matchType = tier === 1 ? "explicit" : tier === 2 ? "inferred" : "general";
  return { disabilityTypes: [...types], isGeneral, tier, matchType };
}

// ---------------------------------------------------------------------------
// Per-source adapters → common shape
// ---------------------------------------------------------------------------

const programs = [];
let idSeq = 0;

// 남구·사상구 CSV에는 위경도/주소 컬럼 자체가 없다. 두 곳 다 구 내 단일 복지관
// 기준이므로, public/data/dongs.geojson(검증된 행정동 중심좌표)에서 각 구에
// 속한 행정동 중심의 평균을 근사 위치로 사용한다 — 실제 건물 주소가 아니라
// "구 중심" 근사값임을 locationApprox로 표시해 UI가 정직하게 구분할 수 있게 한다.
const GU_CENTROID = {
  남구: { lng: 129.089686, lat: 35.12851 },
  사상구: { lng: 128.991512, lat: 35.160674 },
};

function pushProgram(gu, center, programName, description, targetRaw, extra = {}) {
  if (!programName) return;
  const { disabilityTypes, isGeneral, tier, matchType } = classify(targetRaw, `${programName} ${description}`);
  programs.push({
    id: `w-${idSeq++}`,
    gu,
    center,
    programName,
    description: description || undefined,
    targetRaw: targetRaw || undefined,
    schedule: extra.schedule || undefined,
    address: extra.address || undefined,
    lng: extra.lng ?? undefined,
    lat: extra.lat ?? undefined,
    locationApprox: extra.locationApprox || undefined,
    phone: extra.phone || undefined,
    disabilityTypes,
    isGeneral,
    classifyTier: tier,
    matchType,
  });
}

// --- 남구: 프로그램명,내용,대상,일시,장소,기준일자 (UTF-8 BOM, single center, no coords) ---
function loadNamgu() {
  const file = path.join(DOWNLOADS, "부산광역시 남구_장애인복지관프로그램현황_20260420.csv");
  const centroid = GU_CENTROID["남구"];
  for (const rec of readRecords(file, "utf-8")) {
    pushProgram("남구", "남구장애인복지관", rec["프로그램명"], rec["내용"], rec["대상"], {
      schedule: rec["일시"],
      address: rec["장소"],
      lng: centroid.lng,
      lat: centroid.lat,
      locationApprox: true,
    });
  }
}

// --- 사상구: 프로그램대상,프로그램명,내용,대상 (CP949, single center "라라 아카데미", no coords) ---
function loadSasang() {
  const file = path.join(DOWNLOADS, "부산광역시_사상구_장애인복지관프로그램현황_20240708.csv");
  const centroid = GU_CENTROID["사상구"];
  for (const rec of readRecords(file, "euc-kr")) {
    pushProgram(
      "사상구",
      "사상구장애인복지관 (라라 아카데미)",
      rec["프로그램명"],
      rec["내용"],
      rec["대상"],
      {
        schedule: rec["프로그램대상"], // life-stage tag (아동기/성인기/공통), kept as schedule-ish note
        lng: centroid.lng,
        lat: centroid.lat,
        locationApprox: true,
      },
    );
  }
}

// --- 금정구/사하구/영도구: shared 20-column schema (UTF-8 BOM, per-row 복지관명/위경도) ---
function loadStandard20col(fileName, gu) {
  const file = path.join(DOWNLOADS, fileName);
  for (const rec of readRecords(file, "utf-8")) {
    const target = [rec["이용대상명"], rec["이용대상상세조건명"]].filter(Boolean).join("+");
    const lng = parseFloat(rec["경도"]);
    const lat = parseFloat(rec["위도"]);
    const timeRange = [rec["이용시작시각"], rec["이용종료시각"]].filter(Boolean).join("~");
    pushProgram(gu, rec["복지관명"] || `${gu}장애인복지관`, rec["프로그램명"], rec["프로그램내용"], target, {
      schedule: timeRange || rec["이용세부내용"],
      address: rec["소재지도로명주소"] || rec["소재지지번주소"],
      lng: Number.isFinite(lng) ? Math.round(lng * 1e6) / 1e6 : undefined,
      lat: Number.isFinite(lat) ? Math.round(lat * 1e6) / 1e6 : undefined,
      phone: rec["전화번호"],
    });
  }
}

loadNamgu();
loadSasang();
loadStandard20col("부산광역시_금정구_장애인복지관운영프로그램_20251223.csv", "금정구");
loadStandard20col("부산광역시_사하구_장애인복지관운영프로그램_20251223.csv", "사하구");
loadStandard20col("부산광역시_영도구_장애인복지관운영프로그램_20260112.csv", "영도구");

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const byTypeMap = new Map(DISABILITY_TYPES.map((t) => [t, { type: t, total: 0, byGu: {} }]));
let generalCount = 0;

const byGuMap = new Map();
for (const p of programs) {
  const g = byGuMap.get(p.gu) ?? { gu: p.gu, total: 0, generalCount: 0, byType: {} };
  g.total += 1;
  if (p.isGeneral) g.generalCount += 1;
  for (const t of p.disabilityTypes) {
    g.byType[t] = (g.byType[t] ?? 0) + 1;
    const entry = byTypeMap.get(t);
    entry.total += 1;
    entry.byGu[p.gu] = (entry.byGu[p.gu] ?? 0) + 1;
  }
  byGuMap.set(p.gu, g);
  if (p.isGeneral) generalCount += 1;
}

const stats = {
  total: programs.length,
  generalCount,
  byType: [...byTypeMap.values()],
  byGu: [...byGuMap.values()].sort((a, b) => b.total - a.total),
};

fs.writeFileSync(OUT_PATH, JSON.stringify({ programs, stats }), "utf8");

console.log(`welfare_programs.json: ${programs.length} programs across ${byGuMap.size} 구 (공통 ${generalCount})`);
console.log("by 구:", stats.byGu.map((g) => `${g.gu} ${g.total}`).join(" · "));
console.log("by 유형:", stats.byType.map((t) => `${t.type} ${t.total}`).join(" · "));

// Spot-check sample: a few tier-2 (content-inferred) classifications, so the
// heuristic can be eyeballed rather than trusted blindly.
const tier2Samples = programs.filter((p) => p.classifyTier === 2).slice(0, 5);
if (tier2Samples.length) {
  console.log("\n내용 기반 추론 샘플:");
  for (const p of tier2Samples) {
    console.log(`  [${p.disabilityTypes.join(",")}] ${p.programName} (대상: ${p.targetRaw})`);
  }
}
