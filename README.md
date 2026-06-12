# 🍜 명동 점심 돌림판 (Myeongdong Lunch Wheel)

스테이트타워남산(서울 중구 퇴계로 100) 반경 400m 음식점을 좌표로 검증해 만든 점심 메뉴 룰렛.
모든 데이터는 **API 키 없이** OpenStreetMap + 카카오/구글 공개 엔드포인트로 수집했다.

## 데모

`index.html`을 브라우저로 열면 끝 (데이터는 `restaurants.js` 전역으로 임베드, 서버 불필요).
로컬 서버로 보려면:

```bash
node server.js   # http://localhost:4567
```

## 기능

- 캔버스 룰렛 + 카테고리 / 최소 별점 2축 필터
- 당첨 시 **카카오맵 실제 가게 페이지**로 바로 이동 (`place.map.kakao.com/{id}`)
- 카드에 별점(★)·리뷰수·직선거리·주소·전화 표시
- 돌림판에는 카카오 실링크가 확보된 음식점만 노출

## 데이터 파이프라인 (전부 무키)

| 스크립트 | 역할 |
|---|---|
| `fetch_and_build.js` | OSM Overpass `around:400` + haversine → 반경·좌표 검증된 음식점 목록 |
| `links_nokey.js` | 카카오 `search.map.kakao.com` 무키 검색 → 좌표매칭으로 실제 가게페이지(confirmid) 링크 |
| `links_kakao_retry.js` | 매칭 실패분 상호 정리 + "명동" 지역 바이어스로 재시도 |
| `enrich_rating.js` | mapsearch 응답의 `rating_average`/카테고리/사진 추출해 별점 부여 |
| `recat.js` | 상호 기반 카테고리 보정 |
| `kakao_fetch.js` | (선택) 카카오 REST 키가 있으면 반경검색으로 100% 커버 |

재생성:

```bash
node fetch_and_build.js && node links_nokey.js && node links_kakao_retry.js && node enrich_rating.js
```

## 데이터 출처 / 주의

- 위치·거리: OpenStreetMap (직선거리, 도보거리 아님)
- 별점·가게링크·전화·주소: 카카오맵 공개 데이터
- 영업 여부는 방문 전 카카오맵에서 확인할 것

## 무키 가게링크 — 조사 메모

- **카카오**: `search.map.kakao.com/mapsearch/map.daum?q={상호}` → `place[].confirmid` → `place.map.kakao.com/{id}`. 별점(`rating_average`)도 같은 응답에 포함.
- **구글**: `maps.google.com/maps?q={상호}&output=embed` → ftid `0x..:0x{CID}` → `maps.google.com/?cid={10진수}`. 단건은 되나 대량 요청 시 IP throttle.
- **네이버**: 내부 API가 captcha(ncaptcha)로 차단, 공식 API는 place id 미제공 → 무키 불가.
