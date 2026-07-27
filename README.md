

```JS
디버깅은 여기 보면 됩니다.
[js/response-mapping-popup.js (line 173)](/Users/admin/Documents/code/work/data-note/js/response-mapping-popup.js:173)
function mapResponse(responseJson, mappingRows) {
  return normalizeMappingRows(mappingRows).reduce((list, row) => {
    const matches = collectMatchesByKey(responseJson, row.itemKey);
여기가 매핑 데이터의 코드로 응답 JSON 전체를 뒤져서 값을 찾는 구간입니다.
디버깅하려면 const matches 바로 아래에 이거 넣으면 됩니다.
console.log("[매핑 검사]", {
  이름: row.itemName,
  코드: row.itemKey,
  찾은값: matches.map((match) => match.value),
});
화면에 최종으로 들어가는 리스트는 여기입니다.
[js/response-mapping-popup.js (line 240)](/Users/admin/Documents/code/work/data-note/js/response-mapping-popup.js:240)
async function renderPopupPayload(payload) {
  const mappingRows = payload.mappingRows || (await loadMapping(payload.mappingUrl));
  const mappedList = mapResponse(payload.responseJson, mappingRows);
  renderList("#mappingList", mappedList);
  return mappedList;
}
여기서 renderList 전에 찍으면 최종 결과를 볼 수 있습니다.
console.log("[최종 매핑 리스트]", mappedList);
정리하면 제일 좋은 디버깅 포인트는 두 군데입니다.
// 1. 코드별로 응답값을 찾았는지 확인
const matches = collectMatchesByKey(responseJson, row.itemKey);
console.log("[매핑 검사]", row.itemName, row.itemKey, matches);

// 2. 팝업에 넣기 직전 최종 리스트 확인
console.log("[최종 매핑 리스트]", mappedList);





const script = document.createElement("script");
script.src = "/js/response-mapping-popup.js";
document.head.appendChild(script);

window.ResponseMappingPopup.openWithResponse(responseJson, {
  popupUrl: "/popup.html",
  mappingUrl: "/data/mapping.json"
});

```