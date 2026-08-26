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
  const DEFAULT_MAPPING_DIRECTORY = "./data/";
  const DEFAULT_POPUP_NAME = "_blank";
  const DEFAULT_POPUP_FEATURES = "popup=yes,width=720,height=760,left=140,top=80";
  const MAX_PENDING_RESPONSES = 50;
  const POPUP_RECONNECT_CHECK_MS = 400;

  const coreScript = document.currentScript;
  const coreBaseUrl = coreScript?.src
    ? new URL(".", coreScript.src)
    : new URL("./js/", window.location.href);
  const isPopupRuntime = Boolean(document.querySelector("[data-popup-tab]"));
  const context = isPopupRuntime ? "popup" : "parent";
  const featureLoads = new Map();
  let featureReadyPromise = Promise.resolve();
  let connectedOpenerDocument = null;
  let popupReconnectTimer = 0;

  function getFeatureUrl(fileName, dataAttribute) {
    const configuredUrl = coreScript?.dataset?.[dataAttribute];
    return new URL(configuredUrl || fileName, coreBaseUrl).href;
  }

  function getCommunicationFileName(value) {
    const fileName = String(value || "")
      .trim()
      .split(/[\\/]/)
      .pop();

    if (!fileName) {
      return "";
    }

    return /\.json$/i.test(fileName) ? fileName : `${fileName}.json`;
  }

  function getCommunicationName(value) {
    return getCommunicationFileName(value).replace(/\.json$/i, "");
  }

  function createCommunicationMappingUrl(
    communicationName,
    mappingBaseUrl,
    popupUrl,
  ) {
    const fileName = getCommunicationFileName(communicationName);

    if (!fileName) {
      return "";
    }

    const popupDocumentUrl = new URL(popupUrl || DEFAULT_POPUP_URL, window.location.href);
    const baseUrl = mappingBaseUrl
      ? new URL(mappingBaseUrl, window.location.href)
      : new URL(DEFAULT_MAPPING_DIRECTORY, popupDocumentUrl);
    return new URL(encodeURIComponent(fileName), baseUrl).href;
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

    connectedOpenerDocument = getOpenerDocument();
    document.dispatchEvent(new CustomEvent(PARENT_READY_EVENT));
  }

  function getOpenerDocument() {
    try {
      if (!window.opener || window.opener.closed) {
        return null;
      }

      return window.opener.document;
    } catch (error) {
      return null;
    }
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

  function ensureOpenerPopupCore(openerDocument) {
    try {
      if (
        !window.opener ||
        window.opener.closed ||
        window.opener.PopupCore ||
        !coreScript?.src
      ) {
        return Boolean(window.opener?.PopupCore);
      }

      const existingScript = Array.from(openerDocument.scripts || []).find(
        (script) => script.src === coreScript.src,
      );

      if (existingScript) {
        return false;
      }

      const scriptContainer = openerDocument.head || openerDocument.documentElement;

      if (!scriptContainer) {
        return false;
      }

      const script = openerDocument.createElement("script");
      script.src = coreScript.src;
      script.async = true;
      Object.entries(coreScript.dataset || {}).forEach(([key, value]) => {
        script.dataset[key] = value;
      });
      scriptContainer.append(script);
      return false;
    } catch (error) {
      return false;
    }
  }

  function monitorOpenerConnection() {
    const openerDocument = getOpenerDocument();

    if (!openerDocument || openerDocument === connectedOpenerDocument) {
      return;
    }

    ensureOpenerPopupCore(openerDocument);
    announcePopupReady();
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
    popupReconnectTimer = window.setInterval(
      monitorOpenerConnection,
      POPUP_RECONNECT_CHECK_MS,
    );
    window.addEventListener(
      "pagehide",
      () => window.clearInterval(popupReconnectTimer),
      { once: true },
    );

    featureReadyPromise = Promise.all([
      loadFeatureScript(
        "user-flow-archive.js",
        "userFlowArchiveSrc",
        "UserFlowArchive",
      ),
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
    let pendingReadySource = null;
    let preservePopupOnPagehide = false;
    let popupOrigin = window.location.origin;
    let pendingPayloads = [];
    let renderRequestSequence = 0;
    const renderRequests = new Map();
    let readyResolvers = [];
    let activePopupOptions = {
      popupUrl: DEFAULT_POPUP_URL,
      mappingBaseUrl: "",
      popupName: DEFAULT_POPUP_NAME,
      popupFeatures: DEFAULT_POPUP_FEATURES,
    };

    function getPopupOptions(options = {}) {
      activePopupOptions = {
        popupUrl: options.popupUrl || activePopupOptions.popupUrl,
        mappingBaseUrl: options.mappingBaseUrl || activePopupOptions.mappingBaseUrl,
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

    function canAdoptPopup(event) {
      if (
        popupWindow ||
        event.data?.type !== MESSAGE_READY ||
        !event.source ||
        event.origin !== window.location.origin
      ) {
        return false;
      }

      try {
        return event.source.opener === window;
      } catch (error) {
        return false;
      }
    }

    function adoptPopup(event) {
      if (!canAdoptPopup(event)) {
        return false;
      }

      popupWindow = event.source;
      popupOrigin = event.origin === "null" ? "*" : event.origin;
      popupReady = false;
      return true;
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
      pendingReadySource = null;
      pendingPayloads = [];
      renderRequests.forEach(({ resolve }) => resolve([]));
      renderRequests.clear();
      readyResolvers.splice(0).forEach((resolve) => resolve(null));
    }

    function preserveForNavigation(enabled = true) {
      preservePopupOnPagehide = Boolean(enabled) && isPopupOpen();
      return preservePopupOnPagehide;
    }

    function handleParentPagehide() {
      if (preservePopupOnPagehide && isPopupOpen()) {
        preservePopupOnPagehide = false;
        return;
      }

      closePopup();
    }

    function sendPendingPayloads() {
      if (!isPopupOpen() || !popupReady || !pendingPayloads.length) {
        return false;
      }

      const payloadsToSend = pendingPayloads.splice(0);

      try {
        payloadsToSend.forEach((payload) => {
          popupWindow.postMessage(
            {
              type: MESSAGE_RENDER,
              payload,
            },
            popupOrigin,
          );
        });
        popupWindow.focus();
        return true;
      } catch (error) {
        pendingPayloads = [...payloadsToSend, ...pendingPayloads];
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
      sendPendingPayloads();
    }

    function handlePopupMessage(event) {
      if (!event.data) {
        return;
      }

      if (
        event.data.type === MESSAGE_READY &&
        !isAllowedPopupMessage(event) &&
        !adoptPopup(event)
      ) {
        return;
      }

      if (!isAllowedPopupMessage(event)) {
        return;
      }

      if (event.data.type === MESSAGE_READY) {
        const sourceWindow = event.source;

        if (popupReady) {
          sendParentReady();
          return;
        }

        if (pendingReadySource === sourceWindow) {
          return;
        }

        pendingReadySource = sourceWindow;
        featureReadyPromise.finally(() => {
          if (pendingReadySource === sourceWindow) {
            pendingReadySource = null;
          }

          finalizePopupReady(sourceWindow);
        });
        return;
      }

      if (event.data.type === MESSAGE_RENDERED) {
        const request = renderRequests.get(event.data.requestId);

        if (!request) {
          return;
        }

        renderRequests.delete(event.data.requestId);

        if (event.data.error) {
          request.reject(new Error(event.data.error));
        } else {
          request.resolve(event.data.mappedList || []);
        }
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
      pendingReadySource = null;
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
      const communicationName = getCommunicationName(options.communicationName);
      const mappingUrl = createCommunicationMappingUrl(
        communicationName,
        popupOptions.mappingBaseUrl,
        popupOptions.popupUrl,
      );

      if (!communicationName) {
        return Promise.reject(
          new Error("communicationName을 전달해야 같은 이름의 매핑 JSON을 찾을 수 있습니다."),
        );
      }

      const requestId = `response-${Date.now()}-${renderRequestSequence += 1}`;
      const payload = {
        requestId,
        responseJson,
        communicationId: options.communicationId || communicationName || requestId,
        communicationName,
        mappingUrl,
        mappingRows: options.mappingRows,
      };

      pendingPayloads.push(payload);

      if (pendingPayloads.length > MAX_PENDING_RESPONSES) {
        const removedPayload = pendingPayloads.shift();
        const removedRequest = renderRequests.get(removedPayload.requestId);

        if (removedRequest) {
          removedRequest.resolve([]);
          renderRequests.delete(removedPayload.requestId);
        }
      }

      if (!isPopupOpen()) {
        return Promise.resolve([]);
      }

      const renderPromise = new Promise((resolve, reject) => {
        renderRequests.set(requestId, { reject, resolve });
      });

      sendPendingPayloads();
      return renderPromise;
    }

    featureReadyPromise = Promise.all([
      loadFeatureScript(
        "user-flow-archive.js",
        "userFlowArchiveSrc",
        "UserFlowArchive",
      ),
      loadFeatureScript(
        "user-flow-recorder.js",
        "userFlowRecorderSrc",
        "UserFlowRecorder",
      ),
    ])
      .then(([, recorder]) => recorder)
      .catch((error) => {
        console.error(error);
        return null;
      });

    window.addEventListener("message", handlePopupMessage);
    window.addEventListener("pagehide", handleParentPagehide);

    window.ResponseMappingPopup = Object.freeze({
      closePopup,
      isOpen: isPopupOpen,
      openPopup,
      openWithResponse: renderResponse,
      preserveForNavigation,
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
