(() => {
  "use strict";

  if (window.UserFlowImport) {
    return;
  }

  const ARCHIVE_MANIFEST_FILE_NAME = "user-flow-manifest.json";
  const MAX_NOTICE_LENGTH = 1000;

  const DEFAULT_LIMITS = Object.freeze({
    maxArchiveBytes: 50 * 1024 * 1024,
    maxImportBytes: 10 * 1024 * 1024,
    maxImportSessions: 150,
    maxSessions: 150,
    maxSessionsPerTab: 20,
    maxTabs: 20,
  });

  function createController(options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    const getState = options.getState || (() => ({}));
    const getTabs = options.getTabs || (() => ({ tabs: [], sessionTabs: {} }));
    const setTabs = options.setTabs || (() => {});
    const getTabCounts = options.getTabCounts || (() => new Map());
    const getTabSessionCount = options.getTabSessionCount || (() => 0);
    const persistTabs = options.persistTabs || (() => false);
    const rerender = options.rerender || (() => {});
    const sendCommand = options.sendCommand || (() => false);
    const showStatus = options.showStatus || (() => {});
    const showTabLimit = options.showTabLimit || (() => {});
    let attached = false;
    let dragDepth = 0;
    let isUrlImporting = false;
    let renderedImportUrls = [];

    function configureExternalLink(selector, configuredValue) {
      const link = document.querySelector(selector);

      if (!link) {
        return;
      }

      const configuredUrl = String(configuredValue || "").trim();

      if (!configuredUrl) {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        return;
      }

      try {
        const url = new URL(configuredUrl, window.location.href);

        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("지원하지 않는 URL입니다.");
        }

        link.href = url.href;
        link.removeAttribute("aria-disabled");
      } catch {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
    }

    function configureExternalLinks() {
      configureExternalLink("#userFlowLoginButton", window.USER_FLOW_LOGIN_URL);
      configureExternalLink(
        "#userFlowCommunicationButton",
        window.USER_FLOW_COMMUNICATION_URL,
      );
    }

    function isBlocked() {
      const state = getState();
      return Boolean(state.isRecording || state.isReplaying);
    }

    function setUrlPanelOpen(isOpen) {
      const button = document.querySelector("#userFlowUrlImportButton");
      const panel = document.querySelector("#userFlowUrlImportPanel");

      if (!button || !panel) {
        return;
      }

      const nextOpen = Boolean(isOpen && !button.disabled);
      panel.hidden = !nextOpen;
      button.setAttribute("aria-expanded", String(nextOpen));

      if (nextOpen) {
        renderUrlOptions();
        window.setTimeout(() => {
          document.querySelector("#userFlowUrlImportSelect")?.focus();
        }, 0);
      }
    }

    function updateControls() {
      const importButton = document.querySelector("#userFlowImportButton");
      const urlImportButton = document.querySelector("#userFlowUrlImportButton");
      const urlImportSelect = document.querySelector("#userFlowUrlImportSelect");
      const disabled = Boolean(isBlocked() || isUrlImporting);

      if (importButton) {
        importButton.disabled = disabled;
      }

      if (urlImportButton) {
        urlImportButton.disabled = disabled;
      }

      if (urlImportSelect) {
        urlImportSelect.disabled = disabled || !renderedImportUrls.length;
      }

      if (disabled) {
        setUrlPanelOpen(false);
      }
    }

    function getImportUrls() {
      if (!Array.isArray(window.USER_FLOW_IMPORT_URLS)) {
        return [];
      }

      return window.USER_FLOW_IMPORT_URLS
        .map((item) => ({
          name: String(item?.name || "").trim().slice(0, 100),
          url: String(item?.url || "").trim(),
        }))
        .filter((item) => item.name && item.url);
    }

    function renderUrlOptions() {
      const select = document.querySelector("#userFlowUrlImportSelect");

      if (!select) {
        return;
      }

      renderedImportUrls = getImportUrls();
      select.replaceChildren();

      if (!renderedImportUrls.length) {
        const empty = document.createElement("option");
        empty.textContent = "등록된 URL이 없습니다";
        empty.disabled = true;
        select.appendChild(empty);
        select.size = 1;
        select.disabled = true;
        return;
      }

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "선택하세요";
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);

      renderedImportUrls.forEach((item, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = item.name;
        select.appendChild(option);
      });

      select.size = Math.min(renderedImportUrls.length + 1, 6);
      select.disabled = Boolean(isUrlImporting || isBlocked());
    }

    function getContentDispositionFileName(headerValue) {
      const encodedName = String(headerValue || "").match(
        /filename\*\s*=\s*UTF-8''([^;]+)/i,
      )?.[1];

      if (encodedName) {
        try {
          return decodeURIComponent(encodedName.trim().replace(/^"|"$/g, ""));
        } catch (error) {
          return encodedName.trim().replace(/^"|"$/g, "");
        }
      }

      return (
        String(headerValue || "")
          .match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)
          ?.slice(1)
          .find(Boolean)
          ?.trim() || ""
      );
    }

    function getImportFileMeta(response, importUrl, blob) {
      const contentType = String(
        blob.type || response.headers.get("content-type") || "",
      )
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const dispositionName = getContentDispositionFileName(
        response.headers.get("content-disposition"),
      );
      const pathnameName = decodeURIComponent(
        new URL(response.url || importUrl.href).pathname.split("/").pop() || "",
      );
      let fileName = (dispositionName || pathnameName || "user-flow")
        .split(/[\\/]/)
        .pop();
      const isZip =
        fileName.toLowerCase().endsWith(".zip") || contentType.includes("zip");
      const isJson =
        fileName.toLowerCase().endsWith(".json") || contentType.includes("json");

      if (!isZip && !isJson) {
        throw new Error("URL 응답이 JSON 또는 ZIP 파일이 아닙니다.");
      }

      const extension = isZip ? ".zip" : ".json";
      const fileType = isZip ? "application/zip" : "application/json";

      if (!fileName.toLowerCase().endsWith(extension)) {
        fileName = `${fileName.replace(/\.(?:json|zip)$/i, "")}${extension}`;
      }

      return { fileName, fileType };
    }

    async function importFromUrl(item) {
      if (isBlocked() || isUrlImporting) {
        showStatus("로그 저장 또는 재생 중에는 가져올 수 없습니다.");
        return;
      }

      let importUrl;

      try {
        importUrl = new URL(item?.url || "", window.location.href);

        if (!["http:", "https:"].includes(importUrl.protocol)) {
          throw new Error("HTTP 또는 HTTPS URL만 사용할 수 있습니다.");
        }
      } catch (error) {
        showStatus(error?.message || "등록된 URL이 올바르지 않습니다.");
        return;
      }

      isUrlImporting = true;
      setUrlPanelOpen(false);
      updateControls();
      showStatus("URL에서 가져오는 중", "ready");

      try {
        const response = await fetch(importUrl.href, {
          cache: "no-store",
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`파일 요청에 실패했습니다. (${response.status})`);
        }

        const blob = await response.blob();
        const { fileName, fileType } = getImportFileMeta(response, importUrl, blob);
        const file = new File([blob], fileName, { type: fileType });
        await importFile(file, { skipZipNameDuplicateCheck: true });
      } catch (error) {
        showStatus(
          error?.message || "URL의 JSON 또는 ZIP 파일을 가져오지 못했습니다.",
        );
      } finally {
        isUrlImporting = false;
        updateControls();
      }
    }

    function isJsonFile(file) {
      return Boolean(
        file &&
          (file.type === "application/json" ||
            file.name.toLowerCase().endsWith(".json")),
      );
    }

    function isZipFile(file) {
      return Boolean(
        file &&
          (["application/zip", "application/x-zip-compressed"].includes(
            file.type,
          ) || file.name.toLowerCase().endsWith(".zip")),
      );
    }

    function isImportFile(file) {
      return isJsonFile(file) || isZipFile(file);
    }

    function getArchiveFolderName(entryName) {
      const [folderName = ""] = String(entryName || "").split("/");
      const normalizedName = folderName.trim().slice(0, 30);

      if (!normalizedName || normalizedName === "__MACOSX") {
        return "";
      }

      return normalizedName;
    }

    function getImportCandidates(importData) {
      if (Array.isArray(importData?.sessions)) {
        return importData.sessions;
      }

      if (importData?.session) {
        return [importData.session];
      }

      return Array.isArray(importData?.events) ? [importData] : [];
    }

    function normalizeNotice(value) {
      return String(value || "")
        .replace(/\r\n?/g, "\n")
        .trim()
        .slice(0, MAX_NOTICE_LENGTH);
    }

    function readArchiveManifest(entries) {
      const manifestEntry = entries.find(
        (entry) =>
          !entry.isDirectory && entry.name === ARCHIVE_MANIFEST_FILE_NAME,
      );

      if (!manifestEntry) {
        return { hasNotice: false, notice: "" };
      }

      let manifest;

      try {
        manifest = JSON.parse(manifestEntry.text());
      } catch (error) {
        throw new Error("ZIP 알림 메타데이터 형식이 올바르지 않습니다.");
      }

      return {
        hasNotice: Object.prototype.hasOwnProperty.call(manifest || {}, "notice"),
        notice: normalizeNotice(manifest?.notice),
      };
    }

    function applyImportedNotice(importData) {
      if (
        !importData ||
        typeof importData !== "object" ||
        !Object.prototype.hasOwnProperty.call(importData, "notice")
      ) {
        return;
      }

      const tabsState = getTabs();
      const previousNotice = tabsState.notice;
      tabsState.notice = normalizeNotice(importData.notice);

      if (!persistTabs()) {
        tabsState.notice = previousNotice;
        return;
      }

      rerender();
    }

    function createArchiveSessionId(candidate, reservedIds) {
      const requestedId =
        typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 160) : "";

      if (requestedId) {
        if (reservedIds.has(requestedId)) {
          return "";
        }

        reservedIds.add(requestedId);
        return requestedId;
      }

      const recordedAt = Number(candidate?.recordedAt) || Date.now();
      let sessionId = "";

      do {
        sessionId = `recording-${Math.round(recordedAt)}-import-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
      } while (reservedIds.has(sessionId));

      reservedIds.add(sessionId);
      return sessionId;
    }

    function ensureArchiveTabs(folderNames) {
      const tabsState = getTabs();
      const tabByName = new Map(
        tabsState.tabs.map((tab) => [tab.name.toLowerCase(), tab]),
      );
      const folderNameByKey = new Map();

      folderNames.forEach((name) => {
        const normalizedName = name.trim();

        if (normalizedName && !folderNameByKey.has(normalizedName.toLowerCase())) {
          folderNameByKey.set(normalizedName.toLowerCase(), normalizedName);
        }
      });

      const normalizedFolderNames = Array.from(folderNameByKey.values());
      const missingFolderNames = normalizedFolderNames.filter(
        (name) => !tabByName.has(name.toLowerCase()),
      );

      if (tabsState.tabs.length + missingFolderNames.length > limits.maxTabs) {
        throw new Error(
          `가져온 폴더를 추가하면 탭 ${limits.maxTabs}개를 초과합니다.`,
        );
      }

      missingFolderNames.forEach((name, index) => {
        const tab = {
          id: `tab-import-${Date.now()}-${index}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          name,
        };

        tabsState.tabs.push(tab);
        tabByName.set(name.toLowerCase(), tab);
      });

      return tabByName;
    }

    async function importArchive(
      file,
      { skipZipNameDuplicateCheck = false } = {},
    ) {
      if (!window.UserFlowArchive) {
        throw new Error("ZIP 모듈을 불러오지 못했습니다.");
      }

      const state = getState();
      const tabsState = getTabs();
      const importSourceZipName = String(file?.name || "").trim().slice(0, 255);
      const normalizedZipName = importSourceZipName.toLowerCase();
      const isDuplicateZip = (state.sessions || []).some(
        (session) =>
          normalizedZipName &&
          String(session.importSourceZipName || "").trim().toLowerCase() ===
            normalizedZipName,
      );

      if (!skipZipNameDuplicateCheck && isDuplicateZip) {
        throw new Error(`${importSourceZipName} 파일은 이미 가져왔습니다.`);
      }

      const entries = await window.UserFlowArchive.readArchive(file);
      const archiveManifest = readArchiveManifest(entries);
      const archiveEntries = entries.filter(
        (entry) =>
          entry.name !== ARCHIVE_MANIFEST_FILE_NAME &&
          getArchiveFolderName(entry.name),
      );
      const folderNames = archiveEntries
        .map((entry) => getArchiveFolderName(entry.name))
        .filter(Boolean);

      if (!folderNames.length) {
        throw new Error("탭 폴더가 들어 있는 ZIP 파일이 아닙니다.");
      }

      const reservedIds = new Set(
        (state.sessions || []).map((session) => session.id),
      );
      const importedSessions = [];
      const importedSessionFolders = new Map();
      let archiveSessionCount = 0;

      archiveEntries
        .filter(
          (entry) =>
            !entry.isDirectory &&
            entry.name.toLowerCase().endsWith(".json") &&
            entry.name.split("/").filter(Boolean).length >= 2,
        )
        .forEach((entry) => {
          let importData;

          try {
            importData = JSON.parse(entry.text());
          } catch (error) {
            throw new Error(`${entry.name} 파일의 JSON 형식이 올바르지 않습니다.`);
          }

          const folderName = getArchiveFolderName(entry.name);

          getImportCandidates(importData).forEach((candidate) => {
            if (
              !candidate ||
              typeof candidate !== "object" ||
              !Array.isArray(candidate.events)
            ) {
              return;
            }

            archiveSessionCount += 1;

            if (importedSessions.length >= limits.maxImportSessions) {
              throw new Error(
                `한 번에 로그 ${limits.maxImportSessions}개까지 가져올 수 있습니다.`,
              );
            }

            const sessionId = createArchiveSessionId(candidate, reservedIds);

            if (!sessionId) {
              return;
            }

            importedSessions.push({
              ...candidate,
              id: sessionId,
              importSourceZipName,
            });
            importedSessionFolders.set(sessionId, folderName);
          });
        });

      if (
        archiveSessionCount &&
        !importedSessions.length &&
        !skipZipNameDuplicateCheck
      ) {
        throw new Error("ZIP 파일의 로그가 이미 목록에 추가되어 있습니다.");
      }

      const previousTabs = JSON.parse(JSON.stringify(tabsState));

      try {
        const tabByName = ensureArchiveTabs(folderNames);
        const tabCounts = getTabCounts(state.sessions || []);

        if (archiveManifest.hasNotice) {
          tabsState.notice = archiveManifest.notice;
        }

        if ((state.sessions || []).length + importedSessions.length > limits.maxSessions) {
          throw new Error(
            `전체 로그는 최대 ${limits.maxSessions}개까지 저장할 수 있습니다.`,
          );
        }

        importedSessions.forEach((session) => {
          const folderName = importedSessionFolders.get(session.id);
          const tab = tabByName.get(folderName.toLowerCase());

          if (!tab) {
            return;
          }

          const tabSessionCount = Number(tabCounts.get(tab.id) || 0);

          if (tabSessionCount >= limits.maxSessionsPerTab) {
            throw new Error(
              `${tab.name} 탭에는 로그를 최대 ${limits.maxSessionsPerTab}개까지 가져올 수 있습니다.`,
            );
          }

          tabsState.sessionTabs[session.id] = tab.id;
          tabCounts.set(tab.id, tabSessionCount + 1);
        });

        const firstImportedTab = tabByName.get(folderNames[0].toLowerCase());

        if (firstImportedTab) {
          tabsState.activeTabId = firstImportedTab.id;
        }

        if (!persistTabs()) {
          throw new Error("가져온 탭 구성을 저장하지 못했습니다.");
        }

        if (!importedSessions.length) {
          rerender();
          showStatus(
            archiveSessionCount
              ? "새로 가져올 로그가 없습니다. 알림과 탭 구성을 적용했습니다."
              : "빈 탭 폴더를 가져왔습니다.",
            "ready",
          );
          return;
        }

        const importedTabCount = new Set(
          folderNames.map((name) => name.toLowerCase()),
        ).size;
        showStatus(
          `탭 ${importedTabCount}개 · 로그 ${importedSessions.length}개 가져오는 중`,
          "ready",
        );

        if (
          !sendCommand("import-recordings", {
            importData: { sessions: importedSessions },
            skipZipNameDuplicateCheck,
          })
        ) {
          throw new Error("사이트에 연결할 수 없습니다.");
        }
      } catch (error) {
        setTabs(previousTabs);
        persistTabs();
        throw error;
      }
    }

    async function importFile(file, { skipZipNameDuplicateCheck = false } = {}) {
      if (isBlocked()) {
        showStatus("로그 저장 또는 재생 중에는 가져올 수 없습니다.");
        return;
      }

      if (!isImportFile(file)) {
        showStatus("JSON 또는 ZIP 파일만 가져올 수 있습니다.");
        return;
      }

      const maxImportBytes = isZipFile(file)
        ? limits.maxArchiveBytes
        : limits.maxImportBytes;

      if (file.size > maxImportBytes) {
        showStatus(
          isZipFile(file)
            ? "50MB 이하의 ZIP 파일만 가져올 수 있습니다."
            : "10MB 이하의 JSON 파일만 가져올 수 있습니다.",
        );
        return;
      }

      try {
        if (isZipFile(file)) {
          showStatus("ZIP 파일 확인 중", "ready");
          await importArchive(file, { skipZipNameDuplicateCheck });
          return;
        }

        const importData = JSON.parse(await file.text());
        const importSessionCount = getImportCandidates(importData).length;
        const tabsState = getTabs();

        if (
          importSessionCount &&
          !tabsState.tabs.some((tab) => tab.id === tabsState.activeTabId)
        ) {
          showStatus("로그를 가져오려면 목록 탭을 먼저 추가해주세요.");
          return;
        }

        const activeTabSessionCount = getTabSessionCount(tabsState.activeTabId);

        if (
          activeTabSessionCount + importSessionCount >
          limits.maxSessionsPerTab
        ) {
          showTabLimit(tabsState.activeTabId);
          return;
        }

        showStatus("가져오는 중", "ready");
        if (sendCommand("import-recordings", { importData })) {
          applyImportedNotice(importData);
        }
      } catch (error) {
        showStatus(error?.message || "가져오기 파일을 읽지 못했습니다.");
      }
    }

    function hasDraggedFiles(event) {
      return Array.from(event.dataTransfer?.types || []).includes("Files");
    }

    function resetFileDrag() {
      dragDepth = 0;
      document.body.classList.remove("is-user-flow-file-dragging");
    }

    function handleClick(event) {
      const importButton = event.target.closest("[data-user-flow-import-trigger]");
      const urlButton = event.target.closest("[data-user-flow-url-import-trigger]");

      if (importButton) {
        if (!importButton.disabled) {
          document.querySelector("#userFlowImportInput")?.click();
        }
        return;
      }

      if (urlButton) {
        if (!urlButton.disabled) {
          const isOpen = urlButton.getAttribute("aria-expanded") === "true";
          setUrlPanelOpen(!isOpen);
        }
        return;
      }

      if (!event.target.closest("#userFlowUrlImportPanel")) {
        setUrlPanelOpen(false);
      }
    }

    function handleChange(event) {
      const fileInput = event.target.closest("#userFlowImportInput");

      if (fileInput) {
        const [file] = Array.from(fileInput.files || []);
        fileInput.value = "";

        if (file) {
          importFile(file);
        }
        return;
      }

      const select = event.target.closest("#userFlowUrlImportSelect");

      if (
        !select ||
        select.disabled ||
        select.selectedIndex < 0 ||
        select.value === ""
      ) {
        return;
      }

      const item = renderedImportUrls[Number(select.value)];

      if (item) {
        importFromUrl(item);
      }
    }

    function handleKeydown(event) {
      const select = event.target.closest("#userFlowUrlImportSelect");

      if (
        event.key === "Enter" &&
        select &&
        select.selectedIndex >= 0 &&
        select.value !== ""
      ) {
        event.preventDefault();
        const item = renderedImportUrls[Number(select.value)];

        if (item) {
          importFromUrl(item);
        }
        return;
      }

      if (event.key === "Escape") {
        const panel = document.querySelector("#userFlowUrlImportPanel");

        if (panel && !panel.hidden) {
          setUrlPanelOpen(false);
          document.querySelector("#userFlowUrlImportButton")?.focus();
        }
      }
    }

    function handleDragEnter(event) {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      dragDepth += 1;
      document.body.classList.add("is-user-flow-file-dragging");
    }

    function handleDragOver(event) {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }

    function handleDragLeave(event) {
      if (!hasDraggedFiles(event)) {
        return;
      }

      dragDepth = Math.max(0, dragDepth - 1);

      if (!dragDepth) {
        document.body.classList.remove("is-user-flow-file-dragging");
      }
    }

    function handleDrop(event) {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []);
      const selectedFile = files.find(isImportFile);
      resetFileDrag();

      if (!selectedFile) {
        showStatus("JSON 또는 ZIP 파일만 가져올 수 있습니다.");
        return;
      }

      importFile(selectedFile);
    }

    function attach() {
      if (attached) {
        return;
      }

      attached = true;
      document.addEventListener("click", handleClick);
      document.addEventListener("change", handleChange);
      document.addEventListener("keydown", handleKeydown);
      document.addEventListener("dragenter", handleDragEnter);
      document.addEventListener("dragover", handleDragOver);
      document.addEventListener("dragleave", handleDragLeave);
      document.addEventListener("drop", handleDrop);
      window.addEventListener("blur", resetFileDrag);
      configureExternalLinks();
      renderUrlOptions();
    }

    return Object.freeze({
      attach,
      importFile,
      importUrl: importFromUrl,
      renderUrlOptions,
      updateControls,
    });
  }

  window.UserFlowImport = Object.freeze({ createController });
})();
