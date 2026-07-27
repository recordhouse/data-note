const script = document.createElement("script");
script.src = "/js/response-mapping-popup.js";
document.head.appendChild(script);

window.ResponseMappingPopup.openWithResponse(responseJson, {
  popupUrl: "/popup.html",
  mappingUrl: "/data/mapping.json"
});