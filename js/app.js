(() => {
  let responseFieldTable = [];
  let lastResponse = null;
  let lastAnalysis = {
    mappedRows: [],
    exceptionRows: [],
  };
  let resultPopup = null;

  const dummyRequest = {
    endpoint: "/api/test-transfer",
    method: "POST",
    body: {
      serviceCode: "PAYMENT_STATUS",
      requestId: "REQ-20260724-0001",
    },
  };

  const dummyResponse = {
    header: {
      transactionId: "TX-20260724-47291",
      processedAt: "2026-07-24T14:32:18+09:00",
    },
    result: {
      resultCode: "0000",
      resultMessage: "정상 처리",
    },
    payment: {
      approvalNumber: "A9321845",
      amount: 128500,
      currency: "KRW",
      paymentMethod: "CARD",
      card: {
        issuerName: "테스트카드",
      },
    },
    customer: {
      customerName: "홍길동",
    },
    details: [
      {
        memo: "테스트용 더미 응답입니다.",
      },
    ],
    audit: {
      resultCode: "0000",
      amount: 128500,
    },
    debug: {
      unmappedDebugId: "DBG-7740",
    },
  };

  const sendButton = document.querySelector("#sendButton");
  const statusBadge = document.querySelector("#statusBadge");
  const emptyState = document.querySelector("#emptyState");
  const resultGrid = document.querySelector("#resultGrid");
  const mappingTable = document.querySelector("#mappingTable");
  const mappingCount = document.querySelector("#mappingCount");
  const matchedCount = document.querySelector("#matchedCount");
  const rawResponse = document.querySelector("#rawResponse");
  const transactionLog = document.querySelector("#transactionLog");
  const fieldSourceFrame = document.querySelector("#fieldSourceFrame");
  const exceptionPanel = document.querySelector("#exceptionPanel");
  const exceptionCount = document.querySelector("#exceptionCount");
  const exceptionList = document.querySelector("#exceptionList");

  function formatValue(value) {
    if (typeof value === "number") {
      return new Intl.NumberFormat("ko-KR").format(value);
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  function isComplexValue(value) {
    return Array.isArray(value) || (value && typeof value === "object");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isPopupOpen() {
    return resultPopup && !resultPopup.closed;
  }

  function getPopupRows(mappedRows, exceptionRows) {
    return [
      ...mappedRows.map((row) => ({
        itemName: row.itemName,
        value: formatValue(row.value),
      })),
      ...exceptionRows.map((row) => ({
        itemName: row.itemName,
        value: `예외: 서로 다른 값 ${row.valueGroups.length}개`,
      })),
    ];
  }

  function getPopupTableRows(mappedRows, exceptionRows) {
    const popupRows = getPopupRows(mappedRows, exceptionRows);

    if (!popupRows.length) {
      return `
        <tr>
          <td colspan="2">통신 테스트 후 항목이 표시됩니다.</td>
        </tr>
      `;
    }

    return popupRows
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

  function getPopupDocument(mappedRows = [], exceptionRows = []) {
    return `<!doctype html>
      <html lang="ko">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>응답 항목 리스트</title>
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
          <table aria-label="응답 항목 값 리스트">
            <thead>
              <tr>
                <th>항목명</th>
                <th>값</th>
              </tr>
            </thead>
            <tbody id="popupResultBody">
              ${getPopupTableRows(mappedRows, exceptionRows)}
            </tbody>
          </table>
        </body>
      </html>`;
  }

  function renderPopupResults(mappedRows, exceptionRows) {
    if (!isPopupOpen()) {
      return;
    }

    const popupBody = resultPopup.document.querySelector("#popupResultBody");

    if (!popupBody) {
      return;
    }

    popupBody.innerHTML = getPopupTableRows(mappedRows, exceptionRows);
  }

  function openResultPopup() {
    resultPopup = window.open(
      "",
      "responseResultPopup",
      "popup=yes,width=620,height=720,left=120,top=80",
    );

    if (!resultPopup) {
      statusBadge.textContent = "팝업 차단";
      statusBadge.classList.remove("success");
      statusBadge.classList.add("warning");
      return;
    }

    resultPopup.document.open();
    resultPopup.document.write(
      getPopupDocument(lastAnalysis.mappedRows, lastAnalysis.exceptionRows),
    );
    resultPopup.document.close();
    resultPopup.focus();
  }

  function handleShortcut(event) {
    if (!event.altKey || event.code !== "Digit1" || event.repeat) {
      return;
    }

    event.preventDefault();
    openResultPopup();
  }

  function renderMappingTable() {
    mappingTable.innerHTML = responseFieldTable.length
      ? responseFieldTable
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.itemName)}</td>
                <td><code>${escapeHtml(row.itemKey)}</code></td>
              </tr>
            `,
          )
          .join("")
      : `
          <tr>
            <td colspan="2">매핑 테이블을 불러오는 중입니다.</td>
          </tr>
        `;

    mappingCount.textContent = `${responseFieldTable.length}개 항목`;
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

    for (const [key, value] of Object.entries(source)) {
      const currentPath = getObjectPath(path, key);

      if (key === targetKey) {
        matches.push({
          path: currentPath,
          value,
        });
      }

      collectMatchesByKey(value, targetKey, currentPath, matches);
    }

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

  function getResponseAnalysis(response) {
    return responseFieldTable.reduce(
      (analysis, row) => {
        const matches = collectMatchesByKey(response, row.itemKey);

        if (!matches.length) {
          return analysis;
        }

        const valueGroups = groupMatchesByValue(matches);

        if (valueGroups.length > 1) {
          analysis.exceptionRows.push({
            itemName: row.itemName,
            itemKey: row.itemKey,
            valueGroups,
          });

          return analysis;
        }

        analysis.mappedRows.push({
          itemName: row.itemName,
          itemKey: row.itemKey,
          value: matches[0].value,
          paths: matches.map((match) => match.path),
        });

        return analysis;
      },
      {
        mappedRows: [],
        exceptionRows: [],
      },
    );
  }

  function renderMappedResponse(mappedRows) {
    resultGrid.innerHTML = mappedRows
      .map((row) => {
        const valueClass = isComplexValue(row.value)
          ? "result-value code-value"
          : "result-value";

        return `
          <section class="result-card">
            <p class="result-name">${escapeHtml(row.itemName)}</p>
            <p class="${valueClass}">${escapeHtml(formatValue(row.value))}</p>
            <code class="result-key">${escapeHtml(row.itemKey)}</code>
            <span class="result-paths">${escapeHtml(
              row.paths.length > 1
                ? `${row.paths.length}곳 발견: ${row.paths.join(", ")}`
                : row.paths[0],
            )}</span>
          </section>
        `;
      })
      .join("");

    emptyState.hidden = mappedRows.length > 0;
    resultGrid.hidden = mappedRows.length === 0;
    matchedCount.textContent = `${mappedRows.length}건`;
  }

  function renderExceptionBox(exceptionRows) {
    exceptionPanel.hidden = exceptionRows.length === 0;
    exceptionCount.textContent = `${exceptionRows.length}건`;
    exceptionList.innerHTML = exceptionRows
      .map(
        (row) => `
          <section class="exception-item">
            <p class="exception-title">${escapeHtml(row.itemName)}</p>
            <code class="exception-key">${escapeHtml(row.itemKey)}</code>
            <div class="exception-value-list">
              ${row.valueGroups
                .map(
                  (group) => `
                    <div class="exception-value">
                      <span class="exception-path">${escapeHtml(group.paths.join(", "))}</span>
                      <span class="exception-text">${escapeHtml(formatValue(group.value))}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
        `,
      )
      .join("");
  }

  function renderTransactionLog(response, mappedRows, exceptionRows) {
    const handledKeys = new Set([
      ...mappedRows.map((row) => row.itemKey),
      ...exceptionRows.map((row) => row.itemKey),
    ]);
    const unmatchedKeys = [...collectResponseKeys(response)].filter(
      (key) => !handledKeys.has(key),
    );

    transactionLog.innerHTML = `
      <div class="step-row">
        <span class="step-label">요청</span>
        <p class="step-value">${escapeHtml(dummyRequest.method)} ${escapeHtml(dummyRequest.endpoint)}<br />requestId: ${escapeHtml(dummyRequest.body.requestId)}</p>
      </div>
      <div class="step-row">
        <span class="step-label">응답</span>
        <p class="step-value">더미 JSON 응답 수신 완료</p>
      </div>
      <div class="step-row">
        <span class="step-label">매칭</span>
        <p class="step-value">${mappedRows.length}개 키가 항목이름으로 변환되었습니다.</p>
      </div>
      <div class="step-row">
        <span class="step-label">예외</span>
        <p class="step-value">${exceptionRows.length ? `${exceptionRows.length}개 키에서 서로 다른 값이 발견되었습니다.` : "없음"}</p>
      </div>
      <div class="step-row">
        <span class="step-label">미매칭</span>
        <p class="step-value unmatched">${escapeHtml(unmatchedKeys.length ? unmatchedKeys.join(", ") : "없음")}</p>
      </div>
    `;
  }

  function sendTestMessage() {
    sendButton.disabled = true;
    statusBadge.textContent = "전송중";
    statusBadge.classList.remove("success", "warning");

    window.setTimeout(() => {
      const response = { ...dummyResponse };
      lastResponse = response;
      const { mappedRows, exceptionRows } = getResponseAnalysis(response);

      rawResponse.textContent = JSON.stringify(response, null, 2);
      renderMappedResponse(mappedRows);
      renderExceptionBox(exceptionRows);
      renderTransactionLog(response, mappedRows, exceptionRows);
      lastAnalysis = {
        mappedRows,
        exceptionRows,
      };
      renderPopupResults(mappedRows, exceptionRows);

      if (exceptionRows.length) {
        statusBadge.textContent = "예외 확인";
        statusBadge.classList.add("warning");
      } else {
        statusBadge.textContent = "응답 완료";
        statusBadge.classList.add("success");
      }

      sendButton.disabled = false;
    }, 450);
  }

  function normalizeFieldRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => ({
        itemName: String(row.itemName || "").trim(),
        itemKey: String(row.itemKey || "").trim(),
      }))
      .filter((row) => row.itemName && row.itemKey);
  }

  function handleFieldTableMessage(event) {
    if (event.source !== fieldSourceFrame.contentWindow) {
      return;
    }

    if (!event.data || event.data.type !== "response-field-table") {
      return;
    }

    responseFieldTable = normalizeFieldRows(event.data.rows);
    renderMappingTable();

    if (lastResponse) {
      const { mappedRows, exceptionRows } = getResponseAnalysis(lastResponse);
      renderMappedResponse(mappedRows);
      renderExceptionBox(exceptionRows);
      renderTransactionLog(lastResponse, mappedRows, exceptionRows);
      lastAnalysis = {
        mappedRows,
        exceptionRows,
      };
      renderPopupResults(mappedRows, exceptionRows);
    }
  }

  renderMappingTable();
  window.addEventListener("message", handleFieldTableMessage);
  window.addEventListener("keydown", handleShortcut);
  fieldSourceFrame.src = "./data/response-fields.html";
  sendButton.addEventListener("click", sendTestMessage);
})();
