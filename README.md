## Data Note 팝업 경로 설정

팝업의 로그인, 통신, 샘플 가져오기 경로는 아래 JSON만 수정하면 됩니다. 상대 경로는 `popup.html`을 기준으로 해석됩니다. 마커와 JSON 코드 블록은 삭제하지 마세요.

<!-- DATA_NOTE_POPUP_CONFIG_START -->
```json
{
  "loginUrl": "/login",
  "communicationUrl": "/communication",
  "importUrls": []
}
```
<!-- DATA_NOTE_POPUP_CONFIG_END -->

샘플 로그를 등록할 때는 `importUrls`에 다음 형식으로 추가합니다.

```json
{
  "importUrls": [
    { "name": "로그인 플로우", "url": "/flowData/login.json" },
    { "name": "공통 플로우", "url": "/flowData/common-flows.zip" }
  ]
}
```

## 사용 예시

```js
let popupScriptPromise;

// popup-core.js 동적 로드
function loadPopupScript() {
  if (window.ResponseMappingPopup) {
    return Promise.resolve();
  }

  if (!popupScriptPromise) {
    popupScriptPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");

      script.src = "/js/popup-core.js";
      script.onload = resolve;
      script.onerror = reject;

      document.head.appendChild(script);
    });
  }

  return popupScriptPromise;
}

// 팝업 열기
function openResponsePopup() {
  loadPopupScript().then(function () {
    ResponseMappingPopup.openPopup({
      popupUrl: "/popup.html",
    });
  });
}

// 통신 응답을 받은 후 실행
function renderResponsePopup(communicationName, responseJson) {
  loadPopupScript().then(function () {
    ResponseMappingPopup.renderResponse(responseJson, {
      communicationName: communicationName,
    });
  });
}

// 팝업 열기 버튼
openResponsePopup();

// 서버 응답을 받은 시점
renderResponsePopup("aaaaa", responseJson);
```
