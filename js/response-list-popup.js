(() => {
  "use strict";

  if (!document.querySelector("#mappingList") || window.ResponseListPopup) {
    return;
  }

  const MESSAGE_RENDER = "response-mapping-popup-render";
  const MESSAGE_RENDERED = "response-mapping-popup-rendered";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";
  const DEFAULT_MAPPING_URL = "./data/mapping.json";
  const VISIBLE_ITEMS_STORAGE_KEY = "response-mapping-popup-visible-items";
  const ITEM_FILTER_MOTION_MS = 160;

  let currentMappedList = [];
  let currentLabelMap = new Map();
  const visibleItemIds = loadVisibleItemIds();

  function normalizeMappingRows(source) {
    if (Array.isArray(source)) {
      return getUniqueMappingRows(source.map(normalizeMappingRow).filter(hasMappingValue));
    }

    if (!source || typeof source !== "object") {
      return [];
    }

    if (
      (source["이름"] || source["항목명"] || source["항목이름"]) &&
      (source["코드"] || source["항목키"] || source["값"] || source["항목키값"] || source.itemKey || source.key)
    ) {
      return getUniqueMappingRows([normalizeMappingRow(source)].filter(hasMappingValue));
    }

    return getUniqueMappingRows(
      Object.entries(source)
        .map(([itemName, itemKey]) => ({
          itemName: normalizeName(itemName),
          itemKey: normalizeKey(itemKey),
        }))
        .filter(hasMappingValue),
    );
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

  function getUniqueMappingRows(rows) {
    const itemKeys = new Set();

    return rows.filter((row) => {
      if (itemKeys.has(row.itemKey)) {
        return false;
      }

      itemKeys.add(row.itemKey);
      return true;
    });
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
              siblings: Object.fromEntries(
                Object.entries(value).filter(([siblingKey]) => siblingKey !== key),
              ),
            });
          }

          stack.push(childValue);
        });
    }

    return matches;
  }

  function getValueSignature(value, visited = new WeakSet()) {
    if (value === null) {
      return "null";
    }

    if (typeof value !== "object") {
      return `${typeof value}:${String(value)}`;
    }

    if (visited.has(value)) {
      return "[순환 참조]";
    }

    visited.add(value);

    if (Array.isArray(value)) {
      const signature = `[${value.map((item) => getValueSignature(item, visited)).join(",")}]`;
      visited.delete(value);
      return signature;
    }

    const signature = `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${getValueSignature(value[key], visited)}`)
      .join(",")}}`;
    visited.delete(value);
    return signature;
  }

  function getUniqueValues(values) {
    const uniqueMap = new Map();

    values.forEach((value) => {
      const signature = getValueSignature(value);

      if (!uniqueMap.has(signature)) {
        uniqueMap.set(signature, value);
      }
    });

    return [...uniqueMap.values()];
  }

  function getUniqueMatchDetails(matches) {
    const uniqueMap = new Map();

    matches.forEach((match) => {
      const signature = `${getValueSignature(match.value)}\u0001${getValueSignature(match.siblings)}`;

      if (!uniqueMap.has(signature)) {
        uniqueMap.set(signature, {
          value: match.value,
          siblings: match.siblings,
        });
      }
    });

    return [...uniqueMap.values()];
  }

  function mapResponse(responseJson, mappingRows) {
    return normalizeMappingRows(mappingRows).reduce((list, row) => {
      const matches = collectMatchesByKey(responseJson, row.itemKey);

      if (!matches.length) {
        return list;
      }

      const values = getUniqueValues(matches.map((match) => match.value));

      list.push({
        itemName: row.itemName,
        itemKey: row.itemKey,
        value: values.length === 1 ? values[0] : values,
        values,
        siblingGroups: getUniqueMatchDetails(matches),
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

  function getDetailValueLabel(value) {
    if (Array.isArray(value)) {
      return "배열";
    }

    if (value && typeof value === "object") {
      return "객체";
    }

    return formatValue(value);
  }

  function renderSiblingDetails(row, labelMap) {
    const groups = row.siblingGroups || [];

    if (!groups.length) {
      return `<div class="detail-empty">형제 속성이 없습니다.</div>`;
    }

    const renderedGroups = groups
      .map((group, index) => {
        const siblingEntries = Object.entries(group.siblings || {});
        const groupTitle =
          groups.length > 1
            ? `<div class="detail-group-title">
                <span class="detail-group-number">${index + 1}.</span>
                <span class="detail-group-label">매칭 값</span>
                <span class="detail-group-value">${escapeHtml(getDetailValueLabel(group.value))}</span>
              </div>`
            : "";
        const siblingList = siblingEntries.length
          ? siblingEntries
              .map(([key, value]) => renderTreeValue(key, value, 0, new WeakSet(), labelMap))
              .join("")
          : `<div class="detail-empty">형제 속성이 없습니다.</div>`;

        return `<div class="detail-group">${groupTitle}${siblingList}</div>`;
      })
      .join("");

    return `<div class="detail-title">형제 속성</div>${renderedGroups}`;
  }

  function getMappedItemId(row) {
    return `${row.itemKey}\u0000${row.itemName}`;
  }

  function loadVisibleItemIds() {
    try {
      const savedItemIds = JSON.parse(window.localStorage.getItem(VISIBLE_ITEMS_STORAGE_KEY) || "[]");
      return new Set(Array.isArray(savedItemIds) ? savedItemIds : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveVisibleItemIds() {
    try {
      window.localStorage.setItem(VISIBLE_ITEMS_STORAGE_KEY, JSON.stringify([...visibleItemIds]));
    } catch (error) {
      // 저장소를 사용할 수 없는 환경에서는 현재 팝업의 선택 상태만 유지합니다.
    }
  }

  function updateItemFilterState() {
    const filter = document.querySelector("#mappingItemFilter");
    const summary = document.querySelector("#mappingItemFilterSummary");
    const allCheckbox = document.querySelector("#mappingItemFilterAll");
    const checkboxes = Array.from(document.querySelectorAll("[data-mapping-filter-index]"));

    if (!filter || !summary || !allCheckbox) {
      return;
    }

    const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
    summary.textContent = `표시 항목 ${checkedCount}/${checkboxes.length}`;
    allCheckbox.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    allCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;

    checkboxes.forEach((checkbox) => {
      const index = Number(checkbox.dataset.mappingFilterIndex);
      const row = document.querySelector(`[data-mapping-row-index="${index}"]`);

      if (row) {
        row.hidden = !checkbox.checked;
      }
    });
  }

  function setItemFilterExpanded(isExpanded) {
    const toggle = document.querySelector("#mappingItemFilterToggle");
    const panel = document.querySelector("#mappingItemFilterPanel");

    if (!toggle || !panel) {
      return;
    }

    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.title = isExpanded ? "표시 항목 닫기" : "표시 항목 열기";

    if (isExpanded) {
      panel.hidden = false;
      setItemFilterFullHeight();
    }

    animateItemFilterPanel(panel, isExpanded);
  }

  function animateItemFilterPanel(panel, isExpanded) {
    panel.getAnimations?.().forEach((animation) => animation.cancel());
    panel.style.removeProperty("overflow");

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion || typeof panel.animate !== "function") {
      panel.hidden = !isExpanded;
      return;
    }

    const expandedHeight = Math.max(0, panel.getBoundingClientRect().height);
    const panelStyle = window.getComputedStyle(panel);
    const expandedFrame = {
      height: `${expandedHeight}px`,
      opacity: 1,
      paddingTop: panelStyle.paddingTop,
      paddingBottom: panelStyle.paddingBottom,
      borderTopWidth: panelStyle.borderTopWidth,
    };
    const collapsedFrame = {
      height: "0px",
      opacity: 0,
      paddingTop: "0px",
      paddingBottom: "0px",
      borderTopWidth: "0px",
    };
    const animation = panel.animate(
      isExpanded ? [collapsedFrame, expandedFrame] : [expandedFrame, collapsedFrame],
      {
        duration: isExpanded ? ITEM_FILTER_MOTION_MS : 130,
        easing: isExpanded
          ? "cubic-bezier(0.22, 1, 0.36, 1)"
          : "cubic-bezier(0.4, 0, 1, 1)",
        fill: "both",
      },
    );

    panel.style.overflow = "hidden";
    animation.addEventListener("finish", () => {
      const remainsExpanded = isItemFilterExpanded();

      if (!remainsExpanded) {
        panel.hidden = true;
      }

      animation.cancel();
      panel.style.removeProperty("overflow");
    });
  }

  function isItemFilterExpanded() {
    return document.querySelector("#mappingItemFilterToggle")?.getAttribute("aria-expanded") === "true";
  }

  function setItemFilterFullHeight() {
    const panel = document.querySelector("#mappingItemFilterPanel");
    const search = document.querySelector("#mappingItemFilterSearch");
    const optionLabels = Array.from(document.querySelectorAll("[data-mapping-filter-option]"));
    const noResults = document.querySelector("#mappingItemFilterNoResults");

    if (!panel || panel.hidden) {
      return;
    }

    panel.style.height = "auto";
    optionLabels.forEach((label) => {
      label.hidden = false;
    });

    if (noResults) {
      noResults.hidden = true;
    }

    const borderHeight = panel.offsetHeight - panel.clientHeight;
    panel.style.height = `${panel.scrollHeight + borderHeight}px`;
    filterItemOptions(search?.value || "");
  }

  function filterItemOptions(keyword) {
    const normalizedKeyword = normalizeName(keyword).toLocaleLowerCase("ko");
    const optionLabels = Array.from(document.querySelectorAll("[data-mapping-filter-option]"));
    const noResults = document.querySelector("#mappingItemFilterNoResults");
    let resultCount = 0;

    optionLabels.forEach((label) => {
      const index = Number(label.dataset.mappingFilterOption);
      const row = currentMappedList[index];
      const searchableText = row ? `${row.itemName} ${row.itemKey}`.toLocaleLowerCase("ko") : "";
      const isMatch = !normalizedKeyword || searchableText.includes(normalizedKeyword);
      label.hidden = !isMatch;
      resultCount += isMatch ? 1 : 0;
    });

    if (noResults) {
      noResults.hidden = resultCount > 0;
    }
  }

  function renderItemFilter(mappedList) {
    const filter = document.querySelector("#mappingItemFilter");
    const options = document.querySelector("#mappingItemFilterOptions");

    if (!filter || !options) {
      return;
    }

    currentMappedList = mappedList;
    filter.hidden = mappedList.length === 0;
    options.innerHTML = mappedList
      .map((row, index) => ({ row, index }))
      .sort((left, right) => left.row.itemName.localeCompare(right.row.itemName, "ko"))
      .map(({ row, index }) => {
        const checked = visibleItemIds.has(getMappedItemId(row));

        return `
          <label
            class="item-filter-label"
            title="${escapeHtml(row.itemName)}"
            data-mapping-filter-option="${index}"
          >
            <input type="checkbox" data-mapping-filter-index="${index}" ${checked ? "checked" : ""} />
            <span>${escapeHtml(row.itemName)}</span>
          </label>
        `;
      })
      .join("");

    updateItemFilterState();

    const panel = document.querySelector("#mappingItemFilterPanel");

    if (panel && !panel.hidden) {
      setItemFilterFullHeight();
    } else {
      filterItemOptions(document.querySelector("#mappingItemFilterSearch")?.value || "");
    }
  }

  function renderList(target, mappedList, mappingRows) {
    const container = typeof target === "string" ? document.querySelector(target) : target;

    if (!container) {
      return;
    }

    if (!mappedList.length) {
      container.innerHTML = `<div class="empty">매핑되는 응답값이 없습니다.</div>`;
      renderItemFilter([]);
      return;
    }

    const labelMap = createLabelMap(mappingRows || mappedList);
    currentMappedList = mappedList;
    currentLabelMap = labelMap;

    container.innerHTML = mappedList
      .map(
        (row, index) =>
          `<section class="row" data-mapping-row-index="${index}">
            <div class="mapped-item">
              <div class="mapped-item-tree">${renderTreeValue(row.itemName, row.value, 0, new WeakSet(), labelMap)}</div>
              <button
                class="detail-toggle"
                type="button"
                aria-expanded="false"
                data-detail-toggle
              >세부항목보기</button>
            </div>
            <div class="mapped-item-details" data-item-details hidden></div>
          </section>`,
      )
      .join("");
    renderItemFilter(mappedList);
  }

  function handleDetailToggle(event) {
    const toggle = event.target.closest("[data-detail-toggle]");

    if (!toggle) {
      return;
    }

    const section = toggle.closest("[data-mapping-row-index]");
    const details = section?.querySelector("[data-item-details]");

    if (!section || !details) {
      return;
    }

    const isExpanded = toggle.getAttribute("aria-expanded") === "true";

    if (!details.dataset.rendered) {
      const row = currentMappedList[Number(section.dataset.mappingRowIndex)];
      details.innerHTML = row ? renderSiblingDetails(row, currentLabelMap) : "";
      details.dataset.rendered = "true";
    }

    toggle.setAttribute("aria-expanded", String(!isExpanded));
    toggle.textContent = isExpanded ? "세부항목보기" : "세부항목닫기";
    details.hidden = isExpanded;
  }

  function handleItemFilterChange(event) {
    const allCheckbox = event.target.closest("#mappingItemFilterAll");
    const itemCheckbox = event.target.closest("[data-mapping-filter-index]");

    if (!allCheckbox && !itemCheckbox) {
      return;
    }

    if (allCheckbox) {
      document.querySelectorAll("[data-mapping-filter-index]").forEach((checkbox) => {
        const index = Number(checkbox.dataset.mappingFilterIndex);
        const row = currentMappedList[index];
        checkbox.checked = allCheckbox.checked;

        if (row) {
          visibleItemIds[allCheckbox.checked ? "add" : "delete"](getMappedItemId(row));
        }
      });
    } else {
      const index = Number(itemCheckbox.dataset.mappingFilterIndex);
      const row = currentMappedList[index];

      if (row) {
        visibleItemIds[itemCheckbox.checked ? "add" : "delete"](getMappedItemId(row));
      }
    }

    saveVisibleItemIds();
    updateItemFilterState();
  }

  function handleItemFilterToggle(event) {
    const toggle = event.target.closest("#mappingItemFilterToggle");

    if (!toggle) {
      return;
    }

    setItemFilterExpanded(toggle.getAttribute("aria-expanded") !== "true");
  }

  function handleItemFilterOutsideClick(event) {
    const filter = document.querySelector("#mappingItemFilter");
    const panel = document.querySelector("#mappingItemFilterPanel");

    if (!filter || !panel || panel.hidden || filter.contains(event.target)) {
      return;
    }

    setItemFilterExpanded(false);
  }

  function handleItemFilterSearch(event) {
    const search = event.target.closest("#mappingItemFilterSearch");

    if (!search) {
      return;
    }

    filterItemOptions(search.value);
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


  function isAllowedParentMessage(event) {
    if (!window.opener || event.source !== window.opener) {
      return false;
    }

    if (window.location.origin === "null") {
      return event.origin === "null";
    }

    return event.origin === window.location.origin;
  }

  async function handleResponseMessage(event) {
    if (event.data?.type !== MESSAGE_RENDER || !isAllowedParentMessage(event)) {
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

  function handlePopupTabChange(event) {
    if (event.detail?.tabName === "response-list") {
      setItemFilterFullHeight();
    }
  }

  window.addEventListener("message", handleResponseMessage);
  window.addEventListener("resize", setItemFilterFullHeight);
  document.addEventListener("click", handleTreeToggle);
  document.addEventListener("click", handleDetailToggle);
  document.addEventListener("click", handleItemFilterToggle);
  document.addEventListener("click", handleItemFilterOutsideClick);
  document.addEventListener("change", handleItemFilterChange);
  document.addEventListener("input", handleItemFilterSearch);
  document.addEventListener(POPUP_TAB_CHANGE_EVENT, handlePopupTabChange);

  window.ResponseListPopup = Object.freeze({
    collectMatchesByKey,
    createLabelMap,
    formatValue,
    loadMapping,
    mapResponse,
    normalizeMappingRows,
    renderList,
    renderPayload: renderPopupPayload,
  });
})();

