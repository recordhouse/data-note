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
  const MAX_USER_FLOW_SESSIONS = 150;
  const MAX_USER_FLOW_IMPORT_SESSIONS = MAX_USER_FLOW_SESSIONS;
  const USER_FLOW_TAB_STORAGE_KEY = "response-mapping-user-flow-tabs:v1";
  const DEFAULT_USER_FLOW_TAB_ID = "default";
  const USER_FLOW_VIEW_RECORDINGS = "recordings";
  const USER_FLOW_VIEW_TEST = "test";
  const MAX_USER_FLOW_TABS = 10;
  const MAX_USER_FLOW_SESSIONS_PER_TAB = 20;
  const REPLAY_NAVIGATION_IDLE_MS = 500;
  const REPLAY_NAVIGATION_TIMEOUT_MS = 60 * 1000;
  const USER_FLOW_DRAG_SCROLL_EDGE_PX = 48;
  const USER_FLOW_DRAG_SCROLL_STEP_PX = 18;

  let currentUserFlowState = {};
  let activeUserFlowView = USER_FLOW_VIEW_RECORDINGS;
  let editingUserFlowSessionId = "";
  let editingUserFlowTabId = "";
  let renderedUserFlowSessionSignature = "";
  let renderedUserFlowTestSignature = "";
  let userFlowDragDepth = 0;
  let draggedUserFlowSessionId = "";
  let replayNavigationIdleTimer = 0;
  let replayNavigationParentReady = false;
  let replayNavigationSessionId = "";
  let replayNavigationTimer = 0;
  let isUserFlowUrlImporting = false;
  let renderedUserFlowImportUrls = [];
  let userFlowTabs = readUserFlowTabs();

  function createDefaultUserFlowTabs() {
    return {
      activeTabId: DEFAULT_USER_FLOW_TAB_ID,
      sessionOrder: [],
      sessionTabs: {},
      testSessionIds: [],
      tabs: [{ id: DEFAULT_USER_FLOW_TAB_ID, name: "Tab 01" }],
      version: 6,
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
      const tabIds = new Set();
      const tabs = [];

      stored.tabs.slice(0, MAX_USER_FLOW_TABS).forEach((tab) => {
        const id = typeof tab?.id === "string" ? tab.id.trim().slice(0, 120) : "";
        const storedName =
          typeof tab?.name === "string" ? tab.name.trim().slice(0, 30) : "";
        const name = isLegacyTabs
          ? normalizeLegacyUserFlowTabName(storedName, "")
          : storedName;

        if (!id || !name || tabIds.has(id)) {
          return;
        }

        tabIds.add(id);
        tabs.push({ id, name });
      });

      if (!tabs.length) {
        return fallback;
      }

      const sessionTabs = {};
      const sessionOrder = [];
      const orderedSessionIds = new Set();
      const testSessionIds = [];
      const testSessionIdSet = new Set();

      if (stored.sessionTabs && typeof stored.sessionTabs === "object") {
        Object.entries(stored.sessionTabs).forEach(([sessionId, tabId]) => {
          if (sessionId && tabIds.has(tabId)) {
            sessionTabs[String(sessionId).slice(0, 200)] = tabId;
          }
        });
      }

      if (Array.isArray(stored.sessionOrder)) {
        stored.sessionOrder.forEach((sessionId) => {
          const normalizedId = String(sessionId || "").trim().slice(0, 200);

          if (normalizedId && !orderedSessionIds.has(normalizedId)) {
            orderedSessionIds.add(normalizedId);
            sessionOrder.push(normalizedId);
          }
        });
      }

      if (Array.isArray(stored.testSessionIds)) {
        stored.testSessionIds.slice(0, MAX_USER_FLOW_SESSIONS).forEach((sessionId) => {
          const normalizedId = String(sessionId || "").trim().slice(0, 200);

          if (normalizedId && !testSessionIdSet.has(normalizedId)) {
            testSessionIdSet.add(normalizedId);
            testSessionIds.push(normalizedId);
          }
        });
      }

      return {
        activeTabId: tabIds.has(stored.activeTabId)
          ? stored.activeTabId
          : tabs[0].id,
        sessionOrder,
        sessionTabs,
        testSessionIds,
        tabs,
        version: 6,
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

  function getFirstUserFlowTab() {
    return userFlowTabs.tabs[0] || {
      id: DEFAULT_USER_FLOW_TAB_ID,
      name: "Tab 01",
    };
  }

  function getUserFlowSessionTabId(sessionId) {
    const assignedTabId = userFlowTabs.sessionTabs[sessionId];
    return userFlowTabs.tabs.some((tab) => tab.id === assignedTabId)
      ? assignedTabId
      : getFirstUserFlowTab().id;
  }

  function reconcileUserFlowTabs(sessions, { removeMissingSessions = false } = {}) {
    const sessionIds = new Set(sessions.map((session) => session.id));
    const tabIds = new Set(userFlowTabs.tabs.map((tab) => tab.id));
    const fallbackTabId = tabIds.has(userFlowTabs.activeTabId)
      ? userFlowTabs.activeTabId
      : getFirstUserFlowTab().id;
    const tabSessionCounts = new Map(userFlowTabs.tabs.map((tab) => [tab.id, 0]));
    let changed = false;

    if (userFlowTabs.activeTabId !== fallbackTabId) {
      userFlowTabs.activeTabId = fallbackTabId;
      changed = true;
    }

    if (removeMissingSessions) {
      Object.keys(userFlowTabs.sessionTabs).forEach((sessionId) => {
        if (!sessionIds.has(sessionId)) {
          delete userFlowTabs.sessionTabs[sessionId];
          changed = true;
        }
      });

      const nextSessionOrder = userFlowTabs.sessionOrder.filter((sessionId) =>
        sessionIds.has(sessionId),
      );

      if (nextSessionOrder.length !== userFlowTabs.sessionOrder.length) {
        userFlowTabs.sessionOrder = nextSessionOrder;
        changed = true;
      }

      const nextTestSessionIds = userFlowTabs.testSessionIds.filter((sessionId) =>
        sessionIds.has(sessionId),
      );

      if (nextTestSessionIds.length !== userFlowTabs.testSessionIds.length) {
        userFlowTabs.testSessionIds = nextTestSessionIds;
        changed = true;
      }
    }

    sessions.forEach((session) => {
      const assignedTabId = userFlowTabs.sessionTabs[session.id];

      if (tabIds.has(assignedTabId)) {
        tabSessionCounts.set(
          assignedTabId,
          Number(tabSessionCounts.get(assignedTabId) || 0) + 1,
        );
      }
    });

    sessions.forEach((session) => {
      if (!tabIds.has(userFlowTabs.sessionTabs[session.id])) {
        const availableTab = userFlowTabs.tabs.find(
          (tab) =>
            Number(tabSessionCounts.get(tab.id) || 0) <
            MAX_USER_FLOW_SESSIONS_PER_TAB,
        );
        const targetTabId =
          Number(tabSessionCounts.get(fallbackTabId) || 0) <
          MAX_USER_FLOW_SESSIONS_PER_TAB
            ? fallbackTabId
            : availableTab?.id || fallbackTabId;
        userFlowTabs.sessionTabs[session.id] = targetTabId;
        tabSessionCounts.set(
          targetTabId,
          Number(tabSessionCounts.get(targetTabId) || 0) + 1,
        );
        changed = true;
      }

      if (!userFlowTabs.sessionOrder.includes(session.id)) {
        userFlowTabs.sessionOrder.push(session.id);
        changed = true;
      }
    });

    if (changed) {
      persistUserFlowTabs();
    }
  }

  function getOrderedUserFlowSessions(sessions) {
    const orderBySessionId = new Map(
      userFlowTabs.sessionOrder.map((sessionId, index) => [sessionId, index]),
    );

    return [...sessions].sort((first, second) => {
      const firstOrder = orderBySessionId.get(first.id);
      const secondOrder = orderBySessionId.get(second.id);

      if (firstOrder === undefined && secondOrder === undefined) {
        return 0;
      }

      if (firstOrder === undefined) {
        return 1;
      }

      if (secondOrder === undefined) {
        return -1;
      }

      return firstOrder - secondOrder;
    });
  }

  function getUserFlowTabCounts(sessions) {
    const counts = new Map(userFlowTabs.tabs.map((tab) => [tab.id, 0]));

    sessions.forEach((session) => {
      const tabId = getUserFlowSessionTabId(session.id);
      counts.set(tabId, (counts.get(tabId) || 0) + 1);
    });

    return counts;
  }

  function getUserFlowTabSessionCount(
    tabId,
    sessions = currentUserFlowState.sessions || [],
  ) {
    return Number(getUserFlowTabCounts(sessions).get(tabId) || 0);
  }

  function showUserFlowTabLimit(tabId) {
    const tabName =
      userFlowTabs.tabs.find((tab) => tab.id === tabId)?.name || "선택한";
    showUserFlowImportStatus(
      `${tabName} 탭에는 녹화를 최대 ${MAX_USER_FLOW_SESSIONS_PER_TAB}개까지 추가할 수 있습니다.`,
    );
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
        const canDelete = userFlowTabs.tabs.length > 1;

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

  function formatUserFlowRecordedAt(recordedAt) {
    return recordedAt
      ? new Date(recordedAt).toLocaleString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "녹화 일시 없음";
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
      replayNavigationSessionId,
      replaySessionId: flowState.replaySessionId || "",
      sessionOrder: userFlowTabs.sessionOrder,
      sessionTabs: sessions.map((session) => [
        session.id,
        getUserFlowSessionTabId(session.id),
      ]),
      tabs: userFlowTabs.tabs,
      testSessionIds: userFlowTabs.testSessionIds,
      sessions: sessions.map((session) => ({
        durationMs: session.durationMs,
        eventCount: session.eventCount,
        id: session.id,
        name: session.name || "",
        recordedAt: session.recordedAt,
        startPage: session.startPage || "",
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

  function renderUserFlowView() {
    const isTestView = activeUserFlowView === USER_FLOW_VIEW_TEST;
    const recordingsTab = document.querySelector("#userFlowRecordingsViewTab");
    const testTab = document.querySelector("#userFlowTestViewTab");
    const recordingsView = document.querySelector("#userFlowRecordingsView");
    const testView = document.querySelector("#userFlowTestView");

    if (!recordingsTab || !testTab || !recordingsView || !testView) {
      return;
    }

    recordingsTab.setAttribute("aria-selected", String(!isTestView));
    recordingsTab.tabIndex = isTestView ? -1 : 0;
    testTab.setAttribute("aria-selected", String(isTestView));
    testTab.tabIndex = isTestView ? 0 : -1;
    recordingsView.hidden = isTestView;
    testView.hidden = !isTestView;
  }

  function renderUserFlowTestSessions(flowState, sessions, sessionSignature) {
    const sessionList = document.querySelector("#userFlowTestSessionList");
    const sessionCount = document.querySelector("#userFlowTestSessionCount");
    const viewCount = document.querySelector("#userFlowTestViewCount");
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const testSessions = userFlowTabs.testSessionIds
      .map((sessionId) => sessionById.get(sessionId))
      .filter(Boolean);

    if (!sessionList) {
      return;
    }

    const countText = testSessions.length.toLocaleString("ko-KR");

    if (sessionCount) {
      sessionCount.textContent = `${countText}개`;
    }

    if (viewCount) {
      viewCount.textContent = countText;
    }

    if (renderedUserFlowTestSignature === sessionSignature) {
      return;
    }

    renderedUserFlowTestSignature = sessionSignature;

    if (!testSessions.length) {
      sessionList.innerHTML =
        '<div class="user-flow-empty">녹화 목록을 이 탭으로 끌어다 놓아주세요.</div>';
      return;
    }

    sessionList.innerHTML = testSessions
      .map((session) => {
        const isRecordingSession = flowState.activeRecordingSessionId === session.id;
        const isReplayingSession = flowState.replaySessionId === session.id;
        const isNavigatingSession = replayNavigationSessionId === session.id;
        const recordedAt = formatUserFlowRecordedAt(session.recordedAt);
        const sessionName = String(session.name || "").trim();
        const disabled =
          flowState.isRecording ||
          (!session.eventCount && !isReplayingSession) ||
          (flowState.isReplaying && !isReplayingSession);
        const replayDisabled = disabled || Boolean(replayNavigationSessionId);
        const changeDisabled = flowState.isRecording || flowState.isReplaying;
        const sessionMeta = getUserFlowSessionMeta(session, flowState, isReplayingSession);

        return `
          <article
            class="user-flow-session"
            draggable="false"
            data-state="${isRecordingSession ? "recording" : isReplayingSession ? "replaying" : "idle"}"
            data-user-flow-session-id="${escapeHtml(session.id)}"
          >
            <div class="user-flow-session-main">
              <strong class="user-flow-session-time">
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
                aria-busy="${String(isNavigatingSession)}"
                data-navigating="${String(isNavigatingSession)}"
                ${replayDisabled ? "disabled" : ""}
              >${isNavigatingSession ? "이동 중" : isReplayingSession ? "재생 중지" : "재생"}</button>
              <button
                class="user-flow-test-remove"
                type="button"
                data-user-flow-test-remove="${escapeHtml(session.id)}"
                aria-label="${escapeHtml(sessionName || recordedAt)} 녹화 테스트 목록에서 제거"
                ${changeDisabled ? "disabled" : ""}
              >목록 제거</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderUserFlowState(flowState = {}) {
    currentUserFlowState = flowState;
    updateReplayNavigationState(flowState);
    const status = document.querySelector("#userFlowStatus");
    const recordButton = document.querySelector("#userFlowRecordButton");
    const exportAllButton = document.querySelector("#userFlowExportAllButton");
    const tabAddButton = document.querySelector("#userFlowTabAddButton");
    const sessionCount = document.querySelector("#userFlowSessionCount");
    const sessionList = document.querySelector("#userFlowSessionList");

    if (!status || !recordButton || !sessionList) {
      return;
    }

    let statusText = "기록 없음";
    let statusState = "idle";

    if (replayNavigationSessionId) {
      statusText = "페이지 이동 중";
      statusState = "navigating";
    } else if (flowState.isRecording) {
      statusText = "녹화 중";
      statusState = "recording";
    } else if (flowState.isReplaying) {
      statusText = flowState.isWaitingForRequests
        ? "통신 완료 대기 중"
        : "재생 중";
      statusState = "replaying";
    } else if (flowState.error) {
      statusText = flowState.error;
      statusState = "error";
    } else if (flowState.canReplay) {
      statusText = "재생 준비";
      statusState = "ready";
    }

    status.textContent = statusText;
    status.dataset.state = statusState;

    recordButton.textContent = flowState.isRecording ? "녹화 중지" : "녹화";
    recordButton.setAttribute("aria-pressed", String(Boolean(flowState.isRecording)));
    recordButton.disabled = Boolean(flowState.isReplaying);

    updateUserFlowImportControls();

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
    renderUserFlowView();
    const visibleSessions = getOrderedUserFlowSessions(sessions).filter(
      (session) =>
        getUserFlowSessionTabId(session.id) === userFlowTabs.activeTabId,
    );
    sessionList.setAttribute(
      "aria-labelledby",
      getUserFlowTabElementId(userFlowTabs.activeTabId),
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

    const sessionSignature = getUserFlowSessionSignature(flowState, sessions);
    renderUserFlowTestSessions(flowState, sessions, sessionSignature);

    if (!visibleSessions.length) {
      renderedUserFlowSessionSignature = "";
      sessionList.innerHTML = `<div class="user-flow-empty">${
        sessions.length ? "이 탭에 저장된 녹화가 없습니다." : "저장된 녹화가 없습니다."
      }</div>`;
      updateUserFlowSessionProgress(flowState, sessions);
      return;
    }

    if (renderedUserFlowSessionSignature === sessionSignature) {
      updateUserFlowSessionProgress(flowState, sessions);
      return;
    }

    renderedUserFlowSessionSignature = sessionSignature;

    sessionList.innerHTML = visibleSessions
      .map((session) => {
        const isRecordingSession = flowState.activeRecordingSessionId === session.id;
        const isReplayingSession = flowState.replaySessionId === session.id;
        const recordedAt = formatUserFlowRecordedAt(session.recordedAt);
        const sessionName = String(session.name || "").trim();
        const isEditing = editingUserFlowSessionId === session.id;
        const isNavigatingSession = replayNavigationSessionId === session.id;
        const disabled =
          flowState.isRecording ||
          (!session.eventCount && !isReplayingSession) ||
          (flowState.isReplaying && !isReplayingSession);
        const replayDisabled = disabled || Boolean(replayNavigationSessionId);
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
                  <input
                    class="user-flow-name-input"
                    type="text"
                    value="${escapeHtml(sessionName)}"
                    maxlength="40"
                    placeholder="녹화 이름"
                    aria-label="녹화 이름"
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
                aria-busy="${String(isNavigatingSession)}"
                data-navigating="${String(isNavigatingSession)}"
                ${replayDisabled ? "disabled" : ""}
              >${isNavigatingSession ? "이동 중" : isReplayingSession ? "재생 중지" : "재생"}</button>
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
                aria-label="${escapeHtml(sessionName || recordedAt)} 녹화 내보내기"
                ${changeDisabled ? "disabled" : ""}
              >내보내기</button>
              <button
                class="user-flow-delete"
                type="button"
                data-user-flow-command="delete-session"
                data-session-id="${escapeHtml(session.id)}"
                aria-label="${escapeHtml(recordedAt)} 녹화 삭제"
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

  function getParentCurrentPage() {
    try {
      if (!window.opener || window.opener.closed) {
        return "";
      }

      return `${window.opener.location.pathname}${window.opener.location.search}${window.opener.location.hash}`;
    } catch (error) {
      return "";
    }
  }

  function willReplayNavigate(sessionId) {
    const session = (currentUserFlowState.sessions || []).find(
      (item) => item.id === sessionId,
    );
    const currentPage = getParentCurrentPage();
    return Boolean(
      session?.startPage && currentPage && session.startPage !== currentPage,
    );
  }

  function clearReplayNavigationState({ rerender = true } = {}) {
    window.clearTimeout(replayNavigationIdleTimer);
    window.clearTimeout(replayNavigationTimer);
    replayNavigationIdleTimer = 0;
    replayNavigationTimer = 0;
    replayNavigationParentReady = false;

    if (!replayNavigationSessionId) {
      return;
    }

    replayNavigationSessionId = "";

    if (rerender) {
      rerenderUserFlowOrganization();
    }
  }

  function startReplayNavigationState(sessionId) {
    window.clearTimeout(replayNavigationIdleTimer);
    window.clearTimeout(replayNavigationTimer);
    replayNavigationIdleTimer = 0;
    replayNavigationParentReady = false;
    replayNavigationSessionId = sessionId;
    replayNavigationTimer = window.setTimeout(() => {
      clearReplayNavigationState();
      sendUserFlowCommand("get-state");
    }, REPLAY_NAVIGATION_TIMEOUT_MS);
    rerenderUserFlowOrganization();
  }

  function updateReplayNavigationState(flowState) {
    if (!replayNavigationSessionId || !replayNavigationParentReady) {
      return;
    }

    window.clearTimeout(replayNavigationIdleTimer);
    replayNavigationIdleTimer = 0;
    const pendingRequestCount = Math.max(
      0,
      Number(flowState.pendingRequestCount || 0),
    );

    if (pendingRequestCount > 0 || flowState.isWaitingForRequests) {
      return;
    }

    const expectedSessionId = replayNavigationSessionId;
    replayNavigationIdleTimer = window.setTimeout(() => {
      if (
        replayNavigationSessionId === expectedSessionId &&
        replayNavigationParentReady
      ) {
        clearReplayNavigationState();
      }
    }, REPLAY_NAVIGATION_IDLE_MS);
  }

  function handleUserFlowControl(event) {
    const button = event.target.closest("[data-user-flow-command]");

    if (!button || button.disabled) {
      return;
    }

    const command = button.dataset.userFlowCommand;

    if (
      command === "toggle-record" &&
      !currentUserFlowState.isRecording &&
      getUserFlowTabSessionCount(userFlowTabs.activeTabId) >=
        MAX_USER_FLOW_SESSIONS_PER_TAB
    ) {
      showUserFlowTabLimit(userFlowTabs.activeTabId);
      return;
    }

    const payload = {
      sessionId: button.dataset.sessionId || "",
    };
    const startsPageNavigation =
      command === "toggle-replay-session" &&
      !currentUserFlowState.isReplaying &&
      willReplayNavigate(payload.sessionId);

    if (command === "export-all-recordings") {
      payload.tabOrganization = {
        sessionTabs: { ...userFlowTabs.sessionTabs },
        tabs: userFlowTabs.tabs.map((tab) => ({ ...tab })),
      };
    }

    if (startsPageNavigation) {
      startReplayNavigationState(payload.sessionId);
    }

    if (!sendUserFlowCommand(command, payload) && startsPageNavigation) {
      clearReplayNavigationState();
    }
  }

  function isUserFlowOrganizationBlocked() {
    return Boolean(currentUserFlowState.isRecording || currentUserFlowState.isReplaying);
  }

  function rerenderUserFlowOrganization() {
    editingUserFlowSessionId = "";
    renderedUserFlowSessionSignature = "";
    renderedUserFlowTestSignature = "";
    renderUserFlowState(currentUserFlowState);
  }

  function handleUserFlowViewControl(event) {
    const button = event.target.closest("[data-user-flow-view-select]");

    if (!button) {
      return;
    }

    const view = button.dataset.userFlowViewSelect;

    if (![USER_FLOW_VIEW_RECORDINGS, USER_FLOW_VIEW_TEST].includes(view)) {
      return;
    }

    activeUserFlowView = view;
    renderUserFlowView();
  }

  function handleUserFlowTestSessionRemove(event) {
    const button = event.target.closest("[data-user-flow-test-remove]");

    if (!button || button.disabled || isUserFlowOrganizationBlocked()) {
      return;
    }

    const sessionId = button.dataset.userFlowTestRemove || "";
    const previousTestSessionIds = [...userFlowTabs.testSessionIds];
    userFlowTabs.testSessionIds = userFlowTabs.testSessionIds.filter(
      (item) => item !== sessionId,
    );

    if (!persistUserFlowTabs()) {
      userFlowTabs.testSessionIds = previousTestSessionIds;
    }

    rerenderUserFlowOrganization();
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
      const sessionCount = getUserFlowTabSessionCount(tabId);
      const fallbackTab =
        userFlowTabs.tabs.find(
          (item) =>
            item.id !== tabId &&
            getUserFlowTabSessionCount(item.id) + sessionCount <=
              MAX_USER_FLOW_SESSIONS_PER_TAB,
        ) || userFlowTabs.tabs.find((item) => item.id !== tabId);

      if (!tab || !fallbackTab) {
        return;
      }

      const fallbackSessionCount = getUserFlowTabSessionCount(fallbackTab.id);

      if (
        sessionCount &&
        fallbackSessionCount + sessionCount > MAX_USER_FLOW_SESSIONS_PER_TAB
      ) {
        showUserFlowTabLimit(fallbackTab.id);
        return;
      }

      if (
        sessionCount &&
        !window.confirm(
          `${tab.name} 탭을 삭제하면 녹화가 ${fallbackTab.name} 탭으로 이동합니다.`,
        )
      ) {
        return;
      }

      Object.keys(userFlowTabs.sessionTabs).forEach((sessionId) => {
        if (userFlowTabs.sessionTabs[sessionId] === tabId) {
          userFlowTabs.sessionTabs[sessionId] = fallbackTab.id;
        }
      });
      userFlowTabs.tabs = userFlowTabs.tabs.filter((item) => item.id !== tabId);

      if (userFlowTabs.activeTabId === tabId) {
        userFlowTabs.activeTabId = fallbackTab.id;
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
    document
      .querySelectorAll(
        ".user-flow-session.is-dragging, .user-flow-session.is-drop-before, .user-flow-session.is-drop-after",
      )
      .forEach((session) => {
        session.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
      });
    document.querySelectorAll(".user-flow-list-tab-wrap.is-drop-target").forEach((tab) => {
      tab.classList.remove("is-drop-target");
    });
    document.querySelectorAll(".user-flow-view-tab.is-drop-target").forEach((tab) => {
      tab.classList.remove("is-drop-target");
    });
  }

  function clearUserFlowSessionDropIndicators(exceptSession = null) {
    document
      .querySelectorAll(".user-flow-session.is-drop-before, .user-flow-session.is-drop-after")
      .forEach((session) => {
        if (session !== exceptSession) {
          session.classList.remove("is-drop-before", "is-drop-after");
        }
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

    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", draggedUserFlowSessionId);

    if (typeof event.dataTransfer.setDragImage === "function") {
      event.dataTransfer.setDragImage(session, 18, 18);
    }

    session.classList.add("is-dragging");
  }

  function handleUserFlowTabDragOver(event) {
    const tab = event.target.closest("[data-user-flow-tab-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearUserFlowSessionDropIndicators();
    document.querySelectorAll(".user-flow-list-tab-wrap.is-drop-target").forEach((item) => {
      item.classList.toggle("is-drop-target", item === tab);
    });
    document.querySelectorAll(".user-flow-view-tab.is-drop-target").forEach((item) => {
      item.classList.remove("is-drop-target");
    });
  }

  function handleUserFlowTestDragOver(event) {
    const tab = event.target.closest("[data-user-flow-test-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    clearUserFlowSessionDropIndicators();
    document.querySelectorAll(".user-flow-list-tab-wrap.is-drop-target").forEach((item) => {
      item.classList.remove("is-drop-target");
    });
    tab.classList.add("is-drop-target");
  }

  function getUserFlowSessionOrderDropPosition(event) {
    const sessionList = document.querySelector("#userFlowSessionList");

    if (
      !sessionList ||
      event.target.closest("[data-user-flow-tab-drop], [data-user-flow-test-drop]")
    ) {
      return null;
    }

    const listRect = sessionList.getBoundingClientRect();
    const isInsideList = sessionList.contains(event.target);
    const isWithinListWidth =
      event.clientX >= listRect.left && event.clientX <= listRect.right;

    if (
      !isInsideList &&
      (!isWithinListWidth ||
        (event.clientY > listRect.top && event.clientY < listRect.bottom))
    ) {
      return null;
    }

    const sessions = Array.from(
      sessionList.querySelectorAll("[data-user-flow-session-id]"),
    ).filter(
      (session) =>
        session.dataset.userFlowSessionId !== draggedUserFlowSessionId,
    );

    if (!sessions.length) {
      return null;
    }

    const targetSession =
      sessions.find((session) => {
        const rect = session.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      }) || sessions[sessions.length - 1];
    const targetRect = targetSession.getBoundingClientRect();

    return {
      dropBefore: event.clientY < targetRect.top + targetRect.height / 2,
      targetSession,
    };
  }

  function scrollUserFlowSessionListDuringDrag(event) {
    const sessionList = document.querySelector("#userFlowSessionList");

    if (!sessionList) {
      return;
    }

    const listRect = sessionList.getBoundingClientRect();
    const isWithinListWidth =
      event.clientX >= listRect.left && event.clientX <= listRect.right;

    if (!isWithinListWidth && !sessionList.contains(event.target)) {
      return;
    }

    if (event.clientY <= listRect.top + USER_FLOW_DRAG_SCROLL_EDGE_PX) {
      sessionList.scrollTop -= USER_FLOW_DRAG_SCROLL_STEP_PX;
    } else if (
      event.clientY >=
      listRect.bottom - USER_FLOW_DRAG_SCROLL_EDGE_PX
    ) {
      sessionList.scrollTop += USER_FLOW_DRAG_SCROLL_STEP_PX;
    }
  }

  function handleUserFlowSessionOrderDragOver(event) {
    const dropPosition = getUserFlowSessionOrderDropPosition(event);

    if (
      !dropPosition ||
      !draggedUserFlowSessionId ||
      isUserFlowOrganizationBlocked() ||
      hasDraggedFiles(event)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    scrollUserFlowSessionListDuringDrag(event);
    const { dropBefore, targetSession } = dropPosition;
    clearUserFlowSessionDropIndicators(targetSession);
    targetSession.classList.toggle("is-drop-before", dropBefore);
    targetSession.classList.toggle("is-drop-after", !dropBefore);
    document.querySelectorAll(".user-flow-list-tab-wrap.is-drop-target").forEach((tab) => {
      tab.classList.remove("is-drop-target");
    });
    document.querySelectorAll(".user-flow-view-tab.is-drop-target").forEach((tab) => {
      tab.classList.remove("is-drop-target");
    });
  }

  function handleUserFlowTestDrop(event) {
    const tab = event.target.closest("[data-user-flow-test-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    const sessionExists = (currentUserFlowState.sessions || []).some(
      (session) => session.id === draggedUserFlowSessionId,
    );

    if (
      sessionExists &&
      !userFlowTabs.testSessionIds.includes(draggedUserFlowSessionId)
    ) {
      const previousTestSessionIds = [...userFlowTabs.testSessionIds];
      userFlowTabs.testSessionIds.push(draggedUserFlowSessionId);

      if (!persistUserFlowTabs()) {
        userFlowTabs.testSessionIds = previousTestSessionIds;
      }
    }

    activeUserFlowView = USER_FLOW_VIEW_TEST;
    resetUserFlowSessionDrag();
    rerenderUserFlowOrganization();
  }

  function handleUserFlowSessionOrderDrop(event) {
    const dropPosition = getUserFlowSessionOrderDropPosition(event);
    const targetSession = dropPosition?.targetSession;
    const targetSessionId = targetSession?.dataset.userFlowSessionId || "";

    if (
      !dropPosition ||
      !draggedUserFlowSessionId ||
      isUserFlowOrganizationBlocked() ||
      hasDraggedFiles(event)
    ) {
      return;
    }

    event.preventDefault();
    const previousOrder = [...userFlowTabs.sessionOrder];
    const nextOrder = userFlowTabs.sessionOrder.filter(
      (sessionId) => sessionId !== draggedUserFlowSessionId,
    );
    const targetIndex = nextOrder.indexOf(targetSessionId);

    if (targetIndex < 0) {
      resetUserFlowSessionDrag();
      return;
    }

    const dropAfter = targetSession.classList.contains("is-drop-after")
      ? true
      : targetSession.classList.contains("is-drop-before")
        ? false
        : !dropPosition.dropBefore;
    nextOrder.splice(targetIndex + (dropAfter ? 1 : 0), 0, draggedUserFlowSessionId);
    userFlowTabs.sessionOrder = nextOrder;

    if (!persistUserFlowTabs()) {
      userFlowTabs.sessionOrder = previousOrder;
    }

    resetUserFlowSessionDrag();
    rerenderUserFlowOrganization();
  }

  function handleUserFlowSessionDrop(event) {
    const tab = event.target.closest("[data-user-flow-tab-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    const targetTabId = tab.dataset.userFlowTabDrop;

    if (userFlowTabs.tabs.some((item) => item.id === targetTabId)) {
      const sourceTabId = getUserFlowSessionTabId(draggedUserFlowSessionId);

      if (
        sourceTabId !== targetTabId &&
        getUserFlowTabSessionCount(targetTabId) >= MAX_USER_FLOW_SESSIONS_PER_TAB
      ) {
        showUserFlowTabLimit(targetTabId);
        resetUserFlowSessionDrag();
        return;
      }

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

  function updateUserFlowImportControls() {
    const importButton = document.querySelector("#userFlowImportButton");
    const urlImportButton = document.querySelector("#userFlowUrlImportButton");
    const urlImportSelect = document.querySelector("#userFlowUrlImportSelect");
    const importDisabled = Boolean(
      isUserFlowImportBlocked() || isUserFlowUrlImporting,
    );

    if (importButton) {
      importButton.disabled = importDisabled;
    }

    if (urlImportButton) {
      urlImportButton.disabled = importDisabled;
    }

    if (urlImportSelect) {
      urlImportSelect.disabled = importDisabled || !renderedUserFlowImportUrls.length;
    }

    if (importDisabled) {
      setUserFlowUrlImportOpen(false);
    }
  }

  function getUserFlowImportUrls() {
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

  function renderUserFlowUrlImportOptions() {
    const select = document.querySelector("#userFlowUrlImportSelect");

    if (!select) {
      return;
    }

    renderedUserFlowImportUrls = getUserFlowImportUrls();
    select.replaceChildren();

    if (!renderedUserFlowImportUrls.length) {
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

    renderedUserFlowImportUrls.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = item.name;
      select.appendChild(option);
    });

    select.size = Math.min(renderedUserFlowImportUrls.length + 1, 6);
    select.disabled = Boolean(isUserFlowUrlImporting || isUserFlowImportBlocked());
  }

  function setUserFlowUrlImportOpen(isOpen) {
    const button = document.querySelector("#userFlowUrlImportButton");
    const panel = document.querySelector("#userFlowUrlImportPanel");

    if (!button || !panel) {
      return;
    }

    const nextOpen = Boolean(isOpen && !button.disabled);
    panel.hidden = !nextOpen;
    button.setAttribute("aria-expanded", String(nextOpen));

    if (nextOpen) {
      renderUserFlowUrlImportOptions();
      window.setTimeout(() => {
        document.querySelector("#userFlowUrlImportSelect")?.focus();
      }, 0);
    }
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

  function getUserFlowImportFileMeta(response, importUrl, blob) {
    const contentType = String(blob.type || response.headers.get("content-type") || "")
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

  async function importUserFlowFromUrl(item) {
    if (isUserFlowImportBlocked() || isUserFlowUrlImporting) {
      showUserFlowImportStatus("녹화 또는 재생 중에는 가져올 수 없습니다.");
      return;
    }

    let importUrl;

    try {
      importUrl = new URL(item?.url || "", window.location.href);

      if (!["http:", "https:"].includes(importUrl.protocol)) {
        throw new Error("HTTP 또는 HTTPS URL만 사용할 수 있습니다.");
      }
    } catch (error) {
      showUserFlowImportStatus(error?.message || "등록된 URL이 올바르지 않습니다.");
      return;
    }

    isUserFlowUrlImporting = true;
    setUserFlowUrlImportOpen(false);
    updateUserFlowImportControls();
    showUserFlowImportStatus("URL에서 가져오는 중", "ready");

    try {
      const response = await fetch(importUrl.href, {
        cache: "no-store",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`파일 요청에 실패했습니다. (${response.status})`);
      }

      const blob = await response.blob();
      const { fileName, fileType } = getUserFlowImportFileMeta(
        response,
        importUrl,
        blob,
      );
      const file = new File([blob], fileName, {
        type: fileType,
      });
      await importUserFlowFile(file);
    } catch (error) {
      showUserFlowImportStatus(
        error?.message || "URL의 JSON 또는 ZIP 파일을 가져오지 못했습니다.",
      );
    } finally {
      isUserFlowUrlImporting = false;
      updateUserFlowImportControls();
    }
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
              `한 번에 녹화 ${MAX_USER_FLOW_IMPORT_SESSIONS}개까지 가져올 수 있습니다.`,
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
      const tabCounts = getUserFlowTabCounts(currentUserFlowState.sessions || []);

      if (
        (currentUserFlowState.sessions || []).length + importedSessions.length >
        MAX_USER_FLOW_SESSIONS
      ) {
        throw new Error(
          `전체 녹화는 최대 ${MAX_USER_FLOW_SESSIONS}개까지 저장할 수 있습니다.`,
        );
      }

      importedSessions.forEach((session) => {
        const folderName = importedSessionFolders.get(session.id);
        const tab = tabByName.get(folderName.toLowerCase());

        if (tab) {
          const tabSessionCount = Number(tabCounts.get(tab.id) || 0);

          if (tabSessionCount >= MAX_USER_FLOW_SESSIONS_PER_TAB) {
            throw new Error(
              `${tab.name} 탭에는 녹화를 최대 ${MAX_USER_FLOW_SESSIONS_PER_TAB}개까지 가져올 수 있습니다.`,
            );
          }

          userFlowTabs.sessionTabs[session.id] = tab.id;
          tabCounts.set(tab.id, tabSessionCount + 1);
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
        `탭 ${importedTabCount}개 · 녹화 ${importedSessions.length}개 가져오는 중`,
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
      showUserFlowImportStatus("녹화 또는 재생 중에는 가져올 수 없습니다.");
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
      const importSessionCount = getImportCandidates(importData).length;
      const activeTabSessionCount = getUserFlowTabSessionCount(
        userFlowTabs.activeTabId,
      );

      if (
        activeTabSessionCount + importSessionCount >
        MAX_USER_FLOW_SESSIONS_PER_TAB
      ) {
        showUserFlowTabLimit(userFlowTabs.activeTabId);
        return;
      }

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

  function handleUserFlowUrlImportTrigger(event) {
    const button = event.target.closest("[data-user-flow-url-import-trigger]");

    if (button) {
      if (button.disabled) {
        return;
      }

      const isOpen = button.getAttribute("aria-expanded") === "true";
      setUserFlowUrlImportOpen(!isOpen);
      return;
    }

    if (!event.target.closest("#userFlowUrlImportPanel")) {
      setUserFlowUrlImportOpen(false);
    }
  }

  function handleUserFlowUrlImportChange(event) {
    const select = event.target.closest("#userFlowUrlImportSelect");

    if (!select || select.disabled || select.selectedIndex < 0 || select.value === "") {
      return;
    }

    const item = renderedUserFlowImportUrls[Number(select.value)];

    if (item) {
      importUserFlowFromUrl(item);
    }
  }

  function handleUserFlowUrlImportKeydown(event) {
    const select = event.target.closest("#userFlowUrlImportSelect");

    if (
      event.key === "Enter" &&
      select &&
      select.selectedIndex >= 0 &&
      select.value !== ""
    ) {
      event.preventDefault();
      const item = renderedUserFlowImportUrls[Number(select.value)];

      if (item) {
        importUserFlowFromUrl(item);
      }
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    const panel = document.querySelector("#userFlowUrlImportPanel");

    if (!panel || panel.hidden) {
      return;
    }

    setUserFlowUrlImportOpen(false);
    document.querySelector("#userFlowUrlImportButton")?.focus();
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

  function handleParentReady() {
    if (replayNavigationSessionId) {
      window.clearTimeout(replayNavigationTimer);
      replayNavigationParentReady = true;
      window.clearTimeout(replayNavigationIdleTimer);
      replayNavigationIdleTimer = 0;
      replayNavigationTimer = 0;
    }

    sendUserFlowCommand("get-state");
  }

  document.addEventListener("click", handleUserFlowControl);
  document.addEventListener("click", handleUserFlowViewControl);
  document.addEventListener("click", handleUserFlowTestSessionRemove);
  document.addEventListener("click", handleUserFlowTabControl);
  document.addEventListener("click", handleUserFlowImportTrigger);
  document.addEventListener("click", handleUserFlowUrlImportTrigger);
  document.addEventListener("click", handleUserFlowNameControl);
  document.addEventListener("change", handleUserFlowImportChange);
  document.addEventListener("change", handleUserFlowUrlImportChange);
  document.addEventListener("focusout", handleUserFlowTabNameFocusOut);
  document.addEventListener("keydown", handleUserFlowTabNameKeydown);
  document.addEventListener("keydown", handleUserFlowNameKeydown);
  document.addEventListener("keydown", handleUserFlowUrlImportKeydown);
  document.addEventListener("submit", handleUserFlowNameSubmit);
  document.addEventListener("dragstart", handleUserFlowSessionDragStart);
  document.addEventListener("dragenter", handleUserFlowDragEnter);
  document.addEventListener("dragover", handleUserFlowTestDragOver);
  document.addEventListener("dragover", handleUserFlowTabDragOver);
  document.addEventListener("dragover", handleUserFlowSessionOrderDragOver);
  document.addEventListener("dragover", handleUserFlowDragOver);
  document.addEventListener("dragleave", handleUserFlowDragLeave);
  document.addEventListener("dragend", resetUserFlowSessionDrag);
  document.addEventListener("dragend", resetUserFlowFileDrag);
  document.addEventListener("drop", handleUserFlowTestDrop);
  document.addEventListener("drop", handleUserFlowSessionDrop);
  document.addEventListener("drop", handleUserFlowSessionOrderDrop);
  document.addEventListener("drop", handleUserFlowDrop);
  document.addEventListener(POPUP_TAB_CHANGE_EVENT, handlePopupTabChange);
  document.addEventListener(PARENT_READY_EVENT, handleParentReady);
  window.addEventListener("message", handleUserFlowStateMessage);
  window.addEventListener("storage", handleUserFlowTabStorage);
  window.addEventListener("blur", resetUserFlowFileDrag);

  renderUserFlowTabs([]);
  renderUserFlowUrlImportOptions();
  sendUserFlowCommand("get-state");

  window.UserFlowPopup = Object.freeze({
    importFile: importUserFlowFile,
    importUrl: importUserFlowFromUrl,
    renderState: renderUserFlowState,
    requestState: () => sendUserFlowCommand("get-state"),
  });
})();
