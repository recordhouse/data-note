(() => {
  const DEFAULT_FIELD_TABLE_URL = "./data/response-fields.html";
  const DEFAULT_TARGET_SELECTOR = "#responseMappingList";
  const MESSAGE_READY = "response-mapping-list-ready";
  const MESSAGE_RENDER = "response-mapping-list-render";
  const MESSAGE_RENDERED = "response-mapping-list-rendered";

  let fields = [];
  let fieldsReadyPromise = null;
  let targetSelector = DEFAULT_TARGET_SELECTOR;

  function normalizeDataName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeDataKey(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function normalizeFields(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => ({
        dataName: normalizeDataName(row.dataName || row.itemName || row.name),
        dataKey: normalizeDataKey(row.dataKey || row.itemKey || row.key),
      }))
      .filter((row) => row.dataName && row.dataKey);
  }

  function parseFieldsFromTableHtml(tableHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(tableHtml, "text/html");
    const table = doc.querySelector("table");

    if (!table) {
      return [];
    }

    return normalizeFields(
      [...table.rows].map((row) => {
        const cells = [...row.cells].filter((cell) => cell.tagName.toLowerCase() === "td");
        return {
          dataName: cells[0]?.textContent || "",
          dataKey: cells[1]?.textContent || "",
        };
      }),
    );
  }

  async function loadFields(fieldTableUrl = DEFAULT_FIELD_TABLE_URL) {
    const response = await fetch(fieldTableUrl);

    if (!response.ok) {
      throw new Error(`데이터 테이블을 불러오지 못했습니다. (${response.status})`);
    }

    fields = parseFieldsFromTableHtml(await response.text());
    return getFields();
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

  function analyze(responseJson) {
    return fields.reduce(
      (result, field) => {
        const matches = collectMatchesByKey(responseJson, field.dataKey);

        if (!matches.length) {
          return result;
        }

        const valueGroups = groupMatchesByValue(matches);

        if (valueGroups.length > 1) {
          result.exceptions.push({
            dataName: field.dataName,
            dataKey: field.dataKey,
            valueGroups,
          });
          return result;
        }

        result.rows.push({
          dataName: field.dataName,
          dataKey: field.dataKey,
          value: valueGroups[0].value,
          paths: valueGroups[0].paths,
        });

        return result;
      },
      {
        rows: [],
        exceptions: [],
      },
    );
  }

  function getRowsForRender(analysis) {
    return [
      ...analysis.rows.map((row) => ({
        dataName: row.dataName,
        value: formatValue(row.value),
        exception: false,
      })),
      ...analysis.exceptions.map((row) => ({
        dataName: row.dataName,
        value: row.valueGroups
          .map((group) => `예외 ${group.paths.join(", ")}\n${formatValue(group.value)}`)
          .join("\n\n"),
        exception: true,
      })),
    ];
  }

  function renderAnalysis(analysis, target = targetSelector) {
    const container = typeof target === "string" ? document.querySelector(target) : target;

    if (!container) {
      return analysis;
    }

    const rows = getRowsForRender(analysis);

    if (!rows.length) {
      container.innerHTML = `<div class="empty">매칭되는 응답값이 없습니다.</div>`;
      return analysis;
    }

    container.innerHTML = rows
      .map(
        (row) => `
          <div class="mapping-row${row.exception ? " exception" : ""}">
            <span class="mapping-name">${escapeHtml(row.dataName)}</span>
            <p class="mapping-value">${escapeHtml(row.value)}</p>
          </div>
        `,
      )
      .join("");

    return analysis;
  }

  async function render(responseJson, target = targetSelector) {
    await fieldsReadyPromise;
    return renderAnalysis(analyze(responseJson), target);
  }

  function getAllowedMessageOrigin() {
    return window.location.origin === "null" ? "*" : window.location.origin;
  }

  function postMessageToOpener(type, payload = {}) {
    if (!window.opener || window.opener.closed) {
      return;
    }

    window.opener.postMessage(
      {
        type,
        ...payload,
      },
      getAllowedMessageOrigin(),
    );
  }

  async function handleMessage(event) {
    if (window.location.origin !== "null" && event.origin !== window.location.origin) {
      return;
    }

    if (!event.data || event.data.type !== MESSAGE_RENDER) {
      return;
    }

    await render(event.data.responseJson);
    postMessageToOpener(MESSAGE_RENDERED);
  }

  function setFields(rows) {
    fields = normalizeFields(rows);
    return getFields();
  }

  function getFields() {
    return fields.map((field) => ({ ...field }));
  }

  function init(options = {}) {
    targetSelector = options.target || DEFAULT_TARGET_SELECTOR;
    fieldsReadyPromise = loadFields(options.fieldTableUrl || DEFAULT_FIELD_TABLE_URL);
    return fieldsReadyPromise;
  }

  window.addEventListener("message", handleMessage);

  fieldsReadyPromise = init();
  fieldsReadyPromise
    .then(() => postMessageToOpener(MESSAGE_READY))
    .catch((error) => {
      renderAnalysis(
        {
          rows: [],
          exceptions: [
            {
              dataName: "오류",
              dataKey: "fieldTable",
              valueGroups: [
                {
                  value: error.message,
                  paths: ["deploy.data"],
                },
              ],
            },
          ],
        },
        targetSelector,
      );
      postMessageToOpener(MESSAGE_READY);
    });

  window.ResponseMappingList = {
    analyze,
    getFields,
    init,
    loadFields,
    parseFieldsFromTableHtml,
    render,
    renderAnalysis,
    setFields,
  };
})();
