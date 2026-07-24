# data-note

const popup = window.open("/deploy/index.html", "responseMappingDeployPopup");

window.addEventListener("message", (event) => {
  if (event.source !== popup) return;
  if (event.data?.type !== "response-mapping-list-ready") return;

  popup.postMessage(
    {
      type: "response-mapping-list-render",
      responseJson,
    },
    window.location.origin,
  );
});