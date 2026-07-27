async function showResponseMappingPopup(responseJson) {
  await loadResponseMappingPopupScript("/js/response-mapping-popup.js");

  return window.ResponseMappingPopup.openWithResponse(responseJson, {
    popupUrl: "/popup.html",
    mappingUrl: "/data/mapping.json"
  });
}

showResponseMappingPopup(responseJson);