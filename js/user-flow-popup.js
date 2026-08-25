(() => {
  "use strict";

  if (!document.querySelector("#userFlowPanel") || window.UserFlowPopup) {
    return;
  }

  const MESSAGE_USER_FLOW_COMMAND = "response-mapping-user-flow-command";
  const MESSAGE_USER_FLOW_STATE = "response-mapping-user-flow-state";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";
  const PARENT_READY_EVENT = "response-mapping-popup-parent-ready";
  const MAX_USER_FLOW_IMPORT_BYTES = 10 * 1024 * 1024;
  const MAX_USER_FLOW_ARCHIVE_IMPORT_BYTES = 50 * 1024 * 1024;
  const MAX_USER_FLOW_IMPORT_SESSIONS = 20;
  const USER_FLOW_TAB_STORAGE_KEY = "response-mapping-user-flow-tabs:v1";
  const DEFAULT_USER_FLOW_TAB_ID = "default";
  const MAX_USER_FLOW_TABS = 20;

  let currentUserFlowState = {};
  let editingUserFlowSessionId = "";
  let editingUserFlowTabId = "";
  let renderedUserFlowSessionSignature = "";
  let userFlowDragDepth = 0;
  let draggedUserFlowSessionId = "";
  let userFlowTabs = readUserFlowTabs();

  function createDefaultUserFlowTabs() {
    return {
      activeTabId: DEFAULT_USER_FLOW_TAB_ID,
      sessionTabs: {},
      tabs: [{ id: DEFAULT_USER_FLOW_TAB_ID, name: "Tab 01" }],
      version: 3,
    };
  }

  function getDefaultUserFlowTabName(tabNumber) {
    return `Tab ${String(tabNumber).padStart(2, "0")}`;
  }

  function normalizeLegacyUserFlowTabName(name, fallbackName) {
    const normalizedName = String(name || "").trim().slice(0, 30);

    if (!normalizedName) {
      return fallbackName;
    }

    if (normalizedName === "기본") {
      return getDefaultUserFlowTabName(1);
    }

    const legacyNameMatch = normalizedName.match(/^(?:탭|Tab)\s*(\d+)$/i);
    return legacyNameMatch
      ? getDefaultUserFlowTabName(Number(legacyNameMatch[1]))
      : normalizedName;
  }

  function readUserFlowTabs() {
    const fallback = createDefaultUserFlowTabs();

    try {
      const stored = JSON.parse(
        window.localStorage.getItem(USER_FLOW_TAB_STORAGE_KEY) || "null",
      );

      if (!stored || !Array.isArray(stored.tabs)) {
        return fallback;
      }

      const isLegacyTabs = Number(stored.version || 0) < 3;
      const storedDefaultTab = stored.tabs.find(
        (tab) => tab?.id === DEFAULT_USER_FLOW_TAB_ID,
      );
      const storedDefaultName = String(storedDefaultTab?.name || "").trim().slice(0, 30);
      const defaultName = isLegacyTabs
        ? normalizeLegacyUserFlowTabName(storedDefaultName, "Tab 01")
        : storedDefaultName || "Tab 01";
      const tabIds = new Set([DEFAULT_USER_FLOW_TAB_ID]);
      const tabs = [{ id: DEFAULT_USER_FLOW_TAB_ID, name: defaultName }];

      stored.tabs.slice(0, MAX_USER_FLOW_TABS).forEach((tab) => {
        const id = typeof tab?.id === "string" ? tab.id.trim().slice(0, 120) : "";
        const storedName =
          typeof tab?.name === "string" ? tab.name.trim().slice(0, 30) : "";
        const name = isLegacyTabs
          ? normalizeLegacyUserFlowTabName(storedName, "")
          : storedName;

        if (!id || !name || tabIds.has(id) || id === DEFAULT_USER_FLOW_TAB_ID) {
          return;
        }

        tabIds.add(id);
        tabs.push({ id, name });
      });

      const sessionTabs = {};

      if (stored.sessionTabs && typeof stored.sessionTabs === "object") {
        Object.entries(stored.sessionTabs).forEach(([sessionId, tabId]) => {
          if (sessionId && tabIds.has(tabId)) {
            sessionTabs[String(sessionId).slice(0, 200)] = tabId;
          }
        });
      }

      return {
        activeTabId: tabIds.has(stored.activeTabId)
          ? stored.activeTabId
          : DEFAULT_USER_FLOW_TAB_ID,
        sessionTabs,
        tabs,
        version: 3,
      };
    } catch (error) {
      return fallback;
    }
  }

  function persistUserFlowTabs() {
    try {
      window.localStorage.setItem(USER_FLOW_TAB_STORAGE_KEY, JSON.stringify(userFlowTabs));
      return true;
    } catch (error) {
      showUserFlowImportStatus("탭 구성을 저장하지 못했습니다.");
      return false;
    }
  }

  function reconcileUserFlowTabs(sessions, { removeMissingSessions = false } = {}) {
    const sessionIds = new Set(sessions.map((session) => session.id));
    let changed = false;

    if (removeMissingSessions) {
      Object.keys(userFlowTabs.sessionTabs).forEach((sessionId) => {
        if (!sessionIds.has(sessionId)) {
          delete userFlowTabs.sessionTabs[sessionId];
          changed = true;
        }
      });
    }

    sessions.forEach((session) => {
      if (!userFlowTabs.sessionTabs[session.id]) {
        userFlowTabs.sessionTabs[session.id] = userFlowTabs.activeTabId;
        changed = true;
      }
    });

    if (changed) {
      persistUserFlowTabs();
    }
  }

  function getUserFlowTabCounts(sessions) {
    const counts = new Map(userFlowTabs.tabs.map((tab) => [tab.id, 0]));

    sessions.forEach((session) => {
      const tabId = userFlowTabs.sessionTabs[session.id] || DEFAULT_USER_FLOW_TAB_ID;
      counts.set(tabId, (counts.get(tabId) || 0) + 1);
    });

    return counts;
  }

  function renderUserFlowTabs(sessions) {
    const tabList = document.querySelector("#userFlowListTabs");

    if (!tabList) {
      return;
    }

    const tabCounts = getUserFlowTabCounts(sessions);
    const organizationDisabled = Boolean(
      currentUserFlowState.isRecording || currentUserFlowState.isReplaying,
    );

    tabList.innerHTML = userFlowTabs.tabs
      .map((tab) => {
        const isActive = tab.id === userFlowTabs.activeTabId;
        const isEditing = tab.id === editingUserFlowTabId;
        const canDelete = tab.id !== DEFAULT_USER_FLOW_TAB_ID;

        return `
          <div
            class="user-flow-list-tab-wrap"
            data-active="${String(isActive)}"
            data-editing="${String(isEditing)}"
            data-user-flow-tab-drop="${escapeHtml(tab.id)}"
          >
            ${
              isEditing
                ? `<input
                    class="user-flow-list-tab-input"
                    id="${escapeHtml(getUserFlowTabElementId(tab.id))}"
                    type="text"
                    value="${escapeHtml(tab.name)}"
                    maxlength="30"
                    aria-label="탭 이름"
                    data-user-flow-tab-name-input="${escapeHtml(tab.id)}"
                  />
                  <span class="user-flow-list-tab-count">${Number(tabCounts.get(tab.id) || 0).toLocaleString("ko-KR")}</span>`
                : `<button
                    class="user-flow-list-tab"
                    id="${escapeHtml(getUserFlowTabElementId(tab.id))}"
                    type="button"
                    role="tab"
                    aria-selected="${String(isActive)}"
                    aria-controls="userFlowSessionList"
                    data-user-flow-tab-select="${escapeHtml(tab.id)}"
                  >
                    <span>${escapeHtml(tab.name)}</span>
                    <span class="user-flow-list-tab-count">${Number(tabCounts.get(tab.id) || 0).toLocaleString("ko-KR")}</span>
                  </button>`
            }
            <button
              class="user-flow-list-tab-edit"
              type="button"
              title="${escapeHtml(tab.name)} 탭 ${isEditing ? "저장" : "이름 수정"}"
              aria-label="${escapeHtml(tab.name)} 탭 ${isEditing ? "저장" : "이름 수정"}"
              data-user-flow-tab-edit="${escapeHtml(tab.id)}"
              ${organizationDisabled ? "disabled" : ""}
            >${isEditing ? "✓" : "✎"}</button>
            ${
              canDelete && !isEditing
                ? `<button
                    class="user-flow-list-tab-delete"
                    type="button"
                    title="${escapeHtml(tab.name)} 탭 삭제"
                    aria-label="${escapeHtml(tab.name)} 탭 삭제"
                    data-user-flow-tab-delete="${escapeHtml(tab.id)}"
                    ${organizationDisabled ? "disabled" : ""}
                  >×</button>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getUserFlowTabElementId(tabId) {
    return `userFlowListTab-${encodeURIComponent(tabId)}`;
  }

  function formatFlowDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatFlowCountdown(durationMs) {
    const totalSeconds = Math.max(0, Math.ceil((durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getUserFlowSessionMeta(session, flowState, isReplayingSession) {
    const eventCount = Number(session.eventCount || 0);

    if (isReplayingSession) {
      const completedCount = Math.min(
        eventCount,
        Math.max(0, Number(flowState.replayCompletedEventCount || 0)),
      );
      return `남은 시간 ${formatFlowCountdown(flowState.replayRemainingMs)} · 행동 ${completedCount.toLocaleString("ko-KR")}/${eventCount.toLocaleString("ko-KR")}`;
    }

    return `${eventCount.toLocaleString("ko-KR")}개 행동 · ${formatFlowDuration(session.durationMs)}`;
  }

  function getUserFlowSessionSignature(flowState, sessions) {
    return JSON.stringify({
      activeTabId: userFlowTabs.activeTabId,
      activeRecordingSessionId: flowState.activeRecordingSessionId || "",
      editingUserFlowSessionId,
      isRecording: Boolean(flowState.isRecording),
      isReplaying: Boolean(flowState.isReplaying),
      replaySessionId: flowState.replaySessionId || "",
      sessionTabs: sessions.map((session) => [
        session.id,
        userFlowTabs.sessionTabs[session.id] || DEFAULT_USER_FLOW_TAB_ID,
      ]),
      tabs: userFlowTabs.tabs,
      sessions: sessions.map((session) => ({
        durationMs: session.durationMs,
        eventCount: session.eventCount,
        id: session.id,
        name: session.name || "",
        recordedAt: session.recordedAt,
      })),
    });
  }

  function updateUserFlowSessionProgress(flowState, sessions) {
    document.querySelectorAll("[data-user-flow-session-meta]").forEach((meta) => {
      const session = sessions.find(
        (item) => item.id === meta.dataset.userFlowSessionMeta,
      );

      if (!session) {
        return;
      }

      meta.textContent = getUserFlowSessionMeta(
        session,
        flowState,
        flowState.replaySessionId === session.id,
      );
    });
  }

  function renderUserFlowState(flowState = {}) {
    currentUserFlowState = flowState;
    const status = document.querySelector("#userFlowStatus");
    const recordButton = document.querySelector("#userFlowRecordButton");
    const importButton = document.querySelector("#userFlowImportButton");
    const exportAllButton = document.querySelector("#userFlowExportAllButton");
    const tabAddButton = document.querySelector("#userFlowTabAddButton");
    const sessionCount = document.querySelector("#userFlowSessionCount");
    const sessionList = document.querySelector("#userFlowSessionList");

    if (!status || !recordButton || !sessionList) {
      return;
    }

    let statusText = "기록 없음";
    let statusState = "idle";

    if (flowState.error) {
      statusText = flowState.error;
      statusState = "error";
    } else if (flowState.isRecording) {
      statusText = "녹음 중";
      statusState = "recording";
    } else if (flowState.isReplaying) {
      statusText = "재생 중";
      statusState = "replaying";
    } else if (flowState.canReplay) {
      statusText = "재생 준비";
      statusState = "ready";
    }

    status.textContent = statusText;
    status.dataset.state = statusState;

    recordButton.textContent = flowState.isRecording ? "녹음 중지" : "녹음";
    recordButton.setAttribute("aria-pressed", String(Boolean(flowState.isRecording)));
    recordButton.disabled = Boolean(flowState.isReplaying);

    if (importButton) {
      importButton.disabled = Boolean(flowState.isRecording || flowState.isReplaying);
    }

    if (tabAddButton) {
      tabAddButton.disabled = Boolean(flowState.isRecording || flowState.isReplaying);
    }

    const hasSessionState = Array.isArray(flowState.sessions);
    const sessions = hasSessionState ? flowState.sessions : [];

    if (exportAllButton) {
      exportAllButton.disabled = Boolean(
        flowState.isRecording || flowState.isReplaying || !sessions.length,
      );
    }

    reconcileUserFlowTabs(sessions, { removeMissingSessions: hasSessionState });
    renderUserFlowTabs(sessions);
    const visibleSessions = sessions.filter(
      (session) =>
        (userFlowTabs.sessionTabs[session.id] || DEFAULT_USER_FLOW_TAB_ID) ===
        userFlowTabs.activeTabId,
    );

    if (
      flowState.isRecording ||
      flowState.isReplaying ||
      !sessions.some((session) => session.id === editingUserFlowSessionId)
    ) {
      editingUserFlowSessionId = "";
    }

    if (sessionCount) {
      sessionCount.textContent = `${visibleSessions.length.toLocaleString("ko-KR")}개`;
    }

    if (!visibleSessions.length) {
      renderedUserFlowSessionSignature = "";
      sessionList.innerHTML = `<div class="user-flow-empty">${
        sessions.length ? "이 탭에 저장된 녹음이 없습니다." : "저장된 녹음이 없습니다."
      }</div>`;
      return;
    }

    const sessionSignature = getUserFlowSessionSignature(flowState, sessions);

    if (renderedUserFlowSessionSignature === sessionSignature) {
      updateUserFlowSessionProgress(flowState, sessions);
      return;
    }

    renderedUserFlowSessionSignature = sessionSignature;

    sessionList.setAttribute(
      "aria-labelledby",
      getUserFlowTabElementId(userFlowTabs.activeTabId),
    );
    sessionList.innerHTML = visibleSessions
      .map((session) => {
        const isRecordingSession = flowState.activeRecordingSessionId === session.id;
        const isReplayingSession = flowState.replaySessionId === session.id;
        const recordedAt = session.recordedAt
          ? new Date(session.recordedAt).toLocaleString("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "녹음 일시 없음";
        const sessionName = String(session.name || "").trim();
        const assignedTabId =
          userFlowTabs.sessionTabs[session.id] || DEFAULT_USER_FLOW_TAB_ID;
        const assignedTabName =
          userFlowTabs.tabs.find((tab) => tab.id === assignedTabId)?.name || "Tab 01";
        const isEditing = editingUserFlowSessionId === session.id;
        const disabled =
          flowState.isRecording ||
          (!session.eventCount && !isReplayingSession) ||
          (flowState.isReplaying && !isReplayingSession);
        const changeDisabled = flowState.isRecording || flowState.isReplaying;
        const sessionMeta = getUserFlowSessionMeta(session, flowState, isReplayingSession);

        if (isEditing) {
          return `
            <article
              class="user-flow-session"
              draggable="false"
              data-editing="true"
              data-state="idle"
              data-user-flow-session-id="${escapeHtml(session.id)}"
            >
              <div class="user-flow-session-main">
                <form class="user-flow-name-editor" data-user-flow-name-form>
                  <span class="user-flow-session-tab-prefix">${escapeHtml(assignedTabName)} ·</span>
                  <input
                    class="user-flow-name-input"
                    type="text"
                    value="${escapeHtml(sessionName)}"
                    maxlength="40"
                    placeholder="녹음 이름"
                    aria-label="녹음 이름"
                    required
                    data-user-flow-name-input
                  />
                  <button class="user-flow-name-save" type="submit">저장</button>
                  <button class="user-flow-name-cancel" type="button" data-user-flow-name-cancel>취소</button>
                </form>
                <span class="user-flow-session-recorded-at">${escapeHtml(recordedAt)}</span>
                <span class="user-flow-session-meta" data-user-flow-session-meta="${escapeHtml(session.id)}">
                  ${escapeHtml(sessionMeta)}
                </span>
              </div>
            </article>
          `;
        }

        return `
          <article
            class="user-flow-session"
            draggable="${String(!changeDisabled)}"
            data-state="${isRecordingSession ? "recording" : isReplayingSession ? "replaying" : "idle"}"
            data-user-flow-session-id="${escapeHtml(session.id)}"
          >
            <div class="user-flow-session-main">
              <strong class="user-flow-session-time">
                <span class="user-flow-session-tab-prefix">${escapeHtml(assignedTabName)} ·</span>
                <span>${escapeHtml(sessionName || recordedAt)}</span>
              </strong>
              ${sessionName ? `<span class="user-flow-session-recorded-at">${escapeHtml(recordedAt)}</span>` : ""}
              <span class="user-flow-session-meta" data-user-flow-session-meta="${escapeHtml(session.id)}">
                ${escapeHtml(sessionMeta)}
              </span>
            </div>
            <div class="user-flow-session-controls">
              <button
                class="user-flow-replay"
                type="button"
                data-user-flow-command="toggle-replay-session"
                data-session-id="${escapeHtml(session.id)}"
                aria-pressed="${String(isReplayingSession)}"
                ${disabled ? "disabled" : ""}
              >${isReplayingSession ? "재생 중지" : "재생"}</button>
              <button
                class="user-flow-name-action"
                type="button"
                data-user-flow-name-edit
                data-session-id="${escapeHtml(session.id)}"
                ${changeDisabled ? "disabled" : ""}
              >${sessionName ? "수정" : "이름변경"}</button>
              <button
                class="user-flow-export"
                type="button"
                data-user-flow-command="export-recording"
                data-session-id="${escapeHtml(session.id)}"
                aria-label="${escapeHtml(sessionName || recordedAt)} 녹음 내보내기"
                ${changeDisabled ? "disabled" : ""}
              >내보내기</button>
              <button
                class="user-flow-delete"
                type="button"
                data-user-flow-command="delete-session"
                data-session-id="${escapeHtml(session.id)}"
                aria-label="${escapeHtml(recordedAt)} 녹음 삭제"
                ${changeDisabled ? "disabled" : ""}
              >삭제</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function sendUserFlowCommand(command, payload = {}) {
    if (!window.opener || window.opener.closed) {
      renderUserFlowState({ error: "부모 화면에 연결할 수 없습니다." });
      return false;
    }

    window.opener.postMessage(
      {
        type: MESSAGE_USER_FLOW_COMMAND,
        command,
        ...payload,
      },
      window.location.origin === "null" ? "*" : window.location.origin,
    );
    return true;
  }

  function handleUserFlowControl(event) {
    const button = event.target.closest("[data-user-flow-command]");

    if (!button || button.disabled) {
      return;
    }

    const command = button.dataset.userFlowCommand;
    const payload = {
      sessionId: button.dataset.sessionId || "",
    };

    if (command === "export-all-recordings") {
      payload.tabOrganization = {
        sessionTabs: { ...userFlowTabs.sessionTabs },
        tabs: userFlowTabs.tabs.map((tab) => ({ ...tab })),
      };
    }

    sendUserFlowCommand(command, payload);
  }

  function isUserFlowOrganizationBlocked() {
    return Boolean(currentUserFlowState.isRecording || currentUserFlowState.isReplaying);
  }

  function rerenderUserFlowOrganization() {
    editingUserFlowSessionId = "";
    renderedUserFlowSessionSignature = "";
    renderUserFlowState(currentUserFlowState);
  }

  function focusUserFlowTabNameInput() {
    window.requestAnimationFrame(() => {
      const input = document.querySelector("[data-user-flow-tab-name-input]");
      input?.focus();
      input?.select();
    });
  }

  function startEditingUserFlowTab(tabId) {
    if (!userFlowTabs.tabs.some((tab) => tab.id === tabId)) {
      return;
    }

    editingUserFlowTabId = tabId;
    userFlowTabs.activeTabId = tabId;
    persistUserFlowTabs();
    rerenderUserFlowOrganization();
    focusUserFlowTabNameInput();
  }

  function saveUserFlowTabName(tabId) {
    if (editingUserFlowTabId !== tabId) {
      return false;
    }

    const tab = userFlowTabs.tabs.find((item) => item.id === tabId);
    const input = document.querySelector("[data-user-flow-tab-name-input]");
    const tabName = String(input?.value || "").trim().slice(0, 30);

    if (!tab || !tabName) {
      showUserFlowImportStatus("탭 이름을 입력해주세요.");
      input?.focus();
      return false;
    }

    if (
      userFlowTabs.tabs.some(
        (item) => item.id !== tabId && item.name.toLowerCase() === tabName.toLowerCase(),
      )
    ) {
      showUserFlowImportStatus("같은 이름의 탭이 이미 있습니다.");
      input?.focus();
      input?.select();
      return false;
    }

    tab.name = tabName;
    editingUserFlowTabId = "";
    persistUserFlowTabs();
    rerenderUserFlowOrganization();
    return true;
  }

  function handleUserFlowTabControl(event) {
    const addButton = event.target.closest("#userFlowTabAddButton");
    const editButton = event.target.closest("[data-user-flow-tab-edit]");
    const deleteButton = event.target.closest("[data-user-flow-tab-delete]");
    const selectButton = event.target.closest("[data-user-flow-tab-select]");
    const requestedEditTabId = editButton?.dataset.userFlowTabEdit || "";

    if (
      editingUserFlowTabId &&
      requestedEditTabId !== editingUserFlowTabId &&
      !saveUserFlowTabName(editingUserFlowTabId)
    ) {
      return;
    }

    if (addButton) {
      if (addButton.disabled || isUserFlowOrganizationBlocked()) {
        return;
      }

      if (userFlowTabs.tabs.length >= MAX_USER_FLOW_TABS) {
        showUserFlowImportStatus(`탭은 최대 ${MAX_USER_FLOW_TABS}개까지 추가할 수 있습니다.`);
        return;
      }

      const usedNames = new Set(userFlowTabs.tabs.map((tab) => tab.name));
      let tabNumber = userFlowTabs.tabs.length + 1;

      while (usedNames.has(getDefaultUserFlowTabName(tabNumber))) {
        tabNumber += 1;
      }

      const tab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: getDefaultUserFlowTabName(tabNumber),
      };
      userFlowTabs.tabs.push(tab);
      userFlowTabs.activeTabId = tab.id;
      editingUserFlowTabId = "";
      persistUserFlowTabs();
      rerenderUserFlowOrganization();
      return;
    }

    if (editButton) {
      if (editButton.disabled || isUserFlowOrganizationBlocked()) {
        return;
      }

      const tabId = editButton.dataset.userFlowTabEdit;

      if (editingUserFlowTabId === tabId) {
        saveUserFlowTabName(tabId);
      } else {
        startEditingUserFlowTab(tabId);
      }
      return;
    }

    if (deleteButton) {
      if (deleteButton.disabled || isUserFlowOrganizationBlocked()) {
        return;
      }

      const tabId = deleteButton.dataset.userFlowTabDelete;
      const tab = userFlowTabs.tabs.find((item) => item.id === tabId);

      if (!tab || tab.id === DEFAULT_USER_FLOW_TAB_ID) {
        return;
      }

      const sessionCount = Object.values(userFlowTabs.sessionTabs).filter(
        (assignedTabId) => assignedTabId === tabId,
      ).length;

      if (
        sessionCount &&
        !window.confirm(
          `${tab.name} 탭을 삭제하면 녹음이 ${userFlowTabs.tabs[0].name} 탭으로 이동합니다.`,
        )
      ) {
        return;
      }

      Object.keys(userFlowTabs.sessionTabs).forEach((sessionId) => {
        if (userFlowTabs.sessionTabs[sessionId] === tabId) {
          userFlowTabs.sessionTabs[sessionId] = DEFAULT_USER_FLOW_TAB_ID;
        }
      });
      userFlowTabs.tabs = userFlowTabs.tabs.filter((item) => item.id !== tabId);

      if (userFlowTabs.activeTabId === tabId) {
        userFlowTabs.activeTabId = DEFAULT_USER_FLOW_TAB_ID;
      }

      editingUserFlowTabId = "";
      persistUserFlowTabs();
      rerenderUserFlowOrganization();
      return;
    }

    if (selectButton) {
      const tabId = selectButton.dataset.userFlowTabSelect;

      if (
        tabId === userFlowTabs.activeTabId ||
        !userFlowTabs.tabs.some((tab) => tab.id === tabId)
      ) {
        return;
      }

      userFlowTabs.activeTabId = tabId;
      editingUserFlowTabId = "";
      persistUserFlowTabs();
      rerenderUserFlowOrganization();
    }
  }

  function resetUserFlowSessionDrag() {
    draggedUserFlowSessionId = "";
    document.querySelectorAll(".user-flow-session.is-dragging").forEach((session) => {
      session.classList.remove("is-dragging");
    });
    document.querySelectorAll(".user-flow-list-tab-wrap.is-drop-target").forEach((tab) => {
      tab.classList.remove("is-drop-target");
    });
  }

  function handleUserFlowSessionDragStart(event) {
    const session = event.target.closest("[data-user-flow-session-id]");

    if (
      !session ||
      session.draggable !== true ||
      isUserFlowOrganizationBlocked() ||
      event.target.closest("button, input, select, textarea, form")
    ) {
      event.preventDefault();
      return;
    }

    draggedUserFlowSessionId = session.dataset.userFlowSessionId || "";

    if (!draggedUserFlowSessionId || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedUserFlowSessionId);
    session.classList.add("is-dragging");
  }

  function handleUserFlowTabDragOver(event) {
    const tab = event.target.closest("[data-user-flow-tab-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".user-flow-list-tab-wrap.is-drop-target").forEach((item) => {
      item.classList.toggle("is-drop-target", item === tab);
    });
  }

  function handleUserFlowSessionDrop(event) {
    const tab = event.target.closest("[data-user-flow-tab-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    const targetTabId = tab.dataset.userFlowTabDrop;

    if (userFlowTabs.tabs.some((item) => item.id === targetTabId)) {
      userFlowTabs.sessionTabs[draggedUserFlowSessionId] = targetTabId;
      userFlowTabs.activeTabId = targetTabId;
      editingUserFlowTabId = "";
      persistUserFlowTabs();
      resetUserFlowSessionDrag();
      rerenderUserFlowOrganization();
    }
  }

  function handleUserFlowTabStorage(event) {
    if (event.key !== USER_FLOW_TAB_STORAGE_KEY) {
      return;
    }

    userFlowTabs = readUserFlowTabs();
    editingUserFlowTabId = "";
    rerenderUserFlowOrganization();
  }

  function handleUserFlowTabNameKeydown(event) {
    const input = event.target.closest("[data-user-flow-tab-name-input]");

    if (!input) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      saveUserFlowTabName(input.dataset.userFlowTabNameInput);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      editingUserFlowTabId = "";
      rerenderUserFlowOrganization();
    }
  }

  function handleUserFlowTabNameFocusOut(event) {
    const input = event.target.closest("[data-user-flow-tab-name-input]");

    if (!input) {
      return;
    }

    const tabId = input.dataset.userFlowTabNameInput;
    window.setTimeout(() => {
      if (editingUserFlowTabId === tabId) {
        saveUserFlowTabName(tabId);
      }
    }, 0);
  }

  function showUserFlowImportStatus(message, statusState = "error") {
    const status = document.querySelector("#userFlowStatus");

    if (!status) {
      return;
    }

    status.textContent = message;
    status.dataset.state = statusState;
  }

  function isUserFlowImportBlocked() {
    return Boolean(currentUserFlowState.isRecording || currentUserFlowState.isReplaying);
  }

  function isJsonFile(file) {
    return Boolean(
      file &&
        (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")),
    );
  }

  function isZipFile(file) {
    return Boolean(
      file &&
        (["application/zip", "application/x-zip-compressed"].includes(file.type) ||
          file.name.toLowerCase().endsWith(".zip")),
    );
  }

  function isUserFlowImportFile(file) {
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

  function createArchiveImportSessionId(candidate, reservedIds) {
    const requestedId =
      typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 160) : "";

    if (requestedId && !reservedIds.has(requestedId)) {
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

  function ensureArchiveImportTabs(folderNames) {
    const tabByName = new Map(
      userFlowTabs.tabs.map((tab) => [tab.name.toLowerCase(), tab]),
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

    if (userFlowTabs.tabs.length + missingFolderNames.length > MAX_USER_FLOW_TABS) {
      throw new Error(`가져온 폴더를 추가하면 탭 ${MAX_USER_FLOW_TABS}개를 초과합니다.`);
    }

    missingFolderNames.forEach((name, index) => {
      const tab = {
        id: `tab-import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        name,
      };

      userFlowTabs.tabs.push(tab);
      tabByName.set(name.toLowerCase(), tab);
    });

    return tabByName;
  }

  async function importUserFlowArchive(file) {
    if (!window.UserFlowArchive) {
      throw new Error("ZIP 모듈을 불러오지 못했습니다.");
    }

    const entries = await window.UserFlowArchive.readArchive(file);
    const archiveEntries = entries.filter((entry) => getArchiveFolderName(entry.name));
    const folderNames = archiveEntries
      .map((entry) => getArchiveFolderName(entry.name))
      .filter(Boolean);

    if (!folderNames.length) {
      throw new Error("탭 폴더가 들어 있는 ZIP 파일이 아닙니다.");
    }

    const reservedIds = new Set(
      (currentUserFlowState.sessions || []).map((session) => session.id),
    );
    const importedSessions = [];
    const importedSessionFolders = new Map();

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
          if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.events)) {
            return;
          }

          if (importedSessions.length >= MAX_USER_FLOW_IMPORT_SESSIONS) {
            throw new Error(
              `한 번에 녹음 ${MAX_USER_FLOW_IMPORT_SESSIONS}개까지 가져올 수 있습니다.`,
            );
          }

          const sessionId = createArchiveImportSessionId(candidate, reservedIds);
          importedSessions.push({ ...candidate, id: sessionId });
          importedSessionFolders.set(sessionId, folderName);
        });
      });

    const previousTabs = JSON.parse(JSON.stringify(userFlowTabs));

    try {
      const tabByName = ensureArchiveImportTabs(folderNames);

      importedSessions.forEach((session) => {
        const folderName = importedSessionFolders.get(session.id);
        const tab = tabByName.get(folderName.toLowerCase());

        if (tab) {
          userFlowTabs.sessionTabs[session.id] = tab.id;
        }
      });

      const firstImportedTab = tabByName.get(folderNames[0].toLowerCase());

      if (firstImportedTab) {
        userFlowTabs.activeTabId = firstImportedTab.id;
      }

      if (!persistUserFlowTabs()) {
        throw new Error("가져온 탭 구성을 저장하지 못했습니다.");
      }

      if (!importedSessions.length) {
        rerenderUserFlowOrganization();
        showUserFlowImportStatus("빈 탭 폴더를 가져왔습니다.", "ready");
        return;
      }

      const importedTabCount = new Set(
        folderNames.map((name) => name.toLowerCase()),
      ).size;
      showUserFlowImportStatus(
        `탭 ${importedTabCount}개 · 녹음 ${importedSessions.length}개 가져오는 중`,
        "ready",
      );

      if (
        !sendUserFlowCommand("import-recordings", {
          importData: { sessions: importedSessions },
        })
      ) {
        throw new Error("부모 화면에 연결할 수 없습니다.");
      }
    } catch (error) {
      userFlowTabs = previousTabs;
      persistUserFlowTabs();
      throw error;
    }
  }

  async function importUserFlowFile(file) {
    if (isUserFlowImportBlocked()) {
      showUserFlowImportStatus("녹음 또는 재생 중에는 가져올 수 없습니다.");
      return;
    }

    if (!isUserFlowImportFile(file)) {
      showUserFlowImportStatus("JSON 또는 ZIP 파일만 가져올 수 있습니다.");
      return;
    }

    const maxImportBytes = isZipFile(file)
      ? MAX_USER_FLOW_ARCHIVE_IMPORT_BYTES
      : MAX_USER_FLOW_IMPORT_BYTES;

    if (file.size > maxImportBytes) {
      showUserFlowImportStatus(
        isZipFile(file)
          ? "50MB 이하의 ZIP 파일만 가져올 수 있습니다."
          : "10MB 이하의 JSON 파일만 가져올 수 있습니다.",
      );
      return;
    }

    try {
      if (isZipFile(file)) {
        showUserFlowImportStatus("ZIP 파일 확인 중", "ready");
        await importUserFlowArchive(file);
        return;
      }

      const importData = JSON.parse(await file.text());
      showUserFlowImportStatus("가져오는 중", "ready");
      sendUserFlowCommand("import-recordings", { importData });
    } catch (error) {
      showUserFlowImportStatus(
        error?.message || "가져오기 파일을 읽지 못했습니다.",
      );
    }
  }

  function handleUserFlowImportTrigger(event) {
    const button = event.target.closest("[data-user-flow-import-trigger]");

    if (!button || button.disabled) {
      return;
    }

    document.querySelector("#userFlowImportInput")?.click();
  }

  function handleUserFlowImportChange(event) {
    const input = event.target.closest("#userFlowImportInput");

    if (!input) {
      return;
    }

    const [file] = Array.from(input.files || []);
    input.value = "";

    if (file) {
      importUserFlowFile(file);
    }
  }

  function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function resetUserFlowFileDrag() {
    userFlowDragDepth = 0;
    document.body.classList.remove("is-user-flow-file-dragging");
  }

  function handleUserFlowDragEnter(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    userFlowDragDepth += 1;
    document.body.classList.add("is-user-flow-file-dragging");
  }

  function handleUserFlowDragOver(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleUserFlowDragLeave(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    userFlowDragDepth = Math.max(0, userFlowDragDepth - 1);

    if (!userFlowDragDepth) {
      document.body.classList.remove("is-user-flow-file-dragging");
    }
  }

  function handleUserFlowDrop(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    const importFile = files.find(isUserFlowImportFile);
    resetUserFlowFileDrag();

    if (!importFile) {
      showUserFlowImportStatus("JSON 또는 ZIP 파일만 가져올 수 있습니다.");
      return;
    }

    importUserFlowFile(importFile);
  }

  function handleUserFlowNameControl(event) {
    const editButton = event.target.closest("[data-user-flow-name-edit]");
    const cancelButton = event.target.closest("[data-user-flow-name-cancel]");

    if (editButton && !editButton.disabled) {
      editingUserFlowSessionId = editButton.dataset.sessionId || "";
      renderUserFlowState(currentUserFlowState);
      window.requestAnimationFrame(() => {
        const input = document.querySelector("[data-user-flow-name-input]");
        input?.focus();
        input?.select();
      });
      return;
    }

    if (cancelButton) {
      editingUserFlowSessionId = "";
      renderUserFlowState(currentUserFlowState);
    }
  }

  function handleUserFlowNameSubmit(event) {
    const form = event.target.closest("[data-user-flow-name-form]");

    if (!form) {
      return;
    }

    event.preventDefault();
    const session = form.closest("[data-user-flow-session-id]");
    const input = form.querySelector("[data-user-flow-name-input]");
    const sessionName = input?.value.trim() || "";

    if (!session || !input || !sessionName) {
      input?.focus();
      return;
    }

    form.querySelectorAll("button, input").forEach((control) => {
      control.disabled = true;
    });
    editingUserFlowSessionId = "";
    sendUserFlowCommand("rename-session", {
      sessionId: session.dataset.userFlowSessionId || "",
      sessionName,
    });
  }

  function handleUserFlowNameKeydown(event) {
    if (event.key !== "Escape" || !event.target.closest("[data-user-flow-name-form]")) {
      return;
    }

    event.preventDefault();
    editingUserFlowSessionId = "";
    renderUserFlowState(currentUserFlowState);
  }

  function isAllowedParentMessage(event) {
    if (!window.opener || event.source !== window.opener) {
      return false;
    }

    if (window.location.origin === "null") {
      return event.origin === "null";
    }

    return event.origin === window.location.origin;
  }

  function handleUserFlowStateMessage(event) {
    if (
      event.data?.type === MESSAGE_USER_FLOW_STATE &&
      isAllowedParentMessage(event)
    ) {
      renderUserFlowState(event.data.state || {});
    }
  }

  function handlePopupTabChange(event) {
    if (event.detail?.tabName === "user-flow") {
      sendUserFlowCommand("get-state");
    }
  }

  document.addEventListener("click", handleUserFlowControl);
  document.addEventListener("click", handleUserFlowTabControl);
  document.addEventListener("click", handleUserFlowImportTrigger);
  document.addEventListener("click", handleUserFlowNameControl);
  document.addEventListener("change", handleUserFlowImportChange);
  document.addEventListener("focusout", handleUserFlowTabNameFocusOut);
  document.addEventListener("keydown", handleUserFlowTabNameKeydown);
  document.addEventListener("keydown", handleUserFlowNameKeydown);
  document.addEventListener("submit", handleUserFlowNameSubmit);
  document.addEventListener("dragstart", handleUserFlowSessionDragStart);
  document.addEventListener("dragenter", handleUserFlowDragEnter);
  document.addEventListener("dragover", handleUserFlowTabDragOver);
  document.addEventListener("dragover", handleUserFlowDragOver);
  document.addEventListener("dragleave", handleUserFlowDragLeave);
  document.addEventListener("dragend", resetUserFlowSessionDrag);
  document.addEventListener("dragend", resetUserFlowFileDrag);
  document.addEventListener("drop", handleUserFlowSessionDrop);
  document.addEventListener("drop", handleUserFlowDrop);
  document.addEventListener(POPUP_TAB_CHANGE_EVENT, handlePopupTabChange);
  document.addEventListener(PARENT_READY_EVENT, () => sendUserFlowCommand("get-state"));
  window.addEventListener("message", handleUserFlowStateMessage);
  window.addEventListener("storage", handleUserFlowTabStorage);
  window.addEventListener("blur", resetUserFlowFileDrag);

  renderUserFlowTabs([]);
  sendUserFlowCommand("get-state");

  window.UserFlowPopup = Object.freeze({
    importFile: importUserFlowFile,
    renderState: renderUserFlowState,
    requestState: () => sendUserFlowCommand("get-state"),
  });
})();
