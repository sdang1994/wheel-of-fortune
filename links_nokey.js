// links_nokey.js
// 키 없이 각 가게의 실제 가게페이지 링크 수집 (조사로 확인된 무키 엔드포인트 사용).
//   - 카카오: search.map.kakao.com/mapsearch/map.daum?q={상호} → place[].confirmid → place.map.kakao.com/{id}
//   - 구글:   maps.google.com/maps?q={상호}&output=embed → ftid 0x..:0x{CID} → maps.google.com/?cid={10진수}
// restaurants.json(OSM 좌표 보유)을 읽어 상호로 조회, OSM 좌표와 가까운 결과만 채택(동명 오매칭 방지).
// 해석 실패 시 기존 검색링크로 폴백. 결과를 restaurants.json/js 에 덮어씀.
//   실행: node links_nokey.js
const https = require("https");
const fs = require("fs");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MATCH_M = 220;   // OSM 좌표와 이 거리 이내 결과만 같은 가게로 인정
const DELAY = 130;     // 요청 간 간격(ms) — 차단 방지

const haversine = (a, b) => {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA, ...headers } }, (res) => {
      let s = ""; res.on("data", (d) => (s += d));
      res.on("end", () => resolve({ code: res.statusCode, body: s }));
    }).on("error", reject).setTimeout(15000, function () { this.destroy(new Error("timeout")); });
  });
}

// 카카오: 상호 조회 → OSM 좌표 최근접 & MATCH_M 이내 confirmid
async function kakaoLink(name, ref) {
  try {
    const u = "https://search.map.kakao.com/mapsearch/map.daum?q=" + encodeURIComponent(name) + "&msFlag=A&sort=0";
    const { code, body } = await get(u, { Referer: "https://map.kakao.com/" });
    if (code !== 200) return null;
    const j = JSON.parse(body);
    const list = j.place || [];
    let best = null, bestD = Infinity;
    for (const p of list) {
      const d = haversine(ref, { lat: +p.lat, lon: +p.lon });
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD <= MATCH_M) return { url: "https://place.map.kakao.com/" + best.confirmid, name: best.name, tel: best.tel || "", address: best.address || "", d: Math.round(bestD) };
    return null;
  } catch (e) { return null; }
}

// 구글: embed에서 ftid 추출 → CID 링크 (top match)
async function googleCid(name, ref) {
  try {
    const u = "https://maps.google.com/maps?q=" + encodeURIComponent(name + " " + ref.lat + "," + ref.lon) + "&output=embed";
    const { code, body } = await get(u, {});
    if (code !== 200) return null;
    const m = body.match(/0x[0-9a-f]{16}:0x([0-9a-f]{16})/);
    if (!m) return null;
    const cid = BigInt("0x" + m[1]).toString();
    if (cid === "0") return null;
    return "https://maps.google.com/?cid=" + cid;
  } catch (e) { return null; }
}

(async () => {
  const data = JSON.parse(fs.readFileSync(__dirname + "/restaurants.json", "utf8"));
  const rs = data.restaurants;
  let kOk = 0, gOk = 0;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const ref = { lat: r.lat, lon: r.lon };
    const k = await kakaoLink(r.name, ref);
    await sleep(DELAY);
    const g = await googleCid(r.name, ref);
    await sleep(DELAY);
    if (k) { r.kakaoPlaceUrl = k.url; if (k.tel) r.phone = k.tel; if (k.address) r.address = k.address; kOk++; }
    if (g) { r.googleCidUrl = g; gOk++; }
    if ((i + 1) % 25 === 0 || i === rs.length - 1) console.log(`  ${i + 1}/${rs.length} — kakao ${kOk}, google ${gOk}`);
  }
  data.meta.linkResolution = `무키 해석: 카카오 place ${kOk}/${rs.length}, 구글 CID ${gOk}/${rs.length}. 실패분은 검색링크 폴백.`;
  fs.writeFileSync(__dirname + "/restaurants.json", JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(__dirname + "/restaurants.js", "window.RESTAURANT_DATA = " + JSON.stringify(data) + ";\n");
  console.log(`완료: 카카오 ${kOk}, 구글 ${gOk} / ${rs.length}곳`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
