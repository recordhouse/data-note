(() => {
  "use strict";

  if (window.ResponseMappingPopup) {
    return;
  }

  const MESSAGE_READY = "response-mapping-popup-ready";
  const MESSAGE_RENDER = "response-mapping-popup-render";
  const MESSAGE_RENDERED = "response-mapping-popup-rendered";
  const DEFAULT_POPUP_URL = "./popup.html";
  const DEFAULT_MAPPING_URL = "./data/mapping.json";
  const DEFAULT_POPUP_NAME = "responseMappingPopup";
  const DEFAULT_POPUP_FEATURES = "popup=yes,width=720,height=760,left=140,top=80";

  let popupWindow = null;
  let popupReady = false;
  let popupOrigin = window.location.origin;
  let pendingPayload = null;
  let renderResolvers = [];
  let readyResolvers = [];
  let activePopupOptions = {
    popupUrl: DEFAULT_POPUP_URL,
    mappingUrl: DEFAULT_MAPPING_URL,
    popupName: DEFAULT_POPUP_NAME,
    popupFeatures: DEFAULT_POPUP_FEATURES,
  };

  function getPopupOptions(options = {}) {
    activePopupOptions = {
      popupUrl: options.popupUrl || activePopupOptions.popupUrl,
      mappingUrl: options.mappingUrl || activePopupOptions.mappingUrl,
      popupName: options.popupName || activePopupOptions.popupName,
      popupFeatures: options.popupFeatures || activePopupOptions.popupFeatures,
    };

    return activePopupOptions;
  }

  function getTargetOrigin(url) {
    const origin = new URL(url, window.location.href).origin;
    return origin === "null" ? "*" : origin;
  }

  function isPopupOpen() {
    return Boolean(popupWindow && !popupWindow.closed);
  }

  function isAllowedPopupMessage(event) {
    if (event.source !== popupWindow) {
      return false;
    }

    return popupOrigin === "*" || event.origin === popupOrigin;
  }

  function closePopup() {
    if (isPopupOpen()) {
      popupWindow.close();
    }

    popupWindow = null;
    popupReady = false;
    pendingPayload = null;
    renderResolvers.splice(0).forEach((resolve) => resolve([]));
    readyResolvers.splice(0).forEach((resolve) => resolve(null));
  }

  function sendPendingPayload() {
    if (!isPopupOpen() || !popupReady || !pendingPayload) {
      return false;
    }

    try {
      popupWindow.postMessage(
        {
          type: MESSAGE_RENDER,
          payload: pendingPayload,
        },
        popupOrigin,
      );
      popupWindow.focus();
      return true;
    } catch (error) {
      popupReady = false;
      return false;
    }
  }

  function handlePopupMessage(event) {
    if (!event.data || !isAllowedPopupMessage(event)) {
      return;
    }

    if (event.data.type === MESSAGE_READY) {
      popupReady = true;
      readyResolvers.splice(0).forEach((resolve) => resolve(popupWindow));
      sendPendingPayload();
      return;
    }

    if (event.data.type === MESSAGE_RENDERED) {
      renderResolvers.splice(0).forEach((resolve) =>
        resolve(event.data.mappedList || []),
      );
    }
  }

  function openPopup(options = {}) {
    const popupOptions = getPopupOptions(options);
    popupOrigin = getTargetOrigin(popupOptions.popupUrl);

    if (isPopupOpen()) {
      popupWindow.focus();
      return popupReady
        ? Promise.resolve(popupWindow)
        : new Promise((resolve) => readyResolvers.push(resolve));
    }

    popupReady = false;
    popupWindow = window.open(
      popupOptions.popupUrl,
      popupOptions.popupName,
      popupOptions.popupFeatures,
    );

    if (!popupWindow) {
      return Promise.reject(new Error("팝업이 차단되었습니다."));
    }

    return new Promise((resolve) => {
      readyResolvers.push(resolve);
    });
  }

  function renderResponse(responseJson, options = {}) {
    const popupOptions = getPopupOptions(options);
    popupOrigin = getTargetOrigin(popupOptions.popupUrl);
    pendingPayload = {
      responseJson,
      mappingUrl: popupOptions.mappingUrl,
      mappingRows: options.mappingRows,
    };

    if (!isPopupOpen()) {
      return Promise.resolve([]);
    }

    const renderPromise = new Promise((resolve) => {
      renderResolvers.push(resolve);
    });

    sendPendingPayload();
    return renderPromise;
  }

  window.addEventListener("message", handlePopupMessage);
  window.addEventListener("pagehide", closePopup);

  window.ResponseMappingPopup = Object.freeze({
    closePopup,
    isOpen: isPopupOpen,
    openPopup,
    openWithResponse: renderResponse,
    renderResponse,
  });
})();
