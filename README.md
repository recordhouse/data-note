

```JS

// 1. 원하는 시점에 실행: 스크립트 로드 + 빈 팝업 열기
function openResponseMappingPopup() {
  if (window.ResponseMappingPopup) {
    window.ResponseMappingPopup.openPopup({
      popupUrl: "/popup.html",
      mappingUrl: "/data/mapping.json"
    });
    return;
  }

  const script = document.createElement("script");
  script.src = "/js/response-mapping-popup.js";
  script.onload = () => {
    window.ResponseMappingPopup.openPopup({
      popupUrl: "/popup.html",
      mappingUrl: "/data/mapping.json"
    });
  };
  document.head.appendChild(script);
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