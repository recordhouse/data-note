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
