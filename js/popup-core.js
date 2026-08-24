(() => {
  "use strict";

  if (!document.querySelector("[data-popup-tab]") || window.PopupCore) {
    return;
  }

  const MESSAGE_READY = "response-mapping-popup-ready";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";

  function activateTab(tabName) {
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

  function announceReady() {
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

  document.addEventListener("click", handleTabClick);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceReady, { once: true });
  } else {
    announceReady();
  }

  window.PopupCore = Object.freeze({
    activateTab,
  });
})();
