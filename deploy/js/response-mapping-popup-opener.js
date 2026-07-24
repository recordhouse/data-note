(() => {
  const MESSAGE_READY = "response-mapping-list-ready";
  const MESSAGE_RENDER = "response-mapping-list-render";
  const MESSAGE_RENDERED = "response-mapping-list-rendered";
  const POPUP_NAME = "responseMappingDeployPopup";
  const POPUP_FEATURES = "popup=yes,width=720,height=760,left=140,top=80";

  const currentScript = document.currentScript;
  const defaultPopupUrl = currentScript?.src
    ? new URL("../index.html", currentScript.src).href
    : "./deploy/index.html";

  let popupWindow = null;
  let popupReady = false;
  let popupOrigin = new URL(defaultPopupUrl, window.location.href).origin;
  let pendingResponseJson = null;
  let renderResolvers = [];

  function getPopupOrigin(popupUrl) {
    return new URL(popupUrl, window.location.href).origin;
  }

  function isPopupOpen() {
    return popupWindow && !popupWindow.closed;
  }

  function postPendingResponse() {
    if (!isPopupOpen() || !popupReady || !pendingResponseJson) {
      return;
    }

    popupWindow.postMessage(
      {
        type: MESSAGE_RENDER,
        responseJson: pendingResponseJson,
      },
      popupOrigin,
    );
    popupWindow.focus();
  }

  function handleMessage(event) {
    if (!isPopupOpen() || event.source !== popupWindow || event.origin !== popupOrigin) {
      return;
    }

    if (!event.data) {
      return;
    }

    if (event.data.type === MESSAGE_READY) {
      popupReady = true;
      postPendingResponse();
    }

    if (event.data.type === MESSAGE_RENDERED) {
      pendingResponseJson = null;
      renderResolvers.splice(0).forEach((resolve) => resolve());
    }
  }

  function open(responseJson, options = {}) {
    const popupUrl = options.popupUrl || defaultPopupUrl;
    const popupName = options.popupName || POPUP_NAME;
    const popupFeatures = options.popupFeatures || POPUP_FEATURES;

    popupOrigin = getPopupOrigin(popupUrl);
    pendingResponseJson = responseJson;

    if (!isPopupOpen()) {
      popupReady = false;
      popupWindow = window.open(popupUrl, popupName, popupFeatures);
    } else {
      popupWindow.focus();
    }

    if (!popupWindow) {
      return Promise.reject(new Error("팝업이 차단되었습니다."));
    }

    postPendingResponse();

    return new Promise((resolve) => {
      renderResolvers.push(resolve);
    });
  }

  function close() {
    if (isPopupOpen()) {
      popupWindow.close();
    }
  }

  window.addEventListener("message", handleMessage);

  window.ResponseMappingPopupOpener = {
    close,
    open,
  };
})();
