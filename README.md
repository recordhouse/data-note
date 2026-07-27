
```js
function loadResponseMappingPopupScript(src) {
  if (window.ResponseMappingPopup) {
    return Promise.resolve(window.ResponseMappingPopup);
  }

  if (window.__responseMappingPopupScriptPromise) {
    return window.__responseMappingPopupScriptPromise;
  }

  window.__responseMappingPopupScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(window.ResponseMappingPopup);
    script.onerror = () => reject(new Error("response-mapping-popup.js 로드 실패"));
    document.head.appendChild(script);
  });

  return window.__responseMappingPopupScriptPromise;
}



// 그리고 서버 응답 받은 뒤:


async function handleResponse(responseJson) {
  await loadResponseMappingPopupScript("/js/response-mapping-popup.js");

  window.ResponseMappingPopup.openWithResponse(responseJson, {
    popupUrl: "/popup.html",
    mappingUrl: "/data/mapping.json"
  });
}

```

