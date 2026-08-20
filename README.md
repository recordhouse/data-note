
```JS

// 1. 원하는 시점에 실행: 스크립트 로드 + 빈 팝업 열기
function openResponseMappingPopup() {
  function openPopup() {
    window.ResponseMappingPopup.openPopup({
      popupUrl: "/popup.html",
      mappingUrl: "/data/mapping.json"
    });
  }

  function loadResponseMappingPopupScript() {
    if (window.ResponseMappingPopup) {
      openPopup();
      return;
    }

    const script = document.createElement("script");
    script.src = "/js/response-mapping-popup.js";
    script.onload = openPopup;
    document.head.appendChild(script);
  }

  if (window.ResponseMappingPopup && window.UserFlowRecorder) {
    openPopup();
    return;
  }

  if (window.UserFlowRecorder) {
    loadResponseMappingPopupScript();
    return;
  }

  const recorderScript = document.createElement("script");
  recorderScript.src = "/js/user-flow-recorder.js";
  recorderScript.onload = loadResponseMappingPopupScript;
  document.head.appendChild(recorderScript);
}


// 2. 서버 응답 받은 뒤 실행: 이미 떠있는 팝업에 리스트 추가
function renderResponseMappingPopup(responseJson) {
  window.ResponseMappingPopup.renderResponse(responseJson, {
    mappingUrl: "/data/mapping.json"
  });
}


openResponseMappingPopup();

// 서버 응답 받은 뒤
renderResponseMappingPopup(responseJson);


```

`user-flow-recorder.js`를 부모 사이트에서 로드하면 팝업의 `유저 플로우` 탭에 있는 녹음·재생 버튼이 부모 화면을 제어한다. 별도의 녹음·재생 함수 호출은 필요하지 않다.
