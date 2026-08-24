```js
let popupCoreLoadPromise = null;

// 부모 패널 초기화 시 한 번 실행
function loadPopupCore() {
  if (window.PopupCore && window.ResponseMappingPopup) {
    return Promise.resolve(window.PopupCore);
  }

  if (popupCoreLoadPromise) {
    return popupCoreLoadPromise;
  }

  popupCoreLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/js/popup-core.js";
    script.onload = () => resolve(window.PopupCore);
    script.onerror = () => reject(new Error("popup-core.js 로드 실패"));
    document.head.appendChild(script);
  });

  return popupCoreLoadPromise;
}

// 팝업 열기 버튼에서 실행
async function openResponseMappingPopup() {
  await loadPopupCore();

  return window.ResponseMappingPopup.openPopup({
    popupUrl: "/popup.html",
    mappingUrl: "/data/mapping.json",
  });
}

// 서버 응답을 받은 뒤 실행
async function renderResponseMappingPopup(responseJson) {
  await loadPopupCore();

  return window.ResponseMappingPopup.renderResponse(responseJson, {
    mappingUrl: "/data/mapping.json",
  });
}

loadPopupCore().catch(console.error);
```

`popup-core.js`는 실행 위치에 따라 필요한 파일을 자동으로 불러온다.

- 부모 화면: `user-flow-recorder.js`
- 팝업 화면: `user-flow-popup.js`, `response-mapping-popup.js`

각 파일의 역할은 다음과 같다.

- `popup-core.js`: 팝업 열기, 응답 전달, 탭 전환, 기능 파일 자동 로드
- `user-flow-recorder.js`: 부모 화면의 사용자 행동 녹화, 저장, 재생
- `user-flow-popup.js`: 팝업의 유저 플로우 목록 및 조작 UI
- `response-mapping-popup.js`: 응답 데이터 매핑 및 응답 리스트 UI
