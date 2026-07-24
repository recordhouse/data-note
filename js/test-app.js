(() => {
  const FIELD_TABLE_URL = "./data/response-fields.html";
  const DUMMY_RESPONSE_URL = "./dummy/response.json";

  const requestButton = document.querySelector("#requestButton");
  const deployPopupButton = document.querySelector("#deployPopupButton");
  const statusBadge = document.querySelector("#statusBadge");
  const mappingList = document.querySelector("#mappingList");
  const fieldCount = document.querySelector("#fieldCount");
  const fieldTableBody = document.querySelector("#fieldTableBody");
  const rawResponse = document.querySelector("#rawResponse");

  let fields = [];
  let lastResponseJson = null;

  function setStatus(text) {
    statusBadge.textContent = text;
  }

  function renderFieldTable() {
    fieldCount.textContent = `${fields.length}개`;
    fieldTableBody.innerHTML = fields
      .map(
        (field) => `
          <tr>
            <td>${ResponseMapper.escapeHtml(field.dataName)}</td>
            <td><code>${ResponseMapper.escapeHtml(field.dataKey)}</code></td>
          </tr>
        `,
      )
      .join("");
  }

  async function loadFields() {
    fields = await ResponseMapper.loadFieldsFromTableHtml(FIELD_TABLE_URL);
    renderFieldTable();
  }

  async function fetchDummyResponse() {
    const response = await fetch(DUMMY_RESPONSE_URL);

    if (!response.ok) {
      throw new Error(`더미 응답을 불러오지 못했습니다. (${response.status})`);
    }

    return response.json();
  }

  async function requestDummyResponse() {
    requestButton.disabled = true;
    setStatus("통신중");

    try {
      const responseJson = await fetchDummyResponse();
      const analysis = ResponseMapper.analyze(responseJson, fields);

      lastResponseJson = responseJson;
      rawResponse.textContent = JSON.stringify(responseJson, null, 2);
      ResponseMapper.renderNameValueList(mappingList, analysis);
      setStatus(`${analysis.rows.length}건 매칭`);
    } catch (error) {
      mappingList.innerHTML = `<div class="empty">${ResponseMapper.escapeHtml(error.message)}</div>`;
      setStatus("오류");
    } finally {
      requestButton.disabled = false;
    }
  }

  function renderDeployPopup(popup, responseJson) {
    if (!popup || popup.closed) {
      return;
    }

    if (popup.ResponseMappingList) {
      popup.ResponseMappingList.render(responseJson);
      popup.focus();
      return;
    }

    window.setTimeout(() => renderDeployPopup(popup, responseJson), 80);
  }

  async function openDeployPopup() {
    deployPopupButton.disabled = true;
    setStatus("배포팝업");

    try {
      const responseJson = lastResponseJson || (await fetchDummyResponse());
      const popup = window.open(
        "./deploy/index.html",
        "responseMappingDeployPopup",
        "popup=yes,width=720,height=760,left=140,top=80",
      );

      if (!popup) {
        throw new Error("팝업이 차단되었습니다.");
      }

      lastResponseJson = responseJson;
      rawResponse.textContent = JSON.stringify(responseJson, null, 2);
      renderDeployPopup(popup, responseJson);
    } catch (error) {
      mappingList.innerHTML = `<div class="empty">${ResponseMapper.escapeHtml(error.message)}</div>`;
      setStatus("오류");
    } finally {
      deployPopupButton.disabled = false;
    }
  }

  loadFields()
    .then(() => setStatus("대기중"))
    .catch((error) => {
      mappingList.innerHTML = `<div class="empty">${ResponseMapper.escapeHtml(error.message)}</div>`;
      setStatus("오류");
    });

  requestButton.addEventListener("click", requestDummyResponse);
  deployPopupButton.addEventListener("click", openDeployPopup);
})();
