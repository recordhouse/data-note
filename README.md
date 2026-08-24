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

`communicationName`이 `aaaaa`이면 `/data/aaaaa.json`을 매핑 데이터로 사용한다. 같은 통신명은 기존 통신 탭을 갱신하고, 다른 통신명은 응답 리스트에 새 탭으로 추가된다.
