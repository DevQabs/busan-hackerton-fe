// Builds public/data/tourism.json ("관광지 사각지대") from TourAPI-style xlsx
// exports (관광지/문화시설/레포츠/숙박 sheets) and cross-references barrier-free
// status against public/data/infra_points.json (type "tourism", already built
// by the Python pipeline from 한국문화정보원_전국 배리어프리 문화예술관광지).
//
// Run: node scripts/build_tourism.mjs
// Input paths (raw xlsx exports) are hardcoded below, matching the convention
// in pipeline/build_all.py (external raw inputs live outside the repo).

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DOWNLOADS = "C:\\Users\\김태국\\Downloads";
const SOURCE_FILES = [
  "20267141784037310293.xlsx",
  "20267141784037055322.xlsx",
  "20267141784037259555.xlsx",
  "20267141784037275361.xlsx",
  "20267141784037285492.xlsx",
  "20267141784037297032.xlsx",
].map((f) => path.join(DOWNLOADS, f));

const INFRA_POINTS_PATH = path.join(ROOT, "public", "data", "infra_points.json");
const OUT_PATH = path.join(ROOT, "public", "data", "tourism.json");

// Sheets that represent standing, visitable locations. 축제공연행사 (festivals)
// are date-bound events, not places with daily opening hours — excluded.
const CATEGORY_SHEETS = ["관광지", "문화시설", "레포츠", "숙박"];

const WEEKDAY_CHARS = ["월", "화", "수", "목", "금"];
const WEEKEND_CHARS = ["토", "일"];
const ALL_DAY_CHARS = [...WEEKDAY_CHARS, ...WEEKEND_CHARS];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function extractGu(address) {
  const m = (address || "").match(/부산광역시\s*([가-힣]+(?:구|군))/);
  return m ? m[1] : "기타";
}

/** 쉬는날 free text → which weekdays/weekend days are NOT closed. */
function parseClosedInfo(raw) {
  const s = (raw || "").trim();
  if (!s || /연중무휴|없음|해당없음/.test(s)) {
    return { openWeekday: true, openWeekend: true };
  }
  const closed = new Set(ALL_DAY_CHARS.filter((d) => s.includes(d)));
  return {
    openWeekday: WEEKDAY_CHARS.some((d) => !closed.has(d)),
    openWeekend: WEEKEND_CHARS.some((d) => !closed.has(d)),
  };
}

/** 이용시간 free text → alwaysOpen / open-close hour (best-effort, first match). */
function parseHours(raw) {
  const s = (raw || "").trim();
  if (!s) return { alwaysOpen: false, hoursUnknown: true, openHour: null, closeHour: null };
  if (/상시\s*개방|24시간/.test(s)) {
    return { alwaysOpen: true, hoursUnknown: false, openHour: null, closeHour: null };
  }
  const m = s.match(/(\d{1,2}):(\d{2})\s*[~\-]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    return {
      alwaysOpen: false,
      hoursUnknown: false,
      openHour: Math.min(23, parseInt(m[1], 10)),
      closeHour: Math.min(24, parseInt(m[3], 10)),
    };
  }
  return { alwaysOpen: false, hoursUnknown: true, openHour: null, closeHour: null };
}

function haversineM(lng1, lat1, lng2, lat2) {
  const r = 6371008.8;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const normalizeName = (s) => (s || "").replace(/[\s()（）·・"'“”'‘]/g, "");

// "관광지 사각지대" coverage thresholds (straight-line distance).
const THRESHOLDS_M = { charger: 2000, hospital: 500, welfare: 1000 };
const LACK_LABEL = {
  charger: "충전소 2km 밖",
  hospital: "병의원 500m 밖",
  welfare: "복지시설 1km 밖",
};

// ---------------------------------------------------------------------------
// Load infra reference layers (charger/hospital/welfare for the blind-spot
// ranking, tourism for the barrier-free cross-reference)
// ---------------------------------------------------------------------------

const infraPoints = JSON.parse(fs.readFileSync(INFRA_POINTS_PATH, "utf8"));
const barrierFreePoints = infraPoints
  .filter((p) => p.type === "tourism")
  .map((p) => ({ name: p.name, normName: normalizeName(p.name), lng: p.lng, lat: p.lat }));

const infraByType = {
  charger: infraPoints.filter((p) => p.type === "charger"),
  hospital: infraPoints.filter((p) => p.type === "hospital"),
  welfare: infraPoints.filter((p) => p.type === "welfare"),
};

function isBarrierFree(name, lng, lat) {
  const norm = normalizeName(name);
  for (const bp of barrierFreePoints) {
    if (bp.normName === norm) return true;
  }
  for (const bp of barrierFreePoints) {
    if (haversineM(lng, lat, bp.lng, bp.lat) <= 80) return true;
  }
  return false;
}

function nearestDistanceM(lng, lat, points) {
  let best = null;
  for (const p of points) {
    const d = haversineM(lng, lat, p.lng, p.lat);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** Blind-spot facts vs. the coverage thresholds — computed for every site so
 *  the UI can show them in a detail card, but the ranking itself (in the UI)
 *  only considers non-barrier-free sites, per the brief. */
function blindSpotFacts(lng, lat) {
  const nearestM = {
    charger: nearestDistanceM(lng, lat, infraByType.charger),
    hospital: nearestDistanceM(lng, lat, infraByType.hospital),
    welfare: nearestDistanceM(lng, lat, infraByType.welfare),
  };
  const lack = [];
  let score = 0;
  for (const key of ["charger", "hospital", "welfare"]) {
    const d = nearestM[key];
    const threshold = THRESHOLDS_M[key];
    if (d === null || d > threshold) {
      lack.push(LACK_LABEL[key]);
      score += d === null ? 1 : d / threshold - 1;
    }
  }
  return { nearestM, lack, blindSpotScore: Math.round(score * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Read xlsx sheets
// ---------------------------------------------------------------------------

function sheetToRecords(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((row) => {
    const rec = {};
    headers.forEach((h, i) => {
      rec[h] = typeof row[i] === "string" ? row[i].trim() : row[i];
    });
    return rec;
  });
}

const sites = [];
const seen = new Set();
let skippedBadCoord = 0;

for (const filePath of SOURCE_FILES) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  for (const category of CATEGORY_SHEETS) {
    if (!wb.SheetNames.includes(category)) continue;
    const records = sheetToRecords(wb.Sheets[category]);
    for (const rec of records) {
      const name = rec["명칭"];
      const lng = parseFloat(rec["경도"]);
      const lat = parseFloat(rec["위도"]);
      if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
        skippedBadCoord += 1;
        continue;
      }
      // Busan sanity bbox — a few source rows carry stray/typo coordinates.
      if (lat < 34.9 || lat > 35.5 || lng < 128.7 || lng > 129.5) {
        skippedBadCoord += 1;
        continue;
      }
      const address = rec["주소"] || "";
      const key = `${name}@${address}`;
      if (seen.has(key)) continue; // same site re-listed across export files
      seen.add(key);

      const hoursRaw = category === "숙박" ? "" : rec["이용시간"] || "";
      const closedRaw = category === "숙박" ? "" : rec["쉬는날"] || "";
      const hours =
        category === "숙박"
          ? { alwaysOpen: true, hoursUnknown: false, openHour: null, closeHour: null }
          : parseHours(hoursRaw);
      const closedInfo =
        category === "숙박"
          ? { openWeekday: true, openWeekend: true }
          : parseClosedInfo(closedRaw);

      const blindSpot = blindSpotFacts(lng, lat);

      sites.push({
        id: `t-${sites.length}`,
        name,
        category,
        lng: Math.round(lng * 1e6) / 1e6,
        lat: Math.round(lat * 1e6) / 1e6,
        address,
        gu: extractGu(address),
        phone: rec["전화번호"] || undefined,
        hoursRaw,
        closedRaw,
        alwaysOpen: hours.alwaysOpen,
        hoursUnknown: hours.hoursUnknown,
        openHour: hours.openHour,
        closeHour: hours.closeHour,
        openWeekday: closedInfo.openWeekday,
        openWeekend: closedInfo.openWeekend,
        barrierFree: isBarrierFree(name, lng, lat),
        nearestM: blindSpot.nearestM,
        lack: blindSpot.lack,
        blindSpotScore: blindSpot.blindSpotScore,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function share(bf, total) {
  return total > 0 ? bf / total : 0;
}

const byCategoryMap = new Map();
const byGuMap = new Map();
for (const s of sites) {
  const c = byCategoryMap.get(s.category) ?? { category: s.category, total: 0, barrierFree: 0 };
  c.total += 1;
  if (s.barrierFree) c.barrierFree += 1;
  byCategoryMap.set(s.category, c);

  const g = byGuMap.get(s.gu) ?? { gu: s.gu, total: 0, barrierFree: 0 };
  g.total += 1;
  if (s.barrierFree) g.barrierFree += 1;
  byGuMap.set(s.gu, g);
}

const totalBarrierFree = sites.filter((s) => s.barrierFree).length;

const stats = {
  total: sites.length,
  barrierFree: totalBarrierFree,
  barrierFreeShare: share(totalBarrierFree, sites.length),
  byCategory: [...byCategoryMap.values()]
    .map((c) => ({ ...c, share: share(c.barrierFree, c.total) }))
    .sort((a, b) => b.total - a.total),
  byGu: [...byGuMap.values()]
    .map((g) => ({ ...g, share: share(g.barrierFree, g.total) }))
    .sort((a, b) => b.total - a.total),
};

fs.writeFileSync(OUT_PATH, JSON.stringify({ sites, stats }), "utf8");

console.log(
  `tourism.json: ${sites.length} sites (${totalBarrierFree} barrier-free, ` +
    `${(stats.barrierFreeShare * 100).toFixed(1)}%) — skipped ${skippedBadCoord} bad rows`,
);
console.log("by category:", stats.byCategory.map((c) => `${c.category} ${c.total}`).join(" · "));
