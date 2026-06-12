// kakao_fetch.js
// 카카오 Local API 카테고리 반경검색으로 각 가게의 "실제 가게 페이지 링크(place_url)"를 수집.
//   - place_url 예: https://place.map.kakao.com/27381470  (네이버 place 페이지와 동급의 실제 가게 링크)
//   - 카카오는 1쿼리당 최대 45개(3페이지×15)만 반환 → 400m 영역을 격자로 쪼개 질의 후 place id로 중복제거
//   - 전 항목 좌표검증 + 중심(스테이트타워남산)에서 haversine 직선거리 ≤ RADIUS
//
// REST 키 준비(무료): https://developers.kakao.com → 앱 생성 → REST API 키 복사
//   실행: KAKAO_REST_KEY=발급키 node kakao_fetch.js
//   또는: 파일 kakao_key.txt 에 키 한 줄 저장 후 node kakao_fetch.js
const https = require("https");
const fs = require("fs");

const CENTER = { lat: 37.5601376, lon: 126.9829440, name: "스테이트타워남산", address: "서울 중구 퇴계로 100" };
const RADIUS = 400;            // 중심에서 최종 거리필터(m)
const CATEGORIES = ["FD6", "CE7"]; // FD6=음식점, CE7=카페
const GRID_STEP = 150;         // 격자 간격(m)
const CELL_RADIUS = 140;       // 셀당 검색반경(m, 약간 겹치게)

function getKey() {
  if (process.env.KAKAO_REST_KEY) return process.env.KAKAO_REST_KEY.trim();
  try { return fs.readFileSync(__dirname + "/kakao_key.txt", "utf8").trim(); } catch (e) { return null; }
}

function haversine(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function mapCategory(name) {
  return "기타"; // 카카오 category_name으로 채움(아래에서 덮어씀)
}

// 카카오 category_name(예: "음식점 > 한식 > 곰탕") → 우리 분류
function kakaoCat(catName) {
  const c = catName || "";
  if (c.includes("카페") || c.includes("디저트") || c.includes("베이커리") || c.includes("제과")) return "카페디저트";
  if (c.includes("중식") || c.includes("중국")) return "중식";
  if (c.includes("일식") || c.includes("초밥") || c.includes("돈까스") || c.includes("라멘") || c.includes("우동")) return "일식";
  if (c.includes("분식")) return "분식";
  if (c.includes("패스트푸드") || c.includes("햄버거") || c.includes("피자") || c.includes("치킨")) return c.includes("치킨") ? "한식" : "패스트푸드";
  if (c.includes("양식") || c.includes("이탈리") || c.includes("프랑스") || c.includes("스테이크")) return "양식";
  if (c.includes("아시아") || c.includes("베트남") || c.includes("태국") || c.includes("인도")) return "아시안";
  if (c.includes("국수") || c.includes("냉면") || c.includes("칼국수") || c.includes("면")) return "면류";
  if (c.includes("술집") || c.includes("호프") || c.includes("바") || c.includes("이자카야")) return "주점";
  if (c.includes("한식") || c.includes("한정식") || c.includes("고기") || c.includes("국밥")) return "한식";
  return "기타";
}

function kakaoGet(key, cat, lon, lat, page) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${cat}&x=${lon}&y=${lat}&radius=${CELL_RADIUS}&size=15&page=${page}&sort=distance`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: "KakaoAK " + key, "User-Agent": "wheel-of-fortune/2.0" } }, (res) => {
      let s = ""; res.on("data", (d) => (s += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " " + s.slice(0, 120)));
        try { resolve(JSON.parse(s)); } catch (e) { reject(new Error("non-JSON")); }
      });
    }).on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const key = getKey();
  if (!key) { console.error("REST 키 없음. KAKAO_REST_KEY 환경변수 또는 kakao_key.txt 필요."); process.exit(1); }

  // 격자 좌표 생성
  const mLat = 1 / 111320, mLon = 1 / (111320 * Math.cos(CENTER.lat * Math.PI / 180));
  const span = RADIUS + GRID_STEP; // 여유
  const cells = [];
  for (let dy = -span; dy <= span; dy += GRID_STEP)
    for (let dx = -span; dx <= span; dx += GRID_STEP)
      cells.push({ lat: CENTER.lat + dy * mLat, lon: CENTER.lon + dx * mLon });

  console.log(`격자 ${cells.length}셀 × 카테고리 ${CATEGORIES.length} 질의...`);
  const byId = new Map();
  let calls = 0;
  for (const cat of CATEGORIES) {
    for (const cell of cells) {
      for (let page = 1; page <= 3; page++) {
        let data;
        try { data = await kakaoGet(key, cat, cell.lon, cell.lat, page); }
        catch (e) { console.log("  쿼리실패:", e.message); break; }
        calls++;
        for (const d of data.documents || []) {
          if (!byId.has(d.id)) byId.set(d.id, d);
        }
        if (!data.documents || data.documents.length < 15 || (data.meta && data.meta.is_end)) break;
        await sleep(60);
      }
    }
    console.log(`  ${cat} 누적 고유 ${byId.size}곳 (호출 ${calls})`);
  }

  // 거리필터 + 정리
  let items = [...byId.values()].map((d) => {
    const lat = +d.y, lon = +d.x;
    return {
      name: d.place_name,
      category: kakaoCat(d.category_name),
      kakaoCategory: d.category_name,
      distance_m: haversine(CENTER, { lat, lon }),
      lat, lon,
      kakaoId: d.id,
      phone: d.phone || "",
      address: d.road_address_name || d.address_name || "",
      placeUrl: d.place_url, // 실제 카카오 가게 페이지
      naverMapUrl: "https://map.naver.com/p/search/" + encodeURIComponent(d.place_name),
    };
  }).filter((e) => e.distance_m <= RADIUS);
  items.sort((a, b) => a.distance_m - b.distance_m);
  items = items.map((e, i) => ({ id: i + 1, ...e }));

  const out = {
    meta: {
      center: CENTER.name, center_coords: { lat: CENTER.lat, lon: CENTER.lon }, address: CENTER.address,
      radius_m: RADIUS, count: items.length,
      method: "Kakao Local 카테고리 반경검색(격자 타일링+중복제거) + haversine. 각 항목 placeUrl=실제 카카오 가게 페이지.",
      source: "Kakao Local API (dapi.kakao.com), 생성 스크립트 kakao_fetch.js",
      caveat: "직선거리 기준. placeUrl은 카카오맵 가게 페이지(네이버 place 페이지와 동급). 영업여부는 방문 전 확인.",
    },
    restaurants: items,
  };
  fs.writeFileSync(__dirname + "/restaurants.json", JSON.stringify(out, null, 2) + "\n");
  fs.writeFileSync(__dirname + "/restaurants.js", "window.RESTAURANT_DATA = " + JSON.stringify(out) + ";\n");
  const byCat = {}; items.forEach((r) => (byCat[r.category] = (byCat[r.category] || 0) + 1));
  console.log("생성완료:", items.length, "곳 (전부 ≤" + RADIUS + "m, placeUrl 포함)");
  console.log("카테고리:", JSON.stringify(byCat));
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
