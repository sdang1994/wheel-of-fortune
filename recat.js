// recat.js — restaurants.json 카테고리만 재계산(카카오 링크·전화·주소 등 보존).
// 그리디 키워드("포"가 마포/포항 오매칭 등) 수정판. 실행: node recat.js
const fs = require("fs");

function categorize(name) {
  const n = name || "";
  const has = (...ws) => ws.some((w) => n.includes(w));
  if (has("별다방", "스타벅스", "투썸", "이디야", "메가커피", "메가 ", "커피", "카페", "다방", "베이글", "도넛", "노티드", "베이커리", "빵", "제과", "디저트", "빙수", "설빙", "와플", "케이크", "젤라또", "아이스크림", "라운지")) return "카페디저트";
  if (has("김밥", "김선생", "김가네", "분식", "떡볶이", "순대", "오뎅", "어묵")) return "분식";
  if (has("쌀국수", "쌀국", "베트남", "사이공", "하노이", "팟타이", "반미", "태국", "타이 ", "인도", "네팔", "커리", "아시안", "포메인")) return "아시안";
  if (has("중식", "중국", "짜장", "짬뽕", "딤섬", "양꼬치", "양고기", "마라", "란주", "꽁시", "행화", "도향", "개화", "향미", "아래향", "제이드")) return "중식";
  if (has("일식", "스시", "초밥", "사시미", "돈카츠", "돈까스", "카츠", "라멘", "우동", "소바", "규카츠", "이자카야", "오마카세", "텐동", "규동")) return "일식";
  if (has("파스타", "피자", "스테이크", "이탈리", "프렌치", "비스트로", "델리", "그릴", "버거", "양식")) return "양식";
  if (has("맥도날드", "롯데리아", "버거킹", "kfc", "써브웨이", "subway", "isaac", "토스트")) return "패스트푸드";
  if (has("칼국수", "칼제비", "냉면", "국수", "면옥", "우육면", "잔치국수")) return "면류";
  if (has("포차", "호프", "술집", "선술집", "와인바", "맥주")) return "주점";
  if (has("설렁탕", "곰탕", "국밥", "삼계탕", "백숙", "갈비탕", "감자탕", "추어탕", "해장국", "순두부", "부대찌개", "찌개", "전골", "닭", "치킨", "통닭", "찜닭", "족발", "보쌈", "수육", "낙지", "쭈꾸미", "주꾸미", "곱창", "막창", "한정식", "한식", "한우", "고기", "삼겹", "갈비", "불고기", "비빔밥", "쌈밥", "백반", "한상", "반상", "기와집", "갈치", "조림", "복국", "전복", "본죽", "죽", "정식", "굴")) return "한식";
  return "기타";
}

const d = JSON.parse(fs.readFileSync(__dirname + "/restaurants.json", "utf8"));
const before = {};
d.restaurants.forEach((r) => { before[r.category] = (before[r.category] || 0) + 1; r.category = categorize(r.name); });
const after = {};
d.restaurants.forEach((r) => (after[r.category] = (after[r.category] || 0) + 1));
fs.writeFileSync(__dirname + "/restaurants.json", JSON.stringify(d, null, 2) + "\n");
fs.writeFileSync(__dirname + "/restaurants.js", "window.RESTAURANT_DATA = " + JSON.stringify(d) + ";\n");
console.log("재분류 완료. after:", JSON.stringify(after));
