(() => {
  "use strict";

  if (window.PopupCore) {
    return;
  }

  // 변경사항을 배포할 때 마지막 버전 숫자를 올려주세요.
  const DATA_NOTE_VERSION = "1.0.0+0028";
  const MESSAGE_READY = "response-mapping-popup-ready";
  const MESSAGE_RENDER = "response-mapping-popup-render";
  const MESSAGE_RENDERED = "response-mapping-popup-rendered";
  const MESSAGE_PARENT_READY = "response-mapping-popup-parent-ready";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";
  const PARENT_READY_EVENT = "response-mapping-popup-parent-ready";
  const DEFAULT_POPUP_URL = "./popup.html";
  const DEFAULT_MAPPING_DIRECTORY = "./data/";
  const DEFAULT_POPUP_NAME = "_blank";
  const DEFAULT_POPUP_FEATURES = "popup=yes,width=650,height=800,left=0,top=0";
  const MAX_PENDING_RESPONSES = 50;
  const POPUP_RECONNECT_CHECK_MS = 400;

  const coreScript = document.currentScript;
  const coreBaseUrl = coreScript?.src
    ? new URL(".", coreScript.src)
    : new URL("./js/", window.location.href);
  const isPopupRuntime = Boolean(document.querySelector("[data-popup-tab]"));
  const context = isPopupRuntime ? "popup" : "parent";

  if (isPopupRuntime) {
    document.title = `Data Note · v${DATA_NOTE_VERSION}`;

    const popupTabs = document.querySelector(".popup-tabs");

    if (popupTabs) {
      const versionLabel = document.createElement("span");
      versionLabel.className = "popup-version";
      versionLabel.textContent = `v${DATA_NOTE_VERSION}`;
      versionLabel.title = `Data Note 버전 ${DATA_NOTE_VERSION}`;
      popupTabs.append(versionLabel);
    }
  }

  const featureLoads = new Map();
  let featureReadyPromise = Promise.resolve();
  let connectedParentDocument = null;
  let connectedParentWindow = isPopupRuntime ? window.opener : null;
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

  function isWindowOpen(targetWindow) {
    try {
      return Boolean(targetWindow && !targetWindow.closed);
    } catch (error) {
      return false;
    }
  }

  function getPopupParentWindow() {
    if (!isPopupRuntime) {
      return null;
    }

    if (isWindowOpen(connectedParentWindow)) {
      return connectedParentWindow;
    }

    if (isWindowOpen(window.opener)) {
      connectedParentWindow = window.opener;
      return connectedParentWindow;
    }

    connectedParentWindow = null;
    return null;
  }

  function connectParentWindow(parentWindow) {
    if (!isPopupRuntime || !isWindowOpen(parentWindow)) {
      return false;
    }

    try {
      const isInitialBlank = parentWindow.location.href === "about:blank";

      if (
        !isInitialBlank &&
        parentWindow.location.origin !== window.location.origin
      ) {
        return false;
      }

      connectedParentWindow = parentWindow;
      connectedParentDocument = parentWindow.document;
      return true;
    } catch (error) {
      return false;
    }
  }

  function isAllowedParentMessage(event) {
    const parentWindow = getPopupParentWindow();

    if (!parentWindow || event.source !== parentWindow) {
      return false;
    }

    if (window.location.origin === "null") {
      return event.origin === "null";
    }

    return event.origin === window.location.origin;
  }

  function handleParentReadyMessage(event) {
    if (event.data?.type !== MESSAGE_PARENT_READY || !isAllowedParentMessage(event)) {
      return;
    }

    connectedParentDocument = getParentDocument();
    document.dispatchEvent(new CustomEvent(PARENT_READY_EVENT));
  }

  function getParentDocument() {
    try {
      const parentWindow = getPopupParentWindow();

      if (!parentWindow) {
        return null;
      }

      return parentWindow.document;
    } catch (error) {
      return null;
    }
  }

  function announcePopupReady() {
    const parentWindow = getPopupParentWindow();

    if (!parentWindow) {
      return;
    }

    parentWindow.postMessage(
      {
        type: MESSAGE_READY,
      },
      window.location.origin === "null" ? "*" : window.location.origin,
    );
  }

  function ensureParentPopupCore(parentWindow, parentDocument) {
    try {
      if (
        !isWindowOpen(parentWindow) ||
        parentWindow.PopupCore ||
        !coreScript?.src
      ) {
        return Boolean(parentWindow?.PopupCore);
      }

      const existingScript = Array.from(parentDocument.scripts || []).find(
        (script) => script.src === coreScript.src,
      );

      if (existingScript) {
        return false;
      }

      const scriptContainer = parentDocument.head || parentDocument.documentElement;

      if (!scriptContainer) {
        return false;
      }

      const script = parentDocument.createElement("script");
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

  function monitorParentConnection() {
    const parentWindow = getPopupParentWindow();
    const parentDocument = getParentDocument();

    if (!parentWindow || !parentDocument || parentDocument === connectedParentDocument) {
      return;
    }

    ensureParentPopupCore(parentWindow, parentDocument);
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
      monitorParentConnection,
      POPUP_RECONNECT_CHECK_MS,
    );
    window.addEventListener(
      "pagehide",
      () => window.clearInterval(popupReconnectTimer),
      { once: true },
    );

    const userFlowReadyPromise = loadFeatureScript(
      "user-flow-archive.js",
      "userFlowArchiveSrc",
      "UserFlowArchive",
    )
      .then(() =>
        loadFeatureScript(
          "user-flow-import.js",
          "userFlowImportSrc",
          "UserFlowImport",
        ),
      )
      .then(() =>
        loadFeatureScript(
          "user-flow-popup.js",
          "userFlowPopupSrc",
          "UserFlowPopup",
        ),
      );

    featureReadyPromise = Promise.all([
      userFlowReadyPromise,
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
        return event.source.opener === window || window.opener === event.source;
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
      // The popup now stays open for both navigation and parent-page closure.
      return Boolean(enabled) && isPopupOpen();
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
        "user-flow-request-tracker.js",
        "userFlowRequestTrackerSrc",
        "UserFlowRequestTracker",
      ),
      loadFeatureScript(
        "user-flow-recorder-visuals.js",
        "userFlowRecorderVisualsSrc",
        "UserFlowRecorderVisuals",
      ),
      loadFeatureScript(
        "user-flow-recorder-events.js",
        "userFlowRecorderEventsSrc",
        "UserFlowRecorderEvents",
      ),
    ])
      .then(() =>
        loadFeatureScript(
          "user-flow-recorder.js",
          "userFlowRecorderSrc",
          "UserFlowRecorder",
        ),
      )
      .catch((error) => {
        console.error(error);
        return null;
      });

    window.addEventListener("message", handlePopupMessage);

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
    connectParent: connectParentWindow,
    context,
    getParentWindow: getPopupParentWindow,
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
