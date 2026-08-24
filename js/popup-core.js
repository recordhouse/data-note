(() => {
  "use strict";

  if (window.PopupCore) {
    return;
  }

  const MESSAGE_READY = "response-mapping-popup-ready";
  const MESSAGE_RENDER = "response-mapping-popup-render";
  const MESSAGE_RENDERED = "response-mapping-popup-rendered";
  const MESSAGE_PARENT_READY = "response-mapping-popup-parent-ready";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";
  const PARENT_READY_EVENT = "response-mapping-popup-parent-ready";
  const DEFAULT_POPUP_URL = "./popup.html";
  const DEFAULT_MAPPING_URL = "./data/mapping.json";
  const DEFAULT_POPUP_NAME = "responseMappingPopup";
  const DEFAULT_POPUP_FEATURES = "popup=yes,width=720,height=760,left=140,top=80";

  const coreScript = document.currentScript;
  const coreBaseUrl = coreScript?.src
    ? new URL(".", coreScript.src)
    : new URL("./js/", window.location.href);
  const isPopupRuntime = Boolean(document.querySelector("[data-popup-tab]"));
  const context = isPopupRuntime ? "popup" : "parent";
  const featureLoads = new Map();
  let featureReadyPromise = Promise.resolve();

  function getFeatureUrl(fileName, dataAttribute) {
    const configuredUrl = coreScript?.dataset?.[dataAttribute];
    return new URL(configuredUrl || fileName, coreBaseUrl).href;
  }

  function loadFeatureScript(fileName, dataAttribute, globalName) {
    if (window[globalName]) {
      return Promise.resolve(window[globalName]);
    }

    const sourceUrl = getFeatureUrl(fileName, dataAttribute);

    if (featureLoads.has(sourceUrl)) {
      return featureLoads.get(sourceUrl);
    }

    const loadPromise = new Promise((resolve, reject) => {
      const existingScript = Array.from(document.scripts).find(
        (script) => script.src === sourceUrl,
      );
      const script = existingScript || document.createElement("script");

      function handleLoad() {
        if (window[globalName]) {
          resolve(window[globalName]);
        } else {
          reject(new Error(`${fileName} 초기화에 실패했습니다.`));
        }
      }

      function handleError() {
        reject(new Error(`${fileName} 파일을 불러오지 못했습니다.`));
      }

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });

      if (!existingScript) {
        script.src = sourceUrl;
        script.async = true;
        document.head.append(script);
      }
    }).catch((error) => {
      featureLoads.delete(sourceUrl);
      throw error;
    });

    featureLoads.set(sourceUrl, loadPromise);
    return loadPromise;
  }

  function activateTab(tabName) {
    if (!isPopupRuntime) {
      return false;
    }

    const tabs = Array.from(document.querySelectorAll("[data-popup-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-popup-panel]"));

    if (!tabs.some((tab) => tab.dataset.popupTab === tabName)) {
      return false;
    }

    tabs.forEach((tab) => {
      const isActive = tab.dataset.popupTab === tabName;
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.popupPanel !== tabName;
    });

    document.dispatchEvent(
      new CustomEvent(POPUP_TAB_CHANGE_EVENT, {
        detail: { tabName },
      }),
    );
    return true;
  }

  function handleTabClick(event) {
    const tab = event.target.closest("[data-popup-tab]");

    if (tab) {
      activateTab(tab.dataset.popupTab);
    }
  }

  function isAllowedOpenerMessage(event) {
    if (!window.opener || event.source !== window.opener) {
      return false;
    }

    if (window.location.origin === "null") {
      return event.origin === "null";
    }

    return event.origin === window.location.origin;
  }

  function handleParentReadyMessage(event) {
    if (event.data?.type !== MESSAGE_PARENT_READY || !isAllowedOpenerMessage(event)) {
      return;
    }

    document.dispatchEvent(new CustomEvent(PARENT_READY_EVENT));
  }

  function announcePopupReady() {
    if (!window.opener || window.opener.closed) {
      return;
    }

    window.opener.postMessage(
      {
        type: MESSAGE_READY,
      },
      window.location.origin === "null" ? "*" : window.location.origin,
    );
  }

  function showFeatureLoadError(error) {
    const status = document.querySelector("#userFlowStatus");

    if (status) {
      status.textContent = error.message;
      status.dataset.state = "error";
    }
  }

  function initializePopupRuntime() {
    document.addEventListener("click", handleTabClick);
    window.addEventListener("message", handleParentReadyMessage);

    featureReadyPromise = Promise.all([
      loadFeatureScript(
        "user-flow-popup.js",
        "userFlowPopupSrc",
        "UserFlowPopup",
      ),
      loadFeatureScript(
        "response-mapping-popup.js",
        "responseMappingSrc",
        "ResponseMappingFeature",
      ),
    ])
      .catch((error) => {
        showFeatureLoadError(error);
        return [];
      })
      .then((features) => {
        announcePopupReady();
        return features;
      });
  }

  function initializeParentRuntime() {
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

    function sendParentReady() {
      if (!isPopupOpen()) {
        return;
      }

      popupWindow.postMessage(
        {
          type: MESSAGE_PARENT_READY,
        },
        popupOrigin,
      );
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

    function finalizePopupReady(sourceWindow) {
      if (sourceWindow !== popupWindow || !isPopupOpen()) {
        return;
      }

      popupReady = true;
      sendParentReady();
      readyResolvers.splice(0).forEach((resolve) => resolve(popupWindow));
      sendPendingPayload();
    }

    function handlePopupMessage(event) {
      if (!event.data || !isAllowedPopupMessage(event)) {
        return;
      }

      if (event.data.type === MESSAGE_READY) {
        const sourceWindow = event.source;
        featureReadyPromise.finally(() => finalizePopupReady(sourceWindow));
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

    featureReadyPromise = loadFeatureScript(
      "user-flow-recorder.js",
      "userFlowRecorderSrc",
      "UserFlowRecorder",
    ).catch((error) => {
      console.error(error);
      return null;
    });

    window.addEventListener("message", handlePopupMessage);
    window.addEventListener("pagehide", closePopup);

    window.ResponseMappingPopup = Object.freeze({
      closePopup,
      isOpen: isPopupOpen,
      openPopup,
      openWithResponse: renderResponse,
      ready: () => featureReadyPromise,
      renderResponse,
    });
  }

  const popupCoreApi = {
    activateTab,
    context,
    get ready() {
      return featureReadyPromise;
    },
  };

  window.PopupCore = Object.freeze(popupCoreApi);

  if (isPopupRuntime) {
    initializePopupRuntime();
  } else {
    initializeParentRuntime();
  }
})();
