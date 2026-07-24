(() => {
  // 배포용 JS가 실제로 올라가는 경로로 변경합니다.
  const RESPONSE_MAPPING_POPUP_JS_PATH = "/js/response-mapping-popup.js";

  // 항목명/키값은 이 테이블에 등록합니다.
  const RESPONSE_FIELD_TABLE_HTML = `
    <table>
      <tbody>
        <tr>
          <td>거래 ID</td>
          <td>transactionId</td>
        </tr>
        <tr>
          <td>결과 코드</td>
          <td>resultCode</td>
        </tr>
        <tr>
          <td>결과 메시지</td>
          <td>resultMessage</td>
        </tr>
        <tr>
          <td>고객명</td>
          <td>customerName</td>
        </tr>
      </tbody>
    </table>
  `;

  function loadScript(src) {
    if (window.ResponseMappingPopup) {
      return Promise.resolve(window.ResponseMappingPopup);
    }

    const existingScript = document.querySelector(`script[src="${src}"]`);

    if (existingScript) {
      return new Promise((resolve, reject) => {
        existingScript.addEventListener("load", () => resolve(window.ResponseMappingPopup), {
          once: true,
        });
        existingScript.addEventListener("error", reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(window.ResponseMappingPopup);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function getResponseMappingPopup() {
    const popup = await loadScript(RESPONSE_MAPPING_POPUP_JS_PATH);

    if (!popup) {
      throw new Error("ResponseMappingPopup 로드에 실패했습니다.");
    }

    popup.setFieldsFromTableHtml(RESPONSE_FIELD_TABLE_HTML);
    return popup;
  }

  async function openResponseMappingPopup(responseJson) {
    const popup = await getResponseMappingPopup();

    popup.setResponse(responseJson);
    popup.open();
  }

  // 사이트의 통신 응답 처리 코드에서 이 함수를 호출합니다.
  window.openResponseMappingPopup = openResponseMappingPopup;
})();
