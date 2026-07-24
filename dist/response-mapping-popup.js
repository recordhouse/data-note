(() => {
  const DEFAULT_FIELD_TABLE_HTML = `
    <table>
      <tbody>
        <!-- 배포 사이트에서 확인할 항목을 아래처럼 등록합니다. -->
        <!--
        <tr>
          <td>거래 ID</td>
          <td>transactionId</td>
        </tr>
        <tr>
          <td>결과 코드</td>
          <td>resultCode</td>
        </tr>
        -->
      </tbody>
    </table>
  `;

  const DEFAULT_FIELD_TABLE_SELECTOR = "#responseMappingFieldTable, [data-response-mapping-fields]";
  const POPUP_NAME = "responseMappingPopup";
  const SHORTCUT_KEY_CODE = "Digit1";

  let fieldTable = [];
  let lastResponse = null;
  let lastAnalysis = {
    mappedRows: [],
    exceptionRows: [],
    unmatchedKeys: [],
  };
  let popupWindow = null;

  function normalizeFieldRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => ({
        itemName: String(row.itemName || row.name || "").trim(),
        itemKey: String(row.itemKey || row.key || "").trim(),
      }))
      .filter((row) => row.itemName && row.itemKey);
  }

  function getFieldTableElement(tableOrSelector) {
    if (typeof tableOrSelector === "string") {
      return document.querySelector(tableOrSelector);
    }

    if (tableOrSelector && typeof tableOrSelector.querySelectorAll === "function") {
      return tableOrSelector;
    }

    return null;
  }

  function readFieldsFromTable(tableOrSelector = DEFAULT_FIELD_TABLE_SELECTOR) {
    if (typeof document === "undefined") {
      return [];
    }

    const table = getFieldTableElement(tableOrSelector);

    if (!table) {
      return [];
    }

    return normalizeFieldRows(
      [...table.querySelectorAll("tr")].map((row) => {
        const cells = row.querySelectorAll("td");

        return {
          itemName: cells[0]?.textContent || "",
          itemKey: cells[1]?.textContent || "",
        };
      }),
    );
  }

  function readFieldsFromTableHtml(tableHtml = DEFAULT_FIELD_TABLE_HTML) {
    if (typeof document === "undefined" || !tableHtml.trim()) {
      return [];
    }

    const template = document.createElement("template");
    template.innerHTML = tableHtml.trim();
    return readFieldsFromTable(template.content);
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
    if (typeof value === "number") {
      return new Intl.NumberFormat("ko-KR").format(value);
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  function getObjectPath(parentPath, key) {
    const isSimpleKey = /^[A-Za-z_$][\w$]*$/.test(key);
    return isSimpleKey ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
  }

  function collectMatchesByKey(source, targetKey, path = "$", matches = []) {
    if (Array.isArray(source)) {
      source.forEach((item, index) =>
        collectMatchesByKey(item, targetKey, `${path}[${index}]`, matches),
      );
      return matches;
    }

    if (!source || typeof source !== "object") {
      return matches;
    }

    Object.entries(source).forEach(([key, value]) => {
      const currentPath = getObjectPath(path, key);

      if (key === targetKey) {
        matches.push({
          path: currentPath,
          value,
        });
      }

      collectMatchesByKey(value, targetKey, currentPath, matches);
    });

    return matches;
  }

  function collectResponseKeys(source, keys = new Set()) {
    if (Array.isArray(source)) {
      source.forEach((item) => collectResponseKeys(item, keys));
      return keys;
    }

    if (!source || typeof source !== "object") {
      return keys;
    }

    Object.entries(source).forEach(([key, value]) => {
      keys.add(key);
      collectResponseKeys(value, keys);
    });

    return keys;
  }

  function getValueSignature(value) {
    if (value === null) {
      return "null";
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => getValueSignature(item)).join(",")}]`;
    }

    if (typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${getValueSignature(value[key])}`)
        .join(",")}}`;
    }

    return `${typeof value}:${String(value)}`;
  }

  function groupMatchesByValue(matches) {
    const groups = new Map();

    matches.forEach((match) => {
      const signature = getValueSignature(match.value);
      const group = groups.get(signature) || {
        value: match.value,
        paths: [],
      };

      group.paths.push(match.path);
      groups.set(signature, group);
    });

    return [...groups.values()];
  }

  function analyzeResponse(response) {
    const analysis = fieldTable.reduce(
      (result, row) => {
        const matches = collectMatchesByKey(response, row.itemKey);

        if (!matches.length) {
          return result;
        }

        const valueGroups = groupMatchesByValue(matches);

        if (valueGroups.length > 1) {
          result.exceptionRows.push({
            itemName: row.itemName,
            itemKey: row.itemKey,
            valueGroups,
          });

          return result;
        }

        result.mappedRows.push({
          itemName: row.itemName,
          itemKey: row.itemKey,
          value: matches[0].value,
          paths: matches.map((match) => match.path),
        });

        return result;
      },
      {
        mappedRows: [],
        exceptionRows: [],
        unmatchedKeys: [],
      },
    );

    const handledKeys = new Set([
      ...analysis.mappedRows.map((row) => row.itemKey),
      ...analysis.exceptionRows.map((row) => row.itemKey),
    ]);

    analysis.unmatchedKeys = [...collectResponseKeys(response)].filter((key) => !handledKeys.has(key));
    return analysis;
  }

  function getPopupRows(analysis) {
    return [
      ...analysis.mappedRows.map((row) => ({
        itemName: row.itemName,
        value: formatValue(row.value),
      })),
      ...analysis.exceptionRows.map((row) => ({
        itemName: row.itemName,
        value: row.valueGroups
          .map(
            (group) =>
              `예외 ${group.paths.join(", ")}\n${formatValue(group.value)}`,
          )
          .join("\n\n"),
      })),
    ];
  }

  function getPopupTableRows(analysis) {
    const rows = getPopupRows(analysis);

    if (!rows.length) {
      return `
        <tr>
          <td colspan="2">아직 매핑된 응답값이 없습니다.</td>
        </tr>
      `;
    }

    return rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.itemName)}</td>
            <td>${escapeHtml(row.value)}</td>
          </tr>
        `,
      )
      .join("");
  }

  function getPopupDocument() {
    return `<!doctype html>
      <html lang="ko">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>응답 매핑 리스트</title>
          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 16px;
              background: #ffffff;
              color: #17202a;
              font-family:
                Pretendard, "Noto Sans KR", system-ui, -apple-system, BlinkMacSystemFont,
                "Segoe UI", sans-serif;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 13px;
            }

            th,
            td {
              padding: 11px 10px;
              border: 1px solid #d9e1ea;
              text-align: left;
              vertical-align: top;
              overflow-wrap: anywhere;
              white-space: pre-wrap;
            }

            th {
              background: #f8fafc;
              color: #52616f;
              font-size: 12px;
              font-weight: 800;
            }
          </style>
        </head>
        <body>
          <table aria-label="응답 매핑 리스트">
            <thead>
              <tr>
                <th>항목명</th>
                <th>값</th>
              </tr>
            </thead>
            <tbody id="responseMappingPopupBody">
              ${getPopupTableRows(lastAnalysis)}
            </tbody>
          </table>
        </body>
      </html>`;
  }

  function isPopupOpen() {
    return popupWindow && !popupWindow.closed;
  }

  function renderPopup() {
    if (!isPopupOpen()) {
      return;
    }

    const popupBody = popupWindow.document.querySelector("#responseMappingPopupBody");

    if (!popupBody) {
      return;
    }

    popupBody.innerHTML = getPopupTableRows(lastAnalysis);
  }

  function openPopup() {
    popupWindow = window.open(
      "",
      POPUP_NAME,
      "popup=yes,width=620,height=720,left=120,top=80",
    );

    if (!popupWindow) {
      console.warn("[ResponseMappingPopup] 팝업이 차단되었습니다.");
      return null;
    }

    popupWindow.document.open();
    popupWindow.document.write(getPopupDocument());
    popupWindow.document.close();
    popupWindow.focus();
    return popupWindow;
  }

  function refreshLastAnalysis() {
    lastAnalysis = lastResponse ? analyzeResponse(lastResponse) : lastAnalysis;
    renderPopup();
  }

  function setFields(rows) {
    fieldTable = normalizeFieldRows(rows);
    refreshLastAnalysis();
    return getFields();
  }

  function setFieldsFromTable(tableOrSelector = DEFAULT_FIELD_TABLE_SELECTOR) {
    fieldTable = readFieldsFromTable(tableOrSelector);
    refreshLastAnalysis();
    return getFields();
  }

  function setFieldsFromTableHtml(tableHtml = DEFAULT_FIELD_TABLE_HTML) {
    fieldTable = readFieldsFromTableHtml(tableHtml);
    refreshLastAnalysis();
    return getFields();
  }

  function addField(itemName, itemKey) {
    const rows = normalizeFieldRows([
      {
        itemName,
        itemKey,
      },
    ]);

    fieldTable = [...fieldTable, ...rows];
    refreshLastAnalysis();
    return getFields();
  }

  function addFields(rows) {
    fieldTable = [...fieldTable, ...normalizeFieldRows(rows)];
    refreshLastAnalysis();
    return getFields();
  }

  function addFieldsFromTable(tableOrSelector = DEFAULT_FIELD_TABLE_SELECTOR) {
    fieldTable = [...fieldTable, ...readFieldsFromTable(tableOrSelector)];
    refreshLastAnalysis();
    return getFields();
  }

  function addFieldsFromTableHtml(tableHtml = DEFAULT_FIELD_TABLE_HTML) {
    fieldTable = [...fieldTable, ...readFieldsFromTableHtml(tableHtml)];
    refreshLastAnalysis();
    return getFields();
  }

  function clearFields() {
    fieldTable = [];
    refreshLastAnalysis();
  }

  function getFields() {
    return fieldTable.map((row) => ({ ...row }));
  }

  function setResponse(response) {
    lastResponse = response;
    lastAnalysis = analyzeResponse(response);
    renderPopup();
    return getLastAnalysis();
  }

  function getLastAnalysis() {
    return {
      mappedRows: lastAnalysis.mappedRows.map((row) => ({
        ...row,
        paths: [...row.paths],
      })),
      exceptionRows: lastAnalysis.exceptionRows.map((row) => ({
        ...row,
        valueGroups: row.valueGroups.map((group) => ({
          value: group.value,
          paths: [...group.paths],
        })),
      })),
      unmatchedKeys: [...lastAnalysis.unmatchedKeys],
    };
  }

  function handleShortcut(event) {
    if (!event.altKey || event.code !== SHORTCUT_KEY_CODE || event.repeat) {
      return;
    }

    event.preventDefault();
    openPopup();
  }

  function destroy() {
    window.removeEventListener("keydown", handleShortcut);
    if (isPopupOpen()) {
      popupWindow.close();
    }
  }

  function loadDefaultFieldsFromTable() {
    if (!fieldTable.length) {
      setFieldsFromTable(DEFAULT_FIELD_TABLE_SELECTOR);
    }

    if (!fieldTable.length) {
      setFieldsFromTableHtml(DEFAULT_FIELD_TABLE_HTML);
    }
  }

  window.addEventListener("keydown", handleShortcut);

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", loadDefaultFieldsFromTable, { once: true });
    } else {
      loadDefaultFieldsFromTable();
    }
  }

  window.ResponseMappingPopup = {
    addField,
    addFields,
    addFieldsFromTable,
    addFieldsFromTableHtml,
    analyze: analyzeResponse,
    clearFields,
    close: () => {
      if (isPopupOpen()) {
        popupWindow.close();
      }
    },
    destroy,
    getFields,
    getLastAnalysis,
    open: openPopup,
    readFieldsFromTable,
    readFieldsFromTableHtml,
    setFields,
    setFieldsFromTable,
    setFieldsFromTableHtml,
    setResponse,
  };
})();
