// Builds public/data/disability.json ("장애인 수요 분석") from the 16 구·군
// 장애인 등록현황 파일(CSV/xlsx) plus the 두리발 운영 로그 (2025-05). 등록
// 장애인 수(잠재 수요)와 완료 운행(실제 이용)을 구 단위로 교차 집계한다.
//
// Run: node scripts/build_disability.mjs
// 초기 제공 9개 구 CSV는 CP949, 추가 제공 7개 구는 UTF-8(BOM) CSV 또는 xlsx —
// readCsv가 BOM으로 인코딩을 분기한다. 구마다 스키마가 제각각이라 구별 전용
// 파서를 두고, 공통 구조로 정규화한다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(ROOT, "..", "data");

const OUT_PATH = path.join(ROOT, "public", "data", "disability.json");
const DONGS_PATH = path.join(ROOT, "public", "data", "dongs.geojson");

const TRIP_LOG = path.join(
  DATA_DIR,
  "부산시설공단_부산 교통약자 이동지원 차량 운영현황_20250501.csv",
);

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

const cp949 = new TextDecoder("euc-kr");
function readCsv(p) {
  const buf = fs.readFileSync(p);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf8").slice(1); // UTF-8 BOM(﻿) 제거
  }
  return cp949.decode(buf);
}

/** xlsx 첫 시트를 2차원 배열로 (빈 셀 = undefined/null). */
function xlsxRows(p) {
  const wb = XLSX.readFile(p);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
}

/** 따옴표 인지 CSV 라인 파서 — 영도구의 "1,466" 같은 천단위 콤마 필드와
 *  로그의 주소 내 콤마를 안전하게 처리한다. */
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function rows(p) {
  return readCsv(p)
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map(parseLine);
}

const toNum = (s) => {
  const n = parseInt(String(s).replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

/** 등록현황 공통 장애유형 15종 (보건복지부 분류). */
const TYPES = [
  "지체", "시각", "청각", "언어", "지적", "뇌병변", "자폐성", "정신",
  "신장", "심장", "호흡기", "간", "안면", "장루·요루", "뇌전증",
];

/** 구별 표기 편차(장루.요루/장루_요루/장루요루/장루(요루), 호흡 등) 통일.
 *  15종 밖의 표기가 나오면 즉시 실패시켜 조기에 오타를 잡는다. */
function normalizeType(raw) {
  const s = String(raw).trim();
  if (/^장루[.,·_]?\(?요루\)?$/.test(s)) return "장루·요루";
  if (s === "호흡") return "호흡기";
  if (!TYPES.includes(s)) {
    throw new Error(`알 수 없는 장애유형 표기: "${raw}"`);
  }
  return s;
}

const emptyType = (type) => ({
  type,
  total: 0,
  severe: null,
  mild: null,
  male: null,
  female: null,
});

// ---------------------------------------------------------------------------
// 구별 등록현황 파서 — 반환 형태를 통일한다:
// { asOf, registered, severe, mild, male, female, hearingMerged, byType: Map }
// (산출 불가 필드는 null)
// ---------------------------------------------------------------------------

function sumBy(byType, key) {
  let s = 0;
  for (const t of byType.values()) {
    if (t[key] === null) return null;
    s += t[key];
  }
  return s;
}

function fromByType(asOf, byType, hearingMerged = false) {
  return {
    asOf,
    registered: sumBy(byType, "total"),
    severe: sumBy(byType, "severe"),
    mild: sumBy(byType, "mild"),
    male: sumBy(byType, "male"),
    female: sumBy(byType, "female"),
    hearingMerged,
    byType,
  };
}

/** 북구: 구분,심한 장애,심하지 않은 장애 (성별 없음) */
function parseBukgu(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[0]);
    const severe = toNum(r[1]);
    const mild = toNum(r[2]);
    byType.set(type, { ...emptyType(type), total: severe + mild, severe, mild });
  }
  return fromByType("2025-12-31", byType);
}

/** 남구: 장애유형,전체(남),전체(여),심한,심한(남),심한(여),심하지,심하지(남),심하지(여).
 *  파일명·본문에 기준일 없음 → asOf null. */
function parseNamgu(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[0]);
    const male = toNum(r[1]);
    const female = toNum(r[2]);
    const severe = toNum(r[3]);
    const mild = toNum(r[6]);
    const total = male + female;
    if (severe + mild !== total) {
      throw new Error(`남구 ${type}: 심한+심하지(${severe + mild}) ≠ 남+여(${total})`);
    }
    byType.set(type, { type, total, severe, mild, male, female });
  }
  return fromByType(null, byType);
}

/** 중구: 동명,장애유형,심한 남,심한 여,심하지 남,심하지 여 — 동별 행을 유형으로
 *  합산. 0인 유형 행은 생략된 희소 구조라 15종 고정 가정 없이 누적한다. */
function parseJunggu(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[1]);
    const cur = byType.get(type) ?? { type, total: 0, severe: 0, mild: 0, male: 0, female: 0 };
    const sm = toNum(r[2]);
    const sf = toNum(r[3]);
    const mm = toNum(r[4]);
    const mf = toNum(r[5]);
    cur.severe += sm + sf;
    cur.mild += mm + mf;
    cur.male += sm + mm;
    cur.female += sf + mf;
    cur.total += sm + sf + mm + mf;
    byType.set(type, cur);
  }
  return fromByType("2026-06-29", byType);
}

/** 동구: 전치형 — 1행이 유형 헤더(계 + 15종), 이후 구분별 행
 *  (등록 장애인수/심한장애/심하지않은장애/남성/여성). */
function parseDonggu(p) {
  const table = rows(p);
  const header = table[0]; // 구분,계,지체,...
  const types = header.slice(2).map(normalizeType);
  const rowOf = {};
  for (const r of table.slice(1)) rowOf[r[0].trim()] = r;
  const pick = (label, i) => toNum(rowOf[label][i + 2]);

  const byType = new Map();
  types.forEach((type, i) => {
    const total = pick("등록 장애인수", i);
    const severe = pick("심한장애", i);
    const mild = pick("심하지않은장애", i);
    const male = pick("남성", i);
    const female = pick("여성", i);
    if (severe + mild !== total || male + female !== total) {
      throw new Error(`동구 ${type}: 구성 합 불일치 (total ${total})`);
    }
    byType.set(type, { type, total, severe, mild, male, female });
  });
  const sum = sumBy(byType, "total");
  const gye = toNum(rowOf["등록 장애인수"][1]);
  if (sum !== gye) throw new Error(`동구: 유형 합(${sum}) ≠ 계(${gye})`);
  return fromByType("2026-02-28", byType);
}

/** 영도구: 장애유형,심한 남,심한 여,심하지 남,심하지 여 (천단위 콤마 인용부호) */
function parseYeongdogu(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[0]);
    const sm = toNum(r[1]);
    const sf = toNum(r[2]);
    const mm = toNum(r[3]);
    const mf = toNum(r[4]);
    byType.set(type, {
      type,
      total: sm + sf + mm + mf,
      severe: sm + sf,
      mild: mm + mf,
      male: sm + mm,
      female: sf + mf,
    });
  }
  return fromByType("2026-06-30", byType);
}

/** 사상구: 장애유형,합계,남,여,심한(소계/남/여),심하지(소계/남/여) — 소계로 교차검증 */
function parseSasanggu(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[0]);
    const total = toNum(r[1]);
    const male = toNum(r[2]);
    const female = toNum(r[3]);
    const severe = toNum(r[4]);
    const mild = toNum(r[7]);
    if (male + female !== total || severe + mild !== total) {
      throw new Error(`사상구 ${type}: 구성 합 불일치 (total ${total})`);
    }
    if (toNum(r[5]) + toNum(r[6]) !== severe) {
      throw new Error(`사상구 ${type}: 심한 장애 남녀 합 ≠ 소계`);
    }
    byType.set(type, { type, total, severe, mild, male, female });
  }
  return fromByType("2026-03-19", byType);
}

/** 사하구: 연번,장애유형,인원수,데이터기준일자 — 유형별 총계만 */
function parseSahagu(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[1]);
    byType.set(type, { ...emptyType(type), total: toNum(r[2]) });
  }
  return fromByType("2026-06-11", byType);
}

/** 강서구: 단일 행 — 남,여,유형 14열(청각(언어) 병합),심한장애,심하지않은장애.
 *  유형별 정도·성별은 없고 구 총계만 존재. 병합분은 청각에 계상, 언어는 null. */
function parseGangseogu(p) {
  const [header, data] = rows(p);
  const byType = new Map();
  let male = null;
  let female = null;
  let severe = null;
  let mild = null;
  header.forEach((rawCol, i) => {
    const col = rawCol.trim();
    const v = toNum(data[i]);
    if (col === "남") male = v;
    else if (col === "여") female = v;
    else if (col === "심한장애") severe = v;
    else if (col === "심하지않은장애") mild = v;
    else if (col === "청각(언어)") {
      byType.set("청각", { ...emptyType("청각"), total: v });
      byType.set("언어", { ...emptyType("언어"), total: null });
    } else {
      const type = normalizeType(col);
      byType.set(type, { ...emptyType(type), total: v });
    }
  });
  const registered = male + female;
  let typeSum = 0;
  for (const t of byType.values()) typeSum += t.total ?? 0;
  if (typeSum !== registered || severe + mild !== registered) {
    throw new Error(`강서구: 유형 합(${typeSum}) / 심한+심하지(${severe + mild}) ≠ 남+여(${registered})`);
  }
  return {
    asOf: "2025-09-18",
    registered,
    severe,
    mild,
    male,
    female,
    hearingMerged: true,
    byType,
  };
}

/** 기장군: 장애유형,남성(경증),남성(중증),여성(경증),여성(중증) — 중증=심한 장애 */
function parseGijanggun(p) {
  const byType = new Map();
  for (const r of rows(p).slice(1)) {
    const type = normalizeType(r[0]);
    const maleMild = toNum(r[1]);
    const maleSevere = toNum(r[2]);
    const femaleMild = toNum(r[3]);
    const femaleSevere = toNum(r[4]);
    byType.set(type, {
      type,
      total: maleMild + maleSevere + femaleMild + femaleSevere,
      severe: maleSevere + femaleSevere,
      mild: maleMild + femaleMild,
      male: maleMild + maleSevere,
      female: femaleMild + femaleSevere,
    });
  }
  return fromByType("2024-05-20", byType);
}

/** 동래·서구·부산진·해운대 공통 스키마(UTF-8 BOM):
 *  장애유형,합계_계,합계_남성,합계_여성,심한장애_소계/남성/여성,심하지않은장애_소계/남성/여성
 *  — 첫 데이터행이 "합계" 행이라 유형 합과 교차검증한다. */
const parseStandard = (asOf) => (p) => {
  const table = rows(p);
  const totalRow = table[1];
  if (totalRow[0].trim() !== "합계") {
    throw new Error(`${path.basename(p)}: 합계 행이 없습니다`);
  }
  const byType = new Map();
  for (const r of table.slice(2)) {
    const type = normalizeType(r[0]);
    const total = toNum(r[1]);
    const male = toNum(r[2]);
    const female = toNum(r[3]);
    const severe = toNum(r[4]);
    const mild = toNum(r[7]);
    if (male + female !== total || severe + mild !== total) {
      throw new Error(`${path.basename(p)} ${type}: 구성 합 불일치 (total ${total})`);
    }
    byType.set(type, { type, total, severe, mild, male, female });
  }
  const out = fromByType(asOf, byType);
  if (
    out.registered !== toNum(totalRow[1]) ||
    out.male !== toNum(totalRow[2]) ||
    out.severe !== toNum(totalRow[4])
  ) {
    throw new Error(`${path.basename(p)}: 유형 합 ≠ 합계 행`);
  }
  return out;
};

/** 연제구: 읍면동,장애유형,합계_계,남,여,심한_소계,남,여,심하지_소계,남,여 —
 *  동별 행을 유형으로 합산(소계 행 제외, 중구 파서 패턴), 합계 행과 교차검증. */
function parseYeonjegu(p) {
  const table = rows(p);
  const totalRow = table[1];
  const byType = new Map();
  for (const r of table.slice(2)) {
    if (r[1].trim() === "소계") continue;
    const type = normalizeType(r[1]);
    const cur = byType.get(type) ?? { type, total: 0, severe: 0, mild: 0, male: 0, female: 0 };
    cur.total += toNum(r[2]);
    cur.male += toNum(r[3]);
    cur.female += toNum(r[4]);
    cur.severe += toNum(r[5]);
    cur.mild += toNum(r[8]);
    byType.set(type, cur);
  }
  const out = fromByType("2026-03", byType);
  if (
    out.registered !== toNum(totalRow[2]) ||
    out.male !== toNum(totalRow[3]) ||
    out.severe !== toNum(totalRow[5])
  ) {
    throw new Error("연제구: 동별 합 ≠ 합계 행");
  }
  return out;
}

/** 금정구 xlsx: 제목 2행 + 헤더 2행 + "합계" 행 뒤 동별 행 — 열 구조는 연제구와
 *  동일(읍면동,장애유형,계,남,여,심한 계/남/여,심하지 계/남/여). */
function parseGeumjeonggu(p) {
  const table = xlsxRows(p);
  const totalRow = table[5];
  if (totalRow?.[0] !== "합계") throw new Error("금정구: 합계 행 위치가 다릅니다");
  const byType = new Map();
  for (const r of table.slice(6)) {
    if (!r?.length || String(r[1]).trim() === "소계") continue;
    const type = normalizeType(r[1]);
    const cur = byType.get(type) ?? { type, total: 0, severe: 0, mild: 0, male: 0, female: 0 };
    cur.total += toNum(r[2]);
    cur.male += toNum(r[3]);
    cur.female += toNum(r[4]);
    cur.severe += toNum(r[5]);
    cur.mild += toNum(r[8]);
    byType.set(type, cur);
  }
  const out = fromByType("2026-05", byType);
  if (
    out.registered !== toNum(totalRow[2]) ||
    out.male !== toNum(totalRow[3]) ||
    out.severe !== toNum(totalRow[5])
  ) {
    throw new Error("금정구: 동별 합 ≠ 합계 행");
  }
  return out;
}

/** 수영구 xlsx: 구 단위 단일 표 — 3열이 장애유형인 행만 집계(제목·헤더·소계·
 *  출력정보 행은 3열이 비거나 유형이 아님), "합계" 행으로 교차검증. */
function parseSuyeonggu(p) {
  const byType = new Map();
  let totalRow = null;
  for (const r of xlsxRows(p)) {
    if (r?.[0] === "합계") {
      totalRow = r;
      continue;
    }
    const label = typeof r?.[2] === "string" ? r[2].trim() : "";
    if (!label || label === "소계" || label === "장애유형") continue;
    const type = normalizeType(label);
    const total = toNum(r[3]);
    const male = toNum(r[4]);
    const female = toNum(r[5]);
    const severe = toNum(r[6]);
    const mild = toNum(r[9]);
    if (male + female !== total || severe + mild !== total) {
      throw new Error(`수영구 ${type}: 구성 합 불일치 (total ${total})`);
    }
    byType.set(type, { type, total, severe, mild, male, female });
  }
  const out = fromByType("2026-01", byType);
  if (
    !totalRow ||
    out.registered !== toNum(totalRow[3]) ||
    out.severe !== toNum(totalRow[6])
  ) {
    throw new Error("수영구: 유형 합 ≠ 합계 행");
  }
  return out;
}

const REGISTRY_SOURCES = [
  ["북구", "부산광역시_북구_장애인등록현황_20251231.csv", parseBukgu],
  ["남구", "부산광역시_남구_장애인유형별등급별등록현황.csv", parseNamgu],
  ["중구", "부산광역시 중구_장애인 등록 현황_20260629.csv", parseJunggu],
  ["동구", "부산광역시 동구 장애인 등록 현황_20260228.csv", parseDonggu],
  ["영도구", "부산광역시 영도구_장애유형별 장애인 등록현황_20260630.csv", parseYeongdogu],
  ["사상구", "부산광역시_사상구_장애인등록 현황_20260319.csv", parseSasanggu],
  ["사하구", "부산광역시_사하구_장애인등록인수 현황_20260611.csv", parseSahagu],
  ["강서구", "부산광역시_강서구_장애등록_20250918.csv", parseGangseogu],
  ["기장군", "부산광역시_기장군_장애인등록현황_20240520.csv", parseGijanggun],
  // 추가 제공분 (2026-07-16) — 이로써 16개 구·군 전체 커버
  ["동래구", "부산광역시 동래구_2025년_장애인등록현황.csv", parseStandard(null)], // 파일명에 "2025년"만 있어 기준일 미상
  ["서구", "부산광역시_서구_2026-02_장애인등록현황.csv", parseStandard("2026-02")],
  ["부산진구", "부산광역시_진구_2026-05_장애인등록현황.csv", parseStandard("2026-05")],
  ["해운대구", "해운대구_2026-03_장애인등록현황.csv", parseStandard("2026-03")],
  ["연제구", "부산광역시_연제구_2026-03_장애인등록현황.csv", parseYeonjegu],
  ["금정구", "부산광역시_금정구_2026-05_장애인등록현황.xlsx", parseGeumjeonggu],
  ["수영구", "부산광역시_수영구_2026-01_장애인유형및장애정도별등록현황.xlsx", parseSuyeonggu],
];

// ---------------------------------------------------------------------------
// 두리발 로그 집계 (2025-05, 완료 운행 = 결과 '하차')
// ---------------------------------------------------------------------------

/** 로그의 장애유형(두리발 자체 분류)을 등록현황 15종으로 매핑.
 *  65세이상·일시적장애 등 비장애 교통약자는 "기타 교통약자"로 분리 집계. */
const OTHER_TYPE = "기타 교통약자";
function mapLogType(raw) {
  const s = String(raw).trim();
  if (s === "뇌병변" || s === "시각" || s === "신장" || s === "청각") return s;
  if (s === "지체" || s.startsWith("지체/")) return "지체";
  if (s === "지적장애") return "지적";
  if (s === "자폐" || s === "자폐성장애") return "자폐성";
  if (s === "뇌전증") return "뇌전증";
  return OTHER_TYPE; // 65세이상 · 일시적장애 · 국가유공자 · 중복장애 · 기타 · 빈값
}

function aggregateTrips(guSet) {
  const table = rows(TRIP_LOG);
  const idx = Object.fromEntries(table[0].map((h, i) => [h.trim(), i]));
  const need = ["결과", "출발지 행정동", "장애유형", "장애등급", "휠체어", "출발지 X좌표", "출발지 Y좌표"];
  for (const c of need) {
    if (!(c in idx)) throw new Error(`로그에 "${c}" 컬럼이 없습니다`);
  }

  const perGu = new Map(); // gu -> { trips, tripsDisabled, users:Set }
  const typeTrips = new Map();
  let completed = 0;
  let fromBusan = 0;
  let outside = 0;

  for (const r of table.slice(1)) {
    if (r[idx["결과"]] !== "하차") continue;
    completed++;

    const mapped = mapLogType(r[idx["장애유형"]]);
    typeTrips.set(mapped, (typeTrips.get(mapped) ?? 0) + 1);

    const m = (r[idx["출발지 행정동"]] ?? "").match(/부산광역시\s*([가-힣]+(?:구|군))/);
    if (!m || !guSet.has(m[1])) {
      outside++;
      continue;
    }
    fromBusan++;
    const gu = m[1];
    const cur = perGu.get(gu) ?? { trips: 0, tripsDisabled: 0, users: new Set() };
    cur.trips++;
    if (mapped !== OTHER_TYPE) cur.tripsDisabled++;
    // 이용자 ID가 없어 (출발 좌표 + 유형 + 등급 + 휠체어) 조합으로 근사 추정
    cur.users.add(
      `${r[idx["출발지 X좌표"]]}|${r[idx["출발지 Y좌표"]]}|${r[idx["장애유형"]]}|${r[idx["장애등급"]]}|${r[idx["휠체어"]]}`,
    );
    perGu.set(gu, cur);
  }

  return { perGu, typeTrips, completed, fromBusan, outside };
}

// ---------------------------------------------------------------------------
// 조립 + 검증
// ---------------------------------------------------------------------------

const dongs = JSON.parse(fs.readFileSync(DONGS_PATH, "utf8"));
const guSet = new Set(dongs.features.map((f) => f.properties.gu));
if (guSet.size !== 16) throw new Error(`dongs.geojson 구·군 수 ${guSet.size} ≠ 16`);

const registry = new Map();
for (const [gu, file, parse] of REGISTRY_SOURCES) {
  if (!guSet.has(gu)) throw new Error(`알 수 없는 구·군: ${gu}`);
  registry.set(gu, parse(path.join(DATA_DIR, file)));
}

const { perGu, typeTrips, completed, fromBusan, outside } = aggregateTrips(guSet);

if (completed !== 32526) throw new Error(`완료 운행 ${completed} ≠ 32,526 (stats.json 기준)`);
if (fromBusan + outside !== completed) throw new Error("구 매핑 합계 불일치");
if (outside > 500) throw new Error(`관외 출발 ${outside}건 — 매핑 정규식 확인 필요`);

const gus = [...guSet]
  .map((gu) => {
    const reg = registry.get(gu) ?? null;
    const t = perGu.get(gu) ?? { trips: 0, tripsDisabled: 0, users: new Set() };
    const registered = reg?.registered ?? null;
    return {
      gu,
      hasRegistry: reg !== null,
      asOf: reg?.asOf ?? null,
      registered,
      severe: reg?.severe ?? null,
      mild: reg?.mild ?? null,
      male: reg?.male ?? null,
      female: reg?.female ?? null,
      hearingMerged: reg?.hearingMerged ?? false,
      byType: reg ? TYPES.map((type) => reg.byType.get(type) ?? emptyType(type)) : [],
      trips: t.trips,
      tripsDisabled: t.tripsDisabled,
      estUsers: t.users.size,
      tripsPer1k:
        registered !== null && registered > 0
          ? Math.round((t.trips / registered) * 1000 * 10) / 10
          : null,
    };
  })
  .sort((a, b) => b.trips - a.trips);

const registeredKnown = gus.reduce((s, g) => s + (g.registered ?? 0), 0);

// 유형별 시 전체 비교 — 등록수는 등록현황 보유 구(현재 16개 전체) 합계
// (강서구 언어는 청각에 병합돼 있어 언어 등록 합계만 15개 구 기준).
const typeTotals = [...TYPES, OTHER_TYPE].map((type) => {
  let registered = null;
  if (type !== OTHER_TYPE) {
    registered = 0;
    for (const g of gus) {
      if (!g.hasRegistry) continue;
      const t = g.byType.find((x) => x.type === type);
      registered += t?.total ?? 0;
    }
  }
  return { type, registered, trips: typeTrips.get(type) ?? 0 };
});

const out = {
  period: "2025-05",
  totals: {
    registeredKnown,
    guWithRegistry: registry.size,
    completedTrips: completed,
    tripsFromBusan: fromBusan,
    tripsOutside: outside,
  },
  typeTotals,
  gus,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out), "utf8");

// ---------------------------------------------------------------------------
// 요약 출력
// ---------------------------------------------------------------------------

console.log(
  `disability.json: 등록 ${registeredKnown.toLocaleString()}명(${registry.size}개 구·군) · ` +
    `완료 운행 ${completed.toLocaleString()}건 (부산 출발 ${fromBusan.toLocaleString()} / 관외 ${outside})`,
);
for (const g of gus) {
  const regTxt = g.hasRegistry
    ? `등록 ${g.registered.toLocaleString()} (${g.asOf ?? "기준일 미상"}) · 천명당 ${g.tripsPer1k}`
    : "등록현황 미공개";
  console.log(`  ${g.gu.padEnd(5, " ")} 이용 ${String(g.trips).padStart(5)}건 · ${regTxt}`);
}
console.log(
  "유형별 이용(매핑):",
  typeTotals
    .filter((t) => t.trips > 0)
    .map((t) => `${t.type} ${t.trips.toLocaleString()}`)
    .join(" · "),
);
