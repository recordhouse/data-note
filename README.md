
# 통신 응답 팝업 사용 방법

## 필요한 파일

```text
배포 경로/
├── popup.html
├── data/
│   └── mapping.json
└── js/
    ├── response-mapping-popup.js
    └── user-flow-recorder.js
```

`user-flow-recorder.js`는 실제 사용자 행동을 기록해야 하므로 팝업이 아닌 부모 사이트에서 실행되어야 한다.

## 스크립트 로드 순서

부모 사이트에서 `user-flow-recorder.js`를 먼저 로드하고 `response-mapping-popup.js`를 이어서 로드한다.

```html
<script src="/js/user-flow-recorder.js"></script>
<script src="/js/response-mapping-popup.js"></script>
```

정적 로드가 어렵다면 다음처럼 두 스크립트를 같은 시점에 동적으로 로드한다.

```js
const responseMappingScriptPromises = new Map();

function loadScriptOnce(src, globalName) {
  if (window[globalName]) {
    return Promise.resolve();
  }

  if (!responseMappingScriptPromises.has(src)) {
    responseMappingScriptPromises.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`${src} 로드 실패`));
        document.head.appendChild(script);
      }),
    );
  }

  return responseMappingScriptPromises.get(src);
}

async function loadResponseMappingScripts() {
  await loadScriptOnce("/js/user-flow-recorder.js", "UserFlowRecorder");
  await loadScriptOnce("/js/response-mapping-popup.js", "ResponseMappingPopup");
}

// 화면 초기화 시 미리 실행한다.
const responseMappingReady = loadResponseMappingScripts();
```

## 팝업 열기

스크립트 로드가 완료된 다음 사용자 클릭 시점에 실행한다. 팝업 차단을 방지하려면 클릭 후 서버 응답이나 스크립트 로드를 기다리지 말고 팝업부터 연다.

```js
function openResponseMappingPopup() {
  if (!window.ResponseMappingPopup || !window.UserFlowRecorder) {
    throw new Error("통신 팝업 스크립트가 아직 준비되지 않았습니다.");
  }

  return window.ResponseMappingPopup.openPopup({
    popupUrl: "/popup.html",
    mappingUrl: "/data/mapping.json",
  });
}
```

## 응답 전달

서버 응답을 받은 뒤 실행하면 이미 열린 팝업의 `응답 리스트` 탭에 매핑 결과가 추가된다.

```js
function renderResponseMappingPopup(responseJson) {
  return window.ResponseMappingPopup.renderResponse(responseJson, {
    mappingUrl: "/data/mapping.json",
  });
}
```

```js
// 화면 초기화 과정에서 스크립트 로드를 완료한다.
await responseMappingReady;

// 이후 사용자 클릭 이벤트 안에서 즉시 실행한다.
openResponseMappingPopup();

// 서버 응답을 받은 뒤
await renderResponseMappingPopup(responseJson);
```

부모 사이트와 `popup.html`은 같은 출처에서 실행해야 창 간 통신과 로컬 스토리지 기반 유저 플로우 저장이 정상적으로 동작한다.
