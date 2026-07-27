# data-note

통신 응답 JSON의 키를 미리 준비한 맵핑 JSON과 비교해서 팝업 리스트로 보여주는 테스트 코드입니다.

## 구조

- `index.html`: 테스트 페이지. `통신` 버튼을 누르면 더미 응답을 불러오고 팝업을 엽니다.
- `popup.html`: 실제 가져가서 쓸 팝업 HTML입니다. CSS가 포함되어 있습니다.
- `js/response-mapping-popup.js`: 팝업 열기, 메시지 전달, 응답 키 탐색, 리스트 렌더링 로직입니다.
- `data/response-dummy.json`: 테스트용 복잡한 통신 응답 JSON입니다.
- `data/mapping.json`: 표시할 항목명과 응답 키를 등록하는 맵핑 JSON입니다.

## 맵핑 JSON 형식

`data/mapping.json`은 아래처럼 `이름`, `코드`를 고정 키로 사용해서 등록합니다.

```json
[
  {
    "이름": "고객명",
    "코드": "customerName"
  },
  {
    "이름": "결제 금액",
    "코드": "amount"
  },
  {
    "이름": "상품 목록",
    "코드": "items"
  }
]
```

## 실제 사이트에서 호출하는 코드

통신 응답을 받은 다음 아래처럼 호출하면 팝업에 맵핑 리스트가 표시됩니다.

```js
ResponseMappingPopup.openWithResponse(responseJson, {
  popupUrl: "./popup.html",
  mappingUrl: "./data/mapping.json"
});
```
