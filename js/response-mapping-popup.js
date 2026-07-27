(() => {
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

  function normalizeMappingRows(source) {
    if (Array.isArray(source)) {
      return source.map(normalizeMappingRow).filter(hasMappingValue);
    }

    if (!source || typeof source !== "object") {
      return [];
    }

    if (
      (source["이름"] || source["항목명"] || source["항목이름"]) &&
      (source["코드"] || source["항목키"] || source["값"] || source["항목키값"] || source.itemKey || source.key)
    ) {
      return [normalizeMappingRow(source)].filter(hasMappingValue);
    }

    return Object.entries(source)
      .map(([itemName, itemKey]) => ({
        itemName: normalizeName(itemName),
        itemKey: normalizeKey(itemKey),
      }))
      .filter(hasMappingValue);
  }

  function normalizeMappingRow(row) {
    if (!row || typeof row !== "object") {
      return {
        itemName: "",
        itemKey: "",
      };
    }

    return {
      itemName: normalizeName(row["이름"] || row["항목명"] || row["항목이름"] || row.itemName || row.name),
      itemKey: normalizeKey(row["코드"] || row["항목키"] || row["값"] || row["항목키값"] || row.itemKey || row.key),
    };
  }

  function hasMappingValue(row) {
    return row.itemName && row.itemKey;
  }

  function createLabelMap(mappingRows) {
    return normalizeMappingRows(mappingRows).reduce((labelMap, row) => {
      if (!labelMap.has(row.itemKey)) {
        labelMap.set(row.itemKey, row.itemName);
      }

      return labelMap;
    }, new Map());
  }

  function getDisplayLabel(label, labelMap) {
    return labelMap.get(normalizeKey(label)) || label;
  }

  function normalizeName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeKey(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatValue(value) {
    if (value === null) {
      return "null";
    }

    if (typeof value === "number") {
      return new Intl.NumberFormat("ko-KR").format(value);
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  function collectMatchesByKey(source, targetKey) {
    const matches = [];
    const visited = new WeakSet();
    const stack = [source];

    while (stack.length) {
      const value = stack.pop();

      if (!value || typeof value !== "object") {
        continue;
      }

      if (visited.has(value)) {
        continue;
      }

      visited.add(value);

      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          stack.push(value[index]);
        }
        continue;
      }

      Object.entries(value)
        .reverse()
        .forEach(([key, childValue]) => {
          if (key === targetKey) {
            matches.push({
              value: childValue,
            });
          }

          stack.push(childValue);
        });
    }

    return matches;
  }

  function mapResponse(responseJson, mappingRows) {
    return normalizeMappingRows(mappingRows).reduce((list, row) => {
      const matches = collectMatchesByKey(responseJson, row.itemKey);

      if (!matches.length) {
        return list;
      }

      const values = matches.map((match) => match.value);

      list.push({
        itemName: row.itemName,
        itemKey: row.itemKey,
        value: values.length === 1 ? values[0] : values,
        values,
        exception: false,
      });
      return list;
    }, []);
  }

  function renderTreeRow(label, value, depth, hasValue) {
    return `
      <div class="tree-row" style="--depth: ${depth}">
        <span class="tree-prefix">${depth > 0 ? "-" : ""}</span>
        <span class="tree-toggle-placeholder"></span>
        <span class="tree-name">${escapeHtml(label)}</span>
        ${
          hasValue
            ? `<span class="tree-separator">:</span><span class="tree-value">${escapeHtml(value)}</span>`
            : ""
        }
      </div>
    `;
  }

  function renderTreeBranch(label, children, depth) {
    return `
      <div class="tree-branch">
        <div class="tree-row has-children" style="--depth: ${depth}">
          <span class="tree-prefix">${depth > 0 ? "-" : ""}</span>
          <button class="tree-toggle" type="button" aria-expanded="true" title="접기/펼치기" data-tree-toggle></button>
          <span class="tree-name">${escapeHtml(label)}</span>
        </div>
        <div class="tree-children">
          ${children}
        </div>
      </div>
    `;
  }

  function renderArrayChildren(items, depth, visited, labelMap) {
    return items
      .map((item) => {
        if (!item || typeof item !== "object") {
          return renderTreeRow(formatValue(item), "", depth + 1, false);
        }

        if (visited.has(item)) {
          return renderTreeRow("[순환 참조]", "", depth + 1, false);
        }

        if (Array.isArray(item)) {
          return renderTreeValue("배열", item, depth + 1, visited, labelMap);
        }

        const entries = Object.entries(item);

        if (!entries.length) {
          return renderTreeRow("{}", "", depth + 1, false);
        }

        visited.add(item);
        const children = entries
          .map(([key, childValue]) => renderTreeValue(key, childValue, depth + 1, visited, labelMap))
          .join("");
        visited.delete(item);
        return children;
      })
      .join("");
  }

  function renderObjectChildren(value, depth, visited, labelMap) {
    const entries = Object.entries(value);

    if (!entries.length) {
      return "";
    }

    return entries
      .map(([key, childValue]) => renderTreeValue(key, childValue, depth + 1, visited, labelMap))
      .join("");
  }

  function renderTreeValue(label, value, depth = 0, visited = new WeakSet(), labelMap = new Map()) {
    const displayLabel = getDisplayLabel(label, labelMap);

    if (!value || typeof value !== "object") {
      return renderTreeRow(displayLabel, formatValue(value), depth, true);
    }

    if (visited.has(value)) {
      return renderTreeRow(displayLabel, "[순환 참조]", depth, true);
    }

    visited.add(value);

    const children = Array.isArray(value)
      ? renderArrayChildren(value, depth, visited, labelMap)
      : renderObjectChildren(value, depth, visited, labelMap);
    visited.delete(value);

    if (!children) {
      return renderTreeRow(displayLabel, "", depth, false);
    }

    return renderTreeBranch(displayLabel, children, depth);
  }

  function renderList(target, mappedList, mappingRows) {
    const container = typeof target === "string" ? document.querySelector(target) : target;

    if (!container) {
      return;
    }

    if (!mappedList.length) {
      container.innerHTML = `<div class="empty">매핑되는 응답값이 없습니다.</div>`;
      return;
    }

    const labelMap = createLabelMap(mappingRows || mappedList);

    container.innerHTML = mappedList
      .map((row) => `<section class="row">${renderTreeValue(row.itemName, row.value, 0, new WeakSet(), labelMap)}</section>`)
      .join("");
  }

  function handleTreeToggle(event) {
    const toggleButton = event.target.closest("[data-tree-toggle]");

    if (!toggleButton) {
      return;
    }

    const branch = toggleButton.closest(".tree-branch");

    if (!branch) {
      return;
    }

    const children = Array.from(branch.children).find((child) => child.classList.contains("tree-children"));

    if (!children) {
      return;
    }

    const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
    toggleButton.setAttribute("aria-expanded", String(!isExpanded));
    children.hidden = isExpanded;
  }

  async function loadMapping(mappingUrl = DEFAULT_MAPPING_URL) {
    const response = await fetch(mappingUrl);

    if (!response.ok) {
      throw new Error(`매핑 JSON을 불러오지 못했습니다. (${response.status})`);
    }

    return normalizeMappingRows(await response.json());
  }

  async function renderPopupPayload(payload) {
    const mappingRows = payload.mappingRows || (await loadMapping(payload.mappingUrl));
    const mappedList = mapResponse(payload.responseJson, mappingRows);
    renderList("#mappingList", mappedList, mappingRows);
    return mappedList;
  }

  function getTargetOrigin(url) {
    const origin = new URL(url, window.location.href).origin;
    return origin === "null" ? "*" : origin;
  }

  function isPopupOpen() {
    return popupWindow && !popupWindow.closed;
  }

  function sendPendingPayload() {
    if (!isPopupOpen() || !popupReady || !pendingPayload) {
      return;
    }

    popupWindow.postMessage(
      {
        type: MESSAGE_RENDER,
        payload: pendingPayload,
      },
      popupOrigin,
    );
    popupWindow.focus();
  }

  function handleParentMessage(event) {
    if (!event.data) {
      return;
    }

    if (event.data.type === MESSAGE_READY && event.source === popupWindow) {
      popupReady = true;
      readyResolvers.splice(0).forEach((resolve) => resolve(popupWindow));
      sendPendingPayload();
      return;
    }

    if (event.data.type === MESSAGE_RENDERED && event.source === popupWindow) {
      renderResolvers.splice(0).forEach((resolve) => resolve(event.data.mappedList || []));
    }
  }

  async function handlePopupMessage(event) {
    if (!event.data || event.data.type !== MESSAGE_RENDER) {
      return;
    }

    const mappedList = await renderPopupPayload(event.data.payload);

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: MESSAGE_RENDERED,
          mappedList,
        },
        event.origin === "null" ? "*" : event.origin,
      );
    }
  }

  function openPopup(options = {}) {
    const popupOptions = getPopupOptions(options);
    popupOrigin = getTargetOrigin(popupOptions.popupUrl);

    if (isPopupOpen()) {
      popupWindow.focus();
      return popupReady ? Promise.resolve(popupWindow) : new Promise((resolve) => readyResolvers.push(resolve));
    }

    popupReady = false;
    pendingPayload = null;
    popupWindow = window.open(popupOptions.popupUrl, popupOptions.popupName, popupOptions.popupFeatures);

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
      popupReady = false;
      popupWindow = window.open(popupOptions.popupUrl, popupOptions.popupName, popupOptions.popupFeatures);

      if (!popupWindow) {
        return Promise.reject(new Error("팝업이 차단되었습니다."));
      }
    } else {
      popupWindow.focus();
    }

    const renderPromise = new Promise((resolve) => {
      renderResolvers.push(resolve);
    });

    sendPendingPayload();
    return renderPromise;
  }

  function openWithResponse(responseJson, options = {}) {
    return renderResponse(responseJson, options);
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

  window.addEventListener("message", handleParentMessage);
  window.addEventListener("message", handlePopupMessage);
  document.addEventListener("click", handleTreeToggle);

  if (document.querySelector("#mappingList")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announceReady, { once: true });
    } else {
      announceReady();
    }
  }

  window.ResponseMappingPopup = {
    collectMatchesByKey,
    createLabelMap,
    formatValue,
    loadMapping,
    mapResponse,
    normalizeMappingRows,
    openPopup,
    openWithResponse,
    renderResponse,
    renderList,
  };
})();
