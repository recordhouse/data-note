(() => {
  const rows = [...document.querySelectorAll("#responseFieldTable tbody tr")]
    .map((row) => {
      const cells = row.querySelectorAll("td");

      return {
        itemName: cells[0]?.textContent.trim() || "",
        itemKey: cells[1]?.textContent.trim() || "",
      };
    })
    .filter((row) => row.itemName && row.itemKey);

  window.parent.postMessage(
    {
      type: "response-field-table",
      rows,
    },
    "*",
  );
})();
