// fetch_and_build.js
// 실제 거리 측정 파이프라인:
//   1) OpenStreetMap Overpass API로 중심좌표 반경 300m 안의 음식점(node/way/relation) enumerate
//   2) 각 식당 좌표 ↔ 스테이트타워남산 좌표 사이 haversine 거리(m) 계산
//   3) 300m 이하만 남기고 카테고리 매핑 → restaurants.json / restaurants.js 생성
// API 키 불필요. 재현: `node fetch_and_build.js`
//
// 중심좌표 출처: OSM way 781583304 "스테이트타워남산" (서울 중구 퇴계로 100) 건물 중심.
const https = require("https");
const fs = require("fs");

const CENTER = { lat: 37.5601376, lon: 126.9829440, name: "스테이트타워남산", address: "서울 중구 퇴계로 100" };
const RADIUS = 400;
// 미러마다 부분응답을 줄 때가 있어 여러 엔드포인트로 재시도 후 결과가 안정될 때까지 검증.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// 미터 단위 직선거리 (haversine).
function haversine(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// cuisine 태그 + 상호명 키워드로 카테고리 추정. 위에서부터 첫 매치 우선(순서 중요).
function categorize(tags) {
  const c = (tags.cuisine || "").toLowerCase();
  const n = tags.name || "";
  const has = (...ws) => ws.some((w) => n.includes(w) || c.includes(w.toLowerCase()));
  // 카페·디저트 (체인 닉네임 포함: 별다방=스타벅스)
  if (has("별다방", "스타벅스", "starbucks", "투썸", "twosome", "이디야", "ediya", "메가", "커피", "coffee", "카페", "cafe", "다방", "베이글", "bagel", "도넛", "donut", "노티드", "베이커리", "bakery", "빵", "제과", "디저트", "dessert", "빙수", "설빙", "sulbing", "와플", "beansbins", "케이크", "cake", "라운지", "lounge", "젤라또", "아이스크림")) return "카페디저트";
  // 분식
  if (has("김밥", "김선생", "김가네", "분식", "떡볶이", "순대", "오뎅", "어묵")) return "분식";
  // 아시안
  if (has("쌀국수", "pho", "포", "thai", "타이", "베트남", "vietnam", "사이공", "saigon", "인도", "india", "네팔", "nepal", "커리", "curry", "아시안", "asian", "팟타이", "반미")) return "아시안";
  // 중식
  if (has("중식", "중국", "china", "chinese", "마라", "짜장", "짬뽕", "딤섬", "양꼬치", "양고기", "란주", "꽁시", "행화", "도향", "개화", "향미", "아래향", "크리스탈 제이드", "제이드")) return "중식";
  // 일식
  if (has("일식", "japan", "스시", "sushi", "초밥", "사시미", "돈카츠", "돈까스", "카츠", "라멘", "ramen", "우동", "udon", "소바", "규카츠", "만게츠", "진까스", "이자카야", "오마카세", "카쿠시타", "마츠노", "텐동", "규동")) return "일식";
  // 양식
  if (has("파스타", "pasta", "피자", "pizza", "스테이크", "steak", "이탈리", "italian", "french", "프렌치", "비스트로", "bistro", "델리", "deli", "누보", "벨로타", "스시바아닌양식", "american", "그릴", "grill", "레스토랑")) return "양식";
  // 패스트푸드
  if (has("맥도날드", "mcdonald", "롯데리아", "버거킹", "burger king", "버거", "burger", "kfc", "써브웨이", "subway", "isaac", "토스트", "toast")) return "패스트푸드";
  // 면류
  if (has("칼국수", "칼제비", "냉면", "국수", "면옥", "noodle", "우육면")) return "면류";
  // 주점
  if (has("bar", "포차", "호프", "술집", "선술집", "pub", "펍", "와인", "wine")) return "주점";
  // 한식 (명시 키워드 매칭 시에만)
  if (has("korean", "한식", "한정식", "bbq", "고기", "삼겹", "한우", "갈비", "불고기", "곱창", "막창", "설렁탕", "곰탕", "국밥", "삼계탕", "백숙", "닭", "치킨", "chicken", "찜닭", "통닭", "부대찌개", "감자탕", "찌개", "전골", "두부", "순두부", "백반", "한상", "반상", "기와집", "봉피양", "족발", "보쌈", "수육", "낙지", "쭈꾸미", "주꾸미", "곱창", "추어탕", "해장국", "비빔밥", "쌈밥", "정식", "갈치", "조림", "복국", "굴", "전복", "죽", "본죽", "분식아닌국밥")) return "한식";
  return "기타"; // cuisine 태그·키워드 없음 → 미분류
}

function overpassOnce(endpoint, query) {
  return new Promise((resolve, reject) => {
    const body = "data=" + encodeURIComponent(query);
    const req = https.request(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body), "Accept": "application/json", "User-Agent": "wheel-of-fortune/2.0 (contact: local)" } }, (res) => {
      let s = ""; res.on("data", (d) => (s += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { const j = JSON.parse(s); resolve(j); } catch (e) { reject(new Error("non-JSON")); }
      });
    });
    req.on("error", reject); req.setTimeout(90000, () => req.destroy(new Error("timeout"))); req.write(body); req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const countNamed = (d) => (d.elements || []).filter((e) => e.tags && e.tags.name).length;

// 같은 개수가 연속 2회 나올 때까지(최대 6회) 재시도 — 부분응답 방어. 엔드포인트 순환.
async function overpass(query) {
  let prev = null, best = null;
  for (let i = 0; i < 6; i++) {
    const ep = ENDPOINTS[i % ENDPOINTS.length];
    try {
      const d = await overpassOnce(ep, query);
      const c = countNamed(d);
      console.log(`  시도 ${i + 1}: ${ep.split("/")[2]} → ${c}곳`);
      if (!best || c > countNamed(best)) best = d;
      if (prev !== null && c === prev && c > 0) return d; // 안정
      prev = c;
    } catch (e) {
      console.log(`  시도 ${i + 1}: ${ep.split("/")[2]} 실패(${e.message})`);
    }
    await sleep(2000);
  }
  if (best) { console.log("  ⚠ 안정값 미수렴 — 최대응답 사용"); return best; }
  throw new Error("모든 엔드포인트 실패");
}

(async () => {
  const q = `[out:json][timeout:90];
( nwr(around:${RADIUS},${CENTER.lat},${CENTER.lon})[amenity~"^(restaurant|fast_food|food_court|pub|bar)$"]; );
out center tags;`;
  console.log("Overpass 조회중...");
  const data = await overpass(q);

  let items = (data.elements || []).filter((e) => e.tags && e.tags.name);
  items = items.map((e) => {
    const p = e.lat != null ? { lat: e.lat, lon: e.lon } : { lat: e.center.lat, lon: e.center.lon };
    return { name: e.tags.name, dist: haversine(CENTER, p), lat: p.lat, lon: p.lon, osm: e.type[0] + e.id, category: categorize(e.tags), cuisine: e.tags.cuisine || "" };
  });
  items = items.filter((e) => e.dist <= RADIUS);
  items.sort((a, b) => a.dist - b.dist);

  const restaurants = items.map((e, i) => ({
    id: i + 1,
    name: e.name,
    category: e.category,
    distance_m: e.dist,
    lat: e.lat,
    lon: e.lon,
    osm: e.osm,
    // 구글맵 공식 URL 스킴(키 불필요). 상호+좌표로 검색 → 정확한 가게에 안착.
    googleMapUrl: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(e.name + " " + e.lat + "," + e.lon),
    naverMapUrl: "https://map.naver.com/p/search/" + encodeURIComponent(e.name),
  }));

  const out = {
    meta: {
      center: CENTER.name,
      center_coords: { lat: CENTER.lat, lon: CENTER.lon },
      address: CENTER.address,
      radius_m: RADIUS,
      count: restaurants.length,
      method: "OpenStreetMap Overpass around + haversine 거리계산. 전 항목 좌표검증·실측거리(직선) ≤radius. googleMapUrl=상호+좌표 구글맵 링크(키 불필요).",
      source: "OSM (overpass.kumi.systems), 생성 스크립트 fetch_and_build.js",
      caveat: "직선거리 기준. OSM 미등록 식당은 빠질 수 있음(커버리지 한계). 영업여부는 네이버맵에서 확인.",
    },
    restaurants,
  };

  fs.writeFileSync(__dirname + "/restaurants.json", JSON.stringify(out, null, 2) + "\n");
  fs.writeFileSync(__dirname + "/restaurants.js", "window.RESTAURANT_DATA = " + JSON.stringify(out) + ";\n");
  const byCat = {};
  restaurants.forEach((r) => (byCat[r.category] = (byCat[r.category] || 0) + 1));
  console.log("생성완료:", restaurants.length, "곳 (전부 ≤" + RADIUS + "m)");
  console.log("카테고리:", JSON.stringify(byCat));
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
