// enrich_rating.js — kakaoPlaceUrl 보유 가게에 별점/카테고리/사진 입힘.
// mapsearch 응답에 rating_average/rating_count/cate_name_depth2~3/image_info 가 이미 포함됨(무키).
// confirmid 로 정확 매칭(좌표 모호성 없음). 실행: node enrich_rating.js
const https = require("https");
const fs = require("fs");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const DELAY = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(name) {
  let n = name.replace(/\([^)]*\)/g, " ").replace(/\(주\)|주식회사|㈜/g, " ").replace(/by[가-힣A-Za-z]+/gi, " ");
  const drop = /(신세계백화점|신세계본점|신세계|롯데백화점|백화점|본점|직영점|중앙점|명동점|명동본점|회현역점|을지로점|충무로점|남대문점|\d+호점|명동\d+호|\d+호|점)$/;
  let t = n.split(/\s+/).filter(Boolean);
  while (t.length > 1 && drop.test(t[t.length - 1])) t.pop();
  return t.join(" ").trim() || name;
}
function get(q) {
  return new Promise((res) => {
    https.get("https://search.map.kakao.com/mapsearch/map.daum?q=" + encodeURIComponent(q) + "&msFlag=A", { headers: { "User-Agent": UA, Referer: "https://map.kakao.com/" } }, (r) => {
      let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => { try { res(JSON.parse(s)); } catch (e) { res({}); } });
    }).on("error", () => res({}));
  });
}
function catOf(p) {
  const d2 = p.cate_name_depth2 || "", d3 = p.cate_name_depth3 || "";
  if (/카페|디저트|베이커리|제과|아이스크림/.test(d2 + d3)) return "카페디저트";
  if (/중식|중국/.test(d2)) return "중식";
  if (/일식|초밥|돈까스|돈가스|라멘|우동/.test(d2 + d3)) return "일식";
  if (/분식/.test(d2 + d3)) return "분식";
  if (/패스트푸드|햄버거|샌드위치/.test(d2 + d3)) return "패스트푸드";
  if (/피자|파스타|양식|이탈리|프렌치|스테이크/.test(d2 + d3)) return "양식";
  if (/아시아|베트남|태국|인도|쌀국수/.test(d2 + d3)) return "아시안";
  if (/국수|냉면|칼국수|면/.test(d3)) return "면류";
  if (/술집|호프|바|이자카야|포차/.test(d2 + d3)) return "주점";
  if (/한식|곰탕|국밥|찌개|고기|치킨|족발|삼계탕/.test(d2 + d3)) return "한식";
  return d2 || "기타";
}
const idOf = (url) => (url.match(/place\.map\.kakao\.com\/(\d+)/) || [])[1];

(async () => {
  const data = JSON.parse(fs.readFileSync(__dirname + "/restaurants.json", "utf8"));
  const targets = data.restaurants.filter((r) => r.kakaoPlaceUrl);
  console.log("대상:", targets.length);
  let rated = 0;
  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const cid = idOf(r.kakaoPlaceUrl);
    const variants = [...new Set([clean(r.name) + " 명동", clean(r.name), r.name + " 명동", r.name])];
    let found = null;
    for (const v of variants) {
      const j = await get(v); await sleep(DELAY);
      const hit = (j.place || []).find((p) => p.confirmid === cid);
      if (hit) { found = hit; break; }
    }
    if (found) {
      const avg = parseFloat(found.rating_average), cnt = parseInt(found.rating_count, 10);
      if (avg > 0) { r.rating = Math.round(avg * 10) / 10; r.ratingCount = cnt || 0; rated++; }
      const c = catOf(found);
      if (c && c !== "기타") r.category = c;
      if (found.last_cate_name) r.kakaoCategory = found.last_cate_name;
      const im = found.image_info && found.image_info.image_main_urls && found.image_info.image_main_urls[0];
      if (im) r.img = im.replace(/^http:/, "https:");
    }
    if ((i + 1) % 30 === 0 || i === targets.length - 1) console.log(`  ${i + 1}/${targets.length} — 별점 ${rated}`);
  }
  fs.writeFileSync(__dirname + "/restaurants.json", JSON.stringify(data, null, 2) + "\n");
  fs.writeFileSync(__dirname + "/restaurants.js", "window.RESTAURANT_DATA = " + JSON.stringify(data) + ";\n");
  const cats = {}; data.restaurants.filter(r=>r.kakaoPlaceUrl).forEach(r=>cats[r.category]=(cats[r.category]||0)+1);
  console.log(`완료: 별점 ${rated}곳. 카테고리:`, JSON.stringify(cats));
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
