// links_kakao_retry.js — kakaoPlaceUrl 없는 곳만 상호 정리 후 재시도.
// 정리: (주)/주식회사/괄호내용 제거, 지점접미사(본점/명동점/신세계본점/N호점/직영점 등) 제거, 핵심 상호로 재질의.
// 매칭반경 300m로 완화. 실행: node links_kakao_retry.js
const https = require("https");
const fs = require("fs");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MATCH_M = 300;
const DELAY = 130;

const haversine = (a, b) => {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(name) {
  let n = name;
  n = n.replace(/\([^)]*\)/g, " ");          // 괄호내용
  n = n.replace(/\(주\)|주식회사|㈜/g, " ");
  n = n.replace(/by[가-힣A-Za-z]+/gi, " ");   // "화정by카쿠시타" → 화정
  // 지점/접미사 토큰 제거
  const drop = /(신세계백화점|신세계본점|신세계|롯데백화점|백화점|본점|직영점|중앙점|명동점|명동본점|회현역점|을지로점|충무로점|남대문점|\d+호점|명동\d+호|\d+호|점)$/;
  let toks = n.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && drop.test(toks[toks.length - 1])) toks.pop();
  n = toks.join(" ").trim();
  return n || name;
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA, ...headers } }, (res) => {
      let s = ""; res.on("data", (d) => (s += d));
      res.on("end", () => resolve({ code: res.statusCode, body: s }));
    }).on("error", reject).setTimeout(15000, function () { this.destroy(new Error("timeout")); });
  });
}

async function kakaoLink(query, ref) {
  try {
    const u = "https://search.map.kakao.com/mapsearch/map.daum?q=" + encodeURIComponent(query) + "&msFlag=A&sort=0";
    const { code, body } = await get(u, { Referer: "https://map.kakao.com/" });
    if (code !== 200) return null;
    const j = JSON.parse(body);
    const list = j.place || [];
    let best = null, bestD = Infinity;
    for (const p of list) {
      const d = haversine(ref, { lat: +p.lat, lon: +p.lon });
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD <= MATCH_M) return { confirmid: best.confirmid, name: best.name, tel: best.tel || "", address: best.address || "", d: Math.round(bestD) };
    return null;
  } catch (e) { return null; }
}

(async () => {
  const data = JSON.parse(fs.readFileSync(__dirname + "/restaurants.json", "utf8"));
  const rs = data.restaurants;
  const miss = rs.filter((r) => !r.kakaoPlaceUrl);
  console.log("재시도 대상:", miss.length);
  let rec = 0;
  for (let i = 0; i < miss.length; i++) {
    const r = miss[i];
    const ref = { lat: r.lat, lon: r.lon };
    const q = clean(r.name);
    // 카카오 name-search는 위치 미반영 → "명동" 붙여 지역 바이어스. 여러 변형 시도.
    const variants = [...new Set([q + " 명동", q, r.name + " 명동", r.name])];
    let k = null;
    for (const v of variants) { k = await kakaoLink(v, ref); await sleep(DELAY); if (k) break; }
    if (k) {
      r.kakaoPlaceUrl = "https://place.map.kakao.com/" + k.confirmid;
      if (k.tel) r.phone = k.tel;
      if (k.address) r.address = k.address;
      rec++;
    }
    if ((i + 1) % 25 === 0 || i === miss.length - 1) console.log(`  ${i + 1}/${miss.length} — 복구 ${rec}`);
  }
  const total = rs.filter((r) => r.kakaoPlaceUrl).length;
  data.meta.linkResolution = `카카오 무키 해석: ${total}/${rs.length} (2차 복구 +${rec}). 나머지는 카카오 검색 폴백.`;
  fs.writeFileSync(__dirname + "/restaurants.json", JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(__dirname + "/restaurants.js", "window.RESTAURANT_DATA = " + JSON.stringify(data) + ";\n");
  console.log(`완료: +${rec} 복구 → 카카오 실링크 총 ${total}/${rs.length}`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
