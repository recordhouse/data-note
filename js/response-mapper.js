(() => {
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

  async function loadFieldsFromTableHtml(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`데이터 테이블을 불러오지 못했습니다. (${response.status})`);
    }

    return parseFieldsFromTableHtml(await response.text());
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

  function analyze(responseJson, fields) {
    return normalizeFields(fields).reduce(
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

  function renderNameValueList(target, analysis) {
    const container = typeof target === "string" ? document.querySelector(target) : target;

    if (!container) {
      return;
    }

    const rows = [
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

    if (!rows.length) {
      container.innerHTML = `<div class="empty">매칭되는 응답값이 없습니다.</div>`;
      return;
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
  }

  window.ResponseMapper = {
    analyze,
    collectMatchesByKey,
    escapeHtml,
    formatValue,
    loadFieldsFromTableHtml,
    normalizeFields,
    parseFieldsFromTableHtml,
    renderNameValueList,
  };
})();
