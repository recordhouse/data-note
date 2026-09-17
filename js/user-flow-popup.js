(() => {
  "use strict";

  if (!document.querySelector("#userFlowPanel") || window.UserFlowPopup) {
    return;
  }

  const MESSAGE_USER_FLOW_COMMAND = "response-mapping-user-flow-command";
  const MESSAGE_USER_FLOW_STATE = "response-mapping-user-flow-state";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";
  const PARENT_READY_EVENT = "response-mapping-popup-parent-ready";
  const MAX_USER_FLOW_SESSIONS = 150;
  const USER_FLOW_TAB_STORAGE_KEY = "response-mapping-user-flow-tabs:v1";
  const DEFAULT_USER_FLOW_TAB_ID = "default";
  const USER_FLOW_VIEW_RECORDINGS = "recordings";
  const USER_FLOW_VIEW_TEST = "test";
  const MAX_USER_FLOW_TABS = 20;
  const MAX_USER_FLOW_SESSIONS_PER_TAB = 20;
  const MAX_USER_FLOW_NOTICE_LENGTH = 1000;
  const USER_FLOW_NOTICE_ALLOWED_TAGS = new Set([
    "A",
    "B",
    "BR",
    "CODE",
    "EM",
    "I",
    "LI",
    "MARK",
    "OL",
    "P",
    "S",
    "SMALL",
    "SPAN",
    "STRONG",
    "U",
    "UL",
  ]);
  const USER_FLOW_NOTICE_DISCARDED_TAGS = new Set([
    "EMBED",
    "IFRAME",
    "MATH",
    "OBJECT",
    "SCRIPT",
    "STYLE",
    "SVG",
    "TEMPLATE",
  ]);
  const USER_FLOW_NOTICE_ALLOWED_PROTOCOLS = new Set([
    "http:",
    "https:",
    "mailto:",
    "tel:",
  ]);
  const REPLAY_NAVIGATION_IDLE_MS = 500;
  const REPLAY_NAVIGATION_TIMEOUT_MS = 60 * 1000;
  const USER_FLOW_STATUS_DOT_INTERVAL_MS = 420;
  const USER_FLOW_ANIMATED_STATUS_STATES = new Set([
    "communicating",
    "navigating",
    "recording",
    "replaying",
  ]);
  const PARENT_CONNECTION_CHECK_MS = 400;
  const PARENT_RECONNECT_TIMEOUT_MS = 60 * 1000;
  const USER_FLOW_TEST_REPLAY_ADVANCE_MS = 350;
  const USER_FLOW_DRAG_SCROLL_EDGE_PX = 48;
  const USER_FLOW_DRAG_SCROLL_STEP_PX = 18;
  const USER_FLOW_MOVE_ANIMATION_MS = 260;

  let currentUserFlowState = {};
  let activeUserFlowView = USER_FLOW_VIEW_RECORDINGS;
  let editingUserFlowSessionId = "";
  let editingUserFlowTabId = "";
  let editingUserFlowNotice = false;
  let renderedUserFlowSessionSignature = "";
  let renderedUserFlowTestSignature = "";
  let draggedUserFlowSessionId = "";
  let userFlowMoveToastTimer = 0;
  let userFlowMoveToastClearTimer = 0;
  let replayNavigationIdleTimer = 0;
  let replayNavigationParentReady = false;
  let replayNavigationSessionId = "";
  let replayNavigationTimer = 0;
  let userFlowStatusDotElement = null;
  let userFlowStatusDotText = "";
  let userFlowStatusDotStep = 0;
  let userFlowStatusDotTimer = 0;
  let activeParentWindow = window.opener || null;
  let parentConnectionCheckTimer = 0;
  let parentReconnectStartedAt = 0;
  let parentReconnectTimer = 0;
  let userFlowTestReplayAdvanceTimer = 0;
  let userFlowTestReplayCompletedSessionIds = new Set();
  let userFlowTestReplayCurrentSessionId = "";
  let userFlowTestReplayIndex = -1;
  let userFlowTestReplayQueue = [];
  let userFlowTestReplayStarted = false;
  let userFlowImportController = null;
  let syncingUserFlowTabsFromStorage = false;
  let userFlowTabs = readUserFlowTabs();

  function createDefaultUserFlowTabs({ withInitialTab = true } = {}) {
    return {
      activeTabId: withInitialTab ? DEFAULT_USER_FLOW_TAB_ID : "",
      notice: "",
      noticeCollapsed: true,
      sessionOrder: [],
      sessionTabs: {},
      testSessionIds: [],
      tabs: withInitialTab
        ? [{ id: DEFAULT_USER_FLOW_TAB_ID, name: "Tab 01" }]
        : [],
      version: 9,
    };
  }

  function normalizeUserFlowNotice(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .trim()
      .slice(0, MAX_USER_FLOW_NOTICE_LENGTH);
  }

  function isSafeUserFlowNoticeHref(value) {
    const href = String(value || "").trim();

    if (!href) {
      return false;
    }

    try {
      return USER_FLOW_NOTICE_ALLOWED_PROTOCOLS.has(
        new URL(href, window.location.href).protocol,
      );
    } catch (error) {
      return false;
    }
  }

  function sanitizeUserFlowNoticeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tagName = node.tagName.toUpperCase();
    const fragment = document.createDocumentFragment();

    if (USER_FLOW_NOTICE_DISCARDED_TAGS.has(tagName)) {
      return fragment;
    }

    const sanitizedNode = USER_FLOW_NOTICE_ALLOWED_TAGS.has(tagName)
      ? document.createElement(tagName.toLowerCase())
      : fragment;

    if (tagName === "A" && sanitizedNode instanceof HTMLElement) {
      const href = node.getAttribute("href");
      const title = node.getAttribute("title");
      const target = node.getAttribute("target");

      if (isSafeUserFlowNoticeHref(href)) {
        sanitizedNode.setAttribute("href", href.trim());
      }

      if (title) {
        sanitizedNode.setAttribute("title", title.slice(0, 100));
      }

      if (target === "_blank" || target === "_self") {
        sanitizedNode.setAttribute("target", target);
      }

      if (target === "_blank") {
        sanitizedNode.setAttribute("rel", "noopener noreferrer");
      }
    }

    Array.from(node.childNodes).forEach((childNode) => {
      sanitizedNode.appendChild(sanitizeUserFlowNoticeNode(childNode));
    });

    return sanitizedNode;
  }

  function renderUserFlowNoticeMarkup(container, noticeValue) {
    if (!noticeValue) {
      container.textContent = "등록된 알림이 없습니다.";
      return;
    }

    const template = document.createElement("template");
    template.innerHTML = noticeValue;
    const fragment = document.createDocumentFragment();

    Array.from(template.content.childNodes).forEach((node) => {
      fragment.appendChild(sanitizeUserFlowNoticeNode(node));
    });

    container.replaceChildren(fragment);
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

      if (!tabs.length && Number(stored.version || 0) < 9) {
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
          : tabs[0]?.id || "",
        notice: normalizeUserFlowNotice(stored.notice),
        noticeCollapsed: Object.prototype.hasOwnProperty.call(
          stored,
          "noticeCollapsed",
        )
          ? Boolean(stored.noticeCollapsed)
          : true,
        sessionOrder,
        sessionTabs,
        testSessionIds,
        tabs,
        version: 9,
      };
    } catch (error) {
      return fallback;
    }
  }

  function persistUserFlowTabs() {
    if (syncingUserFlowTabsFromStorage) {
      return true;
    }

    try {
      userFlowTabs.version = 9;
      window.localStorage.setItem(USER_FLOW_TAB_STORAGE_KEY, JSON.stringify(userFlowTabs));
      return true;
    } catch (error) {
      showUserFlowImportStatus("탭 구성을 저장하지 못했습니다.");
      return false;
    }
  }

  function resetUserFlowOrganization() {
    cancelUserFlowTestReplay({ clearResults: true, rerender: false });
    userFlowTabs = createDefaultUserFlowTabs({ withInitialTab: false });
    activeUserFlowView = USER_FLOW_VIEW_RECORDINGS;
    editingUserFlowSessionId = "";
    editingUserFlowTabId = "";
    editingUserFlowNotice = false;
    renderedUserFlowSessionSignature = "";
    renderedUserFlowTestSignature = "";
    resetUserFlowSessionDrag();
    persistUserFlowTabs();
    renderUserFlowView();
    renderUserFlowTabs([]);
  }

  function getFirstUserFlowTab() {
    return userFlowTabs.tabs[0] || null;
  }

  function getUserFlowSessionTabId(sessionId) {
    const assignedTabId = userFlowTabs.sessionTabs[sessionId];
    return userFlowTabs.tabs.some((tab) => tab.id === assignedTabId)
      ? assignedTabId
      : getFirstUserFlowTab()?.id || "";
  }

  function reconcileUserFlowTabs(sessions, { removeMissingSessions = false } = {}) {
    const sessionIds = new Set(sessions.map((session) => session.id));
    const tabIds = new Set(userFlowTabs.tabs.map((tab) => tab.id));
    const fallbackTabId = tabIds.has(userFlowTabs.activeTabId)
      ? userFlowTabs.activeTabId
      : getFirstUserFlowTab()?.id || "";
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

    if (!fallbackTabId) {
      if (Object.keys(userFlowTabs.sessionTabs).length) {
        userFlowTabs.sessionTabs = {};
        changed = true;
      }

      if (changed) {
        persistUserFlowTabs();
      }

      return;
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

  function placeNewRecordingAtTop(sessionId, sourceSessionId = "") {
    const normalizedSessionId = String(sessionId || "");

    if (!normalizedSessionId) {
      return "";
    }

    let changed = false;

    if (sourceSessionId) {
      const sourceTabId = getUserFlowSessionTabId(sourceSessionId);

      if (sourceTabId) {
        if (userFlowTabs.sessionTabs[normalizedSessionId] !== sourceTabId) {
          userFlowTabs.sessionTabs[normalizedSessionId] = sourceTabId;
          changed = true;
        }

        if (userFlowTabs.activeTabId !== sourceTabId) {
          userFlowTabs.activeTabId = sourceTabId;
          changed = true;
        }
      }
    }

    const nextSessionOrder = [
      normalizedSessionId,
      ...userFlowTabs.sessionOrder.filter(
        (orderedSessionId) => orderedSessionId !== normalizedSessionId,
      ),
    ];

    if (
      nextSessionOrder.some(
        (orderedSessionId, index) =>
          orderedSessionId !== userFlowTabs.sessionOrder[index],
      )
    ) {
      userFlowTabs.sessionOrder = nextSessionOrder;
      changed = true;
    }

    if (changed) {
      persistUserFlowTabs();
    }

    return normalizedSessionId;
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
      `${tabName} 탭에는 로그를 최대 ${MAX_USER_FLOW_SESSIONS_PER_TAB}개까지 추가할 수 있습니다.`,
    );
  }

  function renderUserFlowTabs(sessions) {
    const tabList = document.querySelector("#userFlowListTabs");

    if (!tabList) {
      return;
    }

    const organizationDisabled = Boolean(
      currentUserFlowState.isRecording || currentUserFlowState.isReplaying,
    );

    tabList.innerHTML = userFlowTabs.tabs
      .map((tab) => {
        const isActive = tab.id === userFlowTabs.activeTabId;
        const isEditing = tab.id === editingUserFlowTabId;

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
                  />`
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
              !isEditing
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
    if (!recordedAt) {
      return "로그 일시 없음";
    }

    const date = new Date(recordedAt);

    if (Number.isNaN(date.getTime())) {
      return "로그 일시 없음";
    }

    const dateText = [
      String(date.getFullYear()).slice(-2),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join(".");
    const timeText = [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0"),
    ].join(":");

    return `${dateText}. ${timeText}`;
  }

  function formatUserFlowSessionTitle(session, recordedAt) {
    return String(session?.name || "").trim() || recordedAt;
  }

  function formatUserFlowSessionSubtitle(session) {
    return String(session?.titlePrefix || "").trim();
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

  function getUserFlowSessionReplayProgress(session, flowState) {
    const isActive = Boolean(
      flowState.isReplaying && flowState.replaySessionId === session.id,
    );
    const durationMs = Math.max(0, Number(session.durationMs || 0));
    const remainingMs = Math.max(0, Number(flowState.replayRemainingMs || 0));
    const remainingRatio = isActive
      ? durationMs > 0
        ? Math.min(1, remainingMs / durationMs)
        : 0
      : 1;

    return {
      isActive,
      remainingPercent: Math.round(remainingRatio * 100),
      remainingRatio,
    };
  }

  function renderUserFlowSessionReplayProgress(session, flowState) {
    const progress = getUserFlowSessionReplayProgress(session, flowState);

    return `
      <div
        class="user-flow-session-replay-progress"
        data-state="${progress.isActive ? "active" : "inactive"}"
        data-user-flow-session-progress="${escapeHtml(session.id)}"
        role="progressbar"
        aria-label="재생 남은 시간"
        aria-disabled="${String(!progress.isActive)}"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${progress.remainingPercent}"
        aria-valuetext="${progress.isActive ? `재생 ${progress.remainingPercent}% 남음` : "재생 대기"}"
        style="--user-flow-replay-remaining: ${progress.remainingRatio.toFixed(4)}"
      >
        <span class="user-flow-session-replay-progress-fill"></span>
      </div>
    `;
  }

  function getUserFlowSessionSignature(flowState, sessions) {
    return JSON.stringify({
      activeTabId: userFlowTabs.activeTabId,
      activeRecordingSessionId: flowState.activeRecordingSessionId || "",
      editingUserFlowSessionId,
      isRecording: Boolean(flowState.isRecording),
      isReplaying: Boolean(flowState.isReplaying),
      resumeRecordingSessionId: flowState.resumeRecordingSessionId || "",
      continuedRecordingSourceSessionId:
        flowState.continuedRecordingSourceSessionId || "",
      replayNavigationSessionId,
      replaySessionId: flowState.replaySessionId || "",
      sessionOrder: userFlowTabs.sessionOrder,
      sessionTabs: sessions.map((session) => [
        session.id,
        getUserFlowSessionTabId(session.id),
      ]),
      tabs: userFlowTabs.tabs,
      testSessionIds: userFlowTabs.testSessionIds,
      testReplayCompletedSessionIds: Array.from(
        userFlowTestReplayCompletedSessionIds,
      ),
      testReplayCurrentSessionId: userFlowTestReplayCurrentSessionId,
      sessions: sessions.map((session) => ({
        durationMs: session.durationMs,
        eventCount: session.eventCount,
        id: session.id,
        name: session.name || "",
        titlePrefix: session.titlePrefix || "",
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

    document
      .querySelectorAll("[data-user-flow-session-progress]")
      .forEach((progressElement) => {
        const session = sessions.find(
          (item) => item.id === progressElement.dataset.userFlowSessionProgress,
        );

        if (!session) {
          return;
        }

        const progress = getUserFlowSessionReplayProgress(session, flowState);
        progressElement.dataset.state = progress.isActive ? "active" : "inactive";
        progressElement.setAttribute(
          "aria-disabled",
          String(!progress.isActive),
        );
        progressElement.setAttribute(
          "aria-valuenow",
          String(progress.remainingPercent),
        );
        progressElement.setAttribute(
          "aria-valuetext",
          progress.isActive
            ? `재생 ${progress.remainingPercent}% 남음`
            : "재생 대기",
        );
        progressElement.style.setProperty(
          "--user-flow-replay-remaining",
          progress.remainingRatio.toFixed(4),
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
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const testSessions = userFlowTabs.testSessionIds
      .map((sessionId) => sessionById.get(sessionId))
      .filter(Boolean);

    if (!sessionList) {
      return;
    }

    if (renderedUserFlowTestSignature === sessionSignature) {
      return;
    }

    renderedUserFlowTestSignature = sessionSignature;

    if (!testSessions.length) {
      sessionList.innerHTML =
        '<div class="user-flow-empty">로그 목록을 이 탭으로 끌어다 놓아주세요.</div>';
      return;
    }

    sessionList.innerHTML = testSessions
      .map((session) => {
        const isRecordingSession = flowState.activeRecordingSessionId === session.id;
        const isReplayingSession = flowState.replaySessionId === session.id;
        const isNavigatingSession = replayNavigationSessionId === session.id;
        const recordedAt = formatUserFlowRecordedAt(session.recordedAt);
        const sessionName = String(session.name || "").trim();
        const sessionTitle = formatUserFlowSessionTitle(session, recordedAt);
        const sessionSubtitle = formatUserFlowSessionSubtitle(session);
        const isTestReplayCompleted =
          userFlowTestReplayCompletedSessionIds.has(session.id);
        const isTestReplayCurrent =
          userFlowTestReplayCurrentSessionId === session.id;
        const disabled =
          flowState.isRecording ||
          (!session.eventCount && !isReplayingSession) ||
          (flowState.isReplaying && !isReplayingSession);
        const replayDisabled =
          disabled || Boolean(replayNavigationSessionId);
        const changeDisabled =
          flowState.isRecording || flowState.isReplaying;
        const sessionMeta = getUserFlowSessionMeta(session, flowState, isReplayingSession);
        return `
          <article
            class="user-flow-session"
            draggable="false"
            data-state="${isRecordingSession ? "recording" : isReplayingSession ? "replaying" : "idle"}"
            data-test-state="${isTestReplayCurrent ? "queued" : isTestReplayCompleted ? "completed" : "idle"}"
            data-user-flow-session-id="${escapeHtml(session.id)}"
          >
            ${renderUserFlowSessionReplayProgress(session, flowState)}
            <div class="user-flow-session-main">
              ${sessionSubtitle ? `<span class="user-flow-session-subtitle">${escapeHtml(sessionSubtitle)}</span>` : ""}
              <strong class="user-flow-session-time">
                <span>${escapeHtml(sessionTitle)}</span>
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
              >${isNavigatingSession ? "이동 중" : isReplayingSession ? "재생 중지" : isTestReplayCurrent ? "재생 대기" : "재생"}</button>
              <button
                class="user-flow-test-remove"
                type="button"
                data-user-flow-test-remove="${escapeHtml(session.id)}"
                aria-label="${escapeHtml(sessionTitle)} 로그 테스트 목록에서 제거"
                ${changeDisabled ? "disabled" : ""}
              >목록 제거</button>
            </div>
            ${isTestReplayCompleted ? '<p class="user-flow-test-replay-complete" role="status"><strong>테스트 완료</strong></p>' : ""}
          </article>
        `;
      })
      .join("");
  }

  function renderUserFlowNotice(flowState = currentUserFlowState) {
    const notice = document.querySelector("#userFlowNotice");
    const noticeView = document.querySelector("#userFlowNoticeView");
    const noticeText = document.querySelector("#userFlowNoticeText");
    const noticeForm = document.querySelector("#userFlowNoticeForm");
    const noticeInput = document.querySelector("#userFlowNoticeInput");
    const editButton = document.querySelector("#userFlowNoticeEditButton");
    const toggleButton = document.querySelector("#userFlowNoticeToggleButton");

    if (
      !notice ||
      !noticeView ||
      !noticeText ||
      !noticeForm ||
      !noticeInput ||
      !editButton ||
      !toggleButton
    ) {
      return;
    }

    const noticeValue = normalizeUserFlowNotice(userFlowTabs.notice);
    const isBlocked = Boolean(flowState.isRecording || flowState.isReplaying);
    const isCollapsed = Boolean(userFlowTabs.noticeCollapsed);
    notice.dataset.empty = String(!noticeValue);
    notice.dataset.collapsed = String(isCollapsed);
    renderUserFlowNoticeMarkup(noticeText, noticeValue);
    editButton.disabled = isBlocked;
    toggleButton.disabled = editingUserFlowNotice;
    toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
    const toggleLabel = editingUserFlowNotice
      ? "알림 수정 중에는 접을 수 없습니다"
      : isCollapsed
        ? "알림 펼치기"
        : "알림 접기";
    toggleButton.setAttribute("aria-label", toggleLabel);
    toggleButton.title = toggleLabel;
    noticeView.hidden = editingUserFlowNotice;
    noticeForm.hidden = !editingUserFlowNotice;

    if (editingUserFlowNotice && document.activeElement !== noticeInput) {
      noticeInput.value = noticeValue;
    }
  }

  function stopUserFlowStatusDots() {
    window.clearInterval(userFlowStatusDotTimer);
    userFlowStatusDotElement = null;
    userFlowStatusDotText = "";
    userFlowStatusDotStep = 0;
    userFlowStatusDotTimer = 0;
  }

  function setUserFlowStatus(
    status,
    statusText,
    statusState,
    { animateDots = false } = {},
  ) {
    status.dataset.state = statusState;

    if (!animateDots) {
      stopUserFlowStatusDots();
      status.textContent = statusText;
      return;
    }

    const baseText = String(statusText || "").replace(/\.+$/, "");

    if (
      userFlowStatusDotTimer &&
      userFlowStatusDotElement === status &&
      userFlowStatusDotText === baseText
    ) {
      return;
    }

    stopUserFlowStatusDots();
    userFlowStatusDotElement = status;
    userFlowStatusDotText = baseText;
    userFlowStatusDotStep = 0;
    status.textContent = baseText;
    userFlowStatusDotTimer = window.setInterval(() => {
      if (!status.isConnected) {
        stopUserFlowStatusDots();
        return;
      }

      userFlowStatusDotStep = (userFlowStatusDotStep + 1) % 3;
      status.textContent = `${baseText}${".".repeat(userFlowStatusDotStep)}`;
    }, USER_FLOW_STATUS_DOT_INTERVAL_MS);
  }

  function renderUserFlowState(flowState = {}) {
    currentUserFlowState = flowState;
    updateReplayNavigationState(flowState);
    const status = document.querySelector("#userFlowStatus");
    const recordButton = document.querySelector("#userFlowRecordButton");
    const exportAllButton = document.querySelector("#userFlowExportAllButton");
    const clearAllButton = document.querySelector("#userFlowClearAllButton");
    const tabAddButton = document.querySelector("#userFlowTabAddButton");
    const sessionList = document.querySelector("#userFlowSessionList");

    if (!status || !recordButton || !sessionList) {
      return;
    }

    renderUserFlowNotice(flowState);

    const hasUserFlowTabs = userFlowTabs.tabs.length > 0;
    const pendingRequestCount = Math.max(
      0,
      Number(flowState.pendingRequestCount || 0),
    );
    const isWaitingForCommunication = Boolean(
      pendingRequestCount > 0 || flowState.isWaitingForRequests,
    );
    let statusText = "저장된 로그가 없습니다";
    let statusState = "idle";

    if (flowState.responseError) {
      statusText = flowState.responseError;
      statusState = "error";
    } else if (replayNavigationSessionId) {
      statusText = isWaitingForCommunication
        ? "통신 중입니다"
        : "로그 시작 페이지로 이동 중입니다";
      statusState = isWaitingForCommunication ? "communicating" : "navigating";
    } else if (flowState.isRecording) {
      statusText = "로그를 저장하고 있습니다";
      statusState = "recording";
    } else if (flowState.isReplaying) {
      statusText = flowState.isWaitingForRequests
        ? "통신이 완료될 때까지 재생을 기다리고 있습니다"
        : "저장된 로그를 재생하고 있습니다";
      statusState = "replaying";
    } else if (flowState.error) {
      statusText = flowState.error;
      statusState = "error";
    } else if (!hasUserFlowTabs) {
      statusText = "로그를 저장하려면 목록 탭을 추가해주세요";
    } else if (flowState.canReplay) {
      statusText = "로그 재생을 준비했습니다";
      statusState = "ready";
    }

    setUserFlowStatus(status, statusText, statusState, {
      animateDots: USER_FLOW_ANIMATED_STATUS_STATES.has(statusState),
    });

    const canContinueRecording = Boolean(
      !flowState.isRecording &&
        !flowState.isReplaying &&
        flowState.resumeRecordingSessionId,
    );
    const continueEventCount = Math.max(
      0,
      Number(flowState.resumeRecordingEventCount || 0),
    );

    recordButton.textContent = flowState.isRecording
      ? "저장 중지"
      : canContinueRecording
        ? "이어서 저장"
        : "로그 저장";
    recordButton.title = canContinueRecording
      ? `${continueEventCount.toLocaleString("ko-KR")}개 행동 다음부터 이어서 저장합니다.`
      : "";
    recordButton.setAttribute("aria-pressed", String(Boolean(flowState.isRecording)));
    recordButton.disabled = Boolean(
      flowState.isReplaying || (!flowState.isRecording && !hasUserFlowTabs),
    );

    userFlowImportController?.updateControls();

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

    if (clearAllButton) {
      clearAllButton.disabled = Boolean(
        flowState.isRecording ||
          flowState.isReplaying ||
          (!sessions.length && !userFlowTabs.tabs.length),
      );
    }

    const previousSessionPositions = captureUserFlowSessionPositions();
    const newRecordingSessionId =
      flowState.isRecording &&
      flowState.activeRecordingSessionId &&
      !userFlowTabs.sessionOrder.includes(flowState.activeRecordingSessionId)
        ? flowState.activeRecordingSessionId
        : "";
    reconcileUserFlowTabs(sessions, { removeMissingSessions: hasSessionState });
    const addedRecordingSessionId = placeNewRecordingAtTop(
      newRecordingSessionId,
      flowState.continuedRecordingSourceSessionId,
    );
    renderUserFlowTabs(sessions);
    renderUserFlowView();
    const visibleSessions = userFlowTabs.tabs.length
      ? getOrderedUserFlowSessions(sessions).filter(
          (session) =>
            getUserFlowSessionTabId(session.id) === userFlowTabs.activeTabId,
        )
      : [];

    if (userFlowTabs.activeTabId) {
      sessionList.setAttribute(
        "aria-labelledby",
        getUserFlowTabElementId(userFlowTabs.activeTabId),
      );
      sessionList.removeAttribute("aria-label");
    } else {
      sessionList.removeAttribute("aria-labelledby");
      sessionList.setAttribute("aria-label", "로그 목록");
    }

    if (
      flowState.isRecording ||
      flowState.isReplaying ||
      !sessions.some((session) => session.id === editingUserFlowSessionId)
    ) {
      editingUserFlowSessionId = "";
    }

    const sessionSignature = getUserFlowSessionSignature(flowState, sessions);
    renderUserFlowTestSessions(flowState, sessions, sessionSignature);

    if (!visibleSessions.length) {
      renderedUserFlowSessionSignature = "";
      const emptyMessage = !userFlowTabs.tabs.length
        ? "탭을 추가하면 로그 저장을 시작할 수 있습니다."
        : sessions.length
          ? "이 탭에 저장된 로그가 없습니다."
          : "저장된 로그가 없습니다.";
      sessionList.innerHTML = `<div class="user-flow-empty">${emptyMessage}</div>`;
      updateUserFlowSessionProgress(flowState, sessions);
      animateUserFlowSessionAddition(addedRecordingSessionId);
      return;
    }

    if (renderedUserFlowSessionSignature === sessionSignature) {
      updateUserFlowSessionProgress(flowState, sessions);
      animateUserFlowSessionAddition(addedRecordingSessionId);
      return;
    }

    renderedUserFlowSessionSignature = sessionSignature;

    sessionList.innerHTML = visibleSessions
      .map((session) => {
        const isRecordingSession = flowState.activeRecordingSessionId === session.id;
        const isReplayingSession = flowState.replaySessionId === session.id;
        const recordedAt = formatUserFlowRecordedAt(session.recordedAt);
        const sessionName = String(session.name || "").trim();
        const sessionTitle = formatUserFlowSessionTitle(session, recordedAt);
        const sessionSubtitle = formatUserFlowSessionSubtitle(session);
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
              ${renderUserFlowSessionReplayProgress(session, flowState)}
              <div class="user-flow-session-main">
                ${sessionSubtitle ? `<span class="user-flow-session-subtitle">${escapeHtml(sessionSubtitle)}</span>` : ""}
                <form class="user-flow-name-editor" data-user-flow-name-form>
                  <input
                    class="user-flow-name-input"
                    type="text"
                    value="${escapeHtml(sessionName)}"
                    maxlength="40"
                    placeholder="로그 이름"
                    aria-label="로그 이름"
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
            ${renderUserFlowSessionReplayProgress(session, flowState)}
            <div class="user-flow-session-main">
              ${sessionSubtitle ? `<span class="user-flow-session-subtitle">${escapeHtml(sessionSubtitle)}</span>` : ""}
              <strong class="user-flow-session-time">
                <span>${escapeHtml(sessionTitle)}</span>
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
                aria-label="${escapeHtml(sessionTitle)} 로그 내보내기"
                ${changeDisabled ? "disabled" : ""}
              >내보내기</button>
              <button
                class="user-flow-delete"
                type="button"
                data-user-flow-command="delete-session"
                data-session-id="${escapeHtml(session.id)}"
                aria-label="${escapeHtml(sessionTitle)} 로그 삭제"
                ${changeDisabled ? "disabled" : ""}
              >삭제</button>
            </div>
          </article>
        `;
      })
      .join("");

    animateUserFlowSessionMove(
      previousSessionPositions,
      addedRecordingSessionId,
    );
    animateUserFlowSessionAddition(addedRecordingSessionId);
  }

  function isParentWindowOpen(parentWindow) {
    try {
      return Boolean(parentWindow && !parentWindow.closed);
    } catch (error) {
      return false;
    }
  }

  function getActiveParentWindow() {
    if (isParentWindowOpen(activeParentWindow)) {
      return activeParentWindow;
    }

    const popupCoreParentWindow = window.PopupCore?.getParentWindow?.();

    if (isParentWindowOpen(popupCoreParentWindow)) {
      activeParentWindow = popupCoreParentWindow;
      return activeParentWindow;
    }

    if (isParentWindowOpen(window.opener)) {
      activeParentWindow = window.opener;
      return activeParentWindow;
    }

    activeParentWindow = null;
    return null;
  }

  function stopParentReconnect() {
    window.clearInterval(parentReconnectTimer);
    parentReconnectTimer = 0;
    parentReconnectStartedAt = 0;
  }

  function sendUserFlowCommand(command, payload = {}, { silent = false } = {}) {
    const parentWindow = getActiveParentWindow();

    if (!parentWindow) {
      if (!silent) {
        showUserFlowImportStatus("부모 화면에 연결할 수 없습니다.");
      }

      return false;
    }

    try {
      parentWindow.postMessage(
        {
          type: MESSAGE_USER_FLOW_COMMAND,
          command,
          ...payload,
        },
        window.location.origin === "null" ? "*" : window.location.origin,
      );
      return true;
    } catch (error) {
      if (activeParentWindow === parentWindow) {
        activeParentWindow = null;
      }

      if (!silent) {
        showUserFlowImportStatus("부모 화면에 연결할 수 없습니다.");
      }

      return false;
    }
  }

  function getParentCurrentPage() {
    try {
      const parentWindow = getActiveParentWindow();

      if (!parentWindow) {
        return "";
      }

      return `${parentWindow.location.pathname}${parentWindow.location.search}${parentWindow.location.hash}`;
    } catch (error) {
      return "";
    }
  }

  function startParentReconnect(parentWindow) {
    stopParentReconnect();
    parentReconnectStartedAt = Date.now();

    const requestParentState = () => {
      if (
        getActiveParentWindow() !== parentWindow ||
        Date.now() - parentReconnectStartedAt > PARENT_RECONNECT_TIMEOUT_MS
      ) {
        stopParentReconnect();
        return;
      }

      sendUserFlowCommand("get-state", {}, { silent: true });
    };

    requestParentState();
    parentReconnectTimer = window.setInterval(
      requestParentState,
      PARENT_CONNECTION_CHECK_MS,
    );
  }

  function openParentForReplay(sessionId) {
    const session = (currentUserFlowState.sessions || []).find(
      (item) => item.id === sessionId,
    );
    const startPage = String(session?.startPage || "").trim();

    if (!session?.eventCount || !startPage) {
      showUserFlowImportStatus("재생할 로그의 시작 페이지를 찾지 못했습니다.");
      return false;
    }

    let parentWindow = null;

    try {
      const replayUrl = new URL(startPage, window.location.href);

      if (replayUrl.origin !== window.location.origin) {
        showUserFlowImportStatus("다른 사이트의 로그 페이지는 열 수 없습니다.");
        return false;
      }

      parentWindow = window.open("about:blank", "_blank");

      if (!parentWindow) {
        showUserFlowImportStatus(
          "부모 화면이 차단되었습니다. 이 사이트의 팝업을 허용해주세요.",
        );
        return false;
      }

      activeParentWindow = parentWindow;
      window.PopupCore?.connectParent?.(parentWindow);
      startParentReconnect(parentWindow);
      parentWindow.location.replace(replayUrl.href);
      parentWindow.focus();
      return true;
    } catch (error) {
      try {
        parentWindow?.close();
      } catch (closeError) {
        // The browser may already have detached the failed parent window.
      }

      if (activeParentWindow === parentWindow) {
        activeParentWindow = null;
      }

      stopParentReconnect();
      showUserFlowImportStatus("재생할 부모 화면을 열지 못했습니다.");
      return false;
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

  function isUserFlowTestReplayRunning() {
    return Boolean(userFlowTestReplayCurrentSessionId);
  }

  function clearUserFlowTestReplayTimers() {
    window.clearTimeout(userFlowTestReplayAdvanceTimer);
    userFlowTestReplayAdvanceTimer = 0;
  }

  function rerenderUserFlowTestReplay() {
    renderedUserFlowTestSignature = "";
    renderUserFlowState(currentUserFlowState);
  }

  function setUserFlowTestReplayCompleted(sessionId) {
    const normalizedSessionId = String(sessionId || "");

    if (
      !normalizedSessionId ||
      userFlowTestReplayCompletedSessionIds.has(normalizedSessionId)
    ) {
      return false;
    }

    userFlowTestReplayCompletedSessionIds.add(normalizedSessionId);
    renderedUserFlowTestSignature = "";
    return true;
  }

  function finishUserFlowTestReplay() {
    clearUserFlowTestReplayTimers();
    userFlowTestReplayCurrentSessionId = "";
    userFlowTestReplayIndex = -1;
    userFlowTestReplayQueue = [];
    userFlowTestReplayStarted = false;
    rerenderUserFlowTestReplay();
  }

  function cancelUserFlowTestReplay({ clearResults = false, rerender = true } = {}) {
    const navigationBelongsToTest = Boolean(
      replayNavigationSessionId &&
        replayNavigationSessionId === userFlowTestReplayCurrentSessionId,
    );

    clearUserFlowTestReplayTimers();
    userFlowTestReplayCurrentSessionId = "";
    userFlowTestReplayIndex = -1;
    userFlowTestReplayQueue = [];
    userFlowTestReplayStarted = false;

    if (clearResults) {
      userFlowTestReplayCompletedSessionIds.clear();
    }

    if (navigationBelongsToTest) {
      clearReplayNavigationState({ rerender: false });
    }

    if (rerender) {
      rerenderUserFlowTestReplay();
    }
  }

  function requestUserFlowReplay(sessionId) {
    if (!getActiveParentWindow()) {
      if (openParentForReplay(sessionId)) {
        startReplayNavigationState(sessionId);
        return true;
      }

      return false;
    }

    const startsPageNavigation =
      !currentUserFlowState.isReplaying && willReplayNavigate(sessionId);

    if (startsPageNavigation) {
      startReplayNavigationState(sessionId);
    }

    const commandSent = sendUserFlowCommand("toggle-replay-session", {
      sessionId,
    });

    if (!commandSent) {
      if (startsPageNavigation) {
        clearReplayNavigationState({ rerender: false });
      }

      return false;
    }

    return true;
  }

  function playCurrentUserFlowTestReplay() {
    const sessionId = userFlowTestReplayQueue[userFlowTestReplayIndex] || "";

    if (!sessionId) {
      finishUserFlowTestReplay();
      return;
    }

    userFlowTestReplayCurrentSessionId = sessionId;
    userFlowTestReplayStarted = false;
    const session = (currentUserFlowState.sessions || []).find(
      (item) => item.id === sessionId,
    );

    if (!session?.eventCount) {
      scheduleNextUserFlowTestReplay();
      rerenderUserFlowTestReplay();
      return;
    }

    rerenderUserFlowTestReplay();

    if (!requestUserFlowReplay(sessionId)) {
      scheduleNextUserFlowTestReplay();
      rerenderUserFlowTestReplay();
    }
  }

  function scheduleNextUserFlowTestReplay() {
    window.clearTimeout(userFlowTestReplayAdvanceTimer);
    userFlowTestReplayStarted = false;
    userFlowTestReplayAdvanceTimer = window.setTimeout(() => {
      userFlowTestReplayAdvanceTimer = 0;
      userFlowTestReplayIndex += 1;
      playCurrentUserFlowTestReplay();
    }, USER_FLOW_TEST_REPLAY_ADVANCE_MS);
  }

  function startUserFlowTestReplay(sessionId) {
    const availableSessionIds = new Set(
      (currentUserFlowState.sessions || []).map((session) => session.id),
    );
    const orderedSessionIds = userFlowTabs.testSessionIds.filter((testSessionId) =>
      availableSessionIds.has(testSessionId),
    );
    const startIndex = orderedSessionIds.indexOf(sessionId);

    if (startIndex < 0) {
      showUserFlowImportStatus("로그 테스트 목록에서 재생 항목을 찾지 못했습니다.");
      return false;
    }

    cancelUserFlowTestReplay({ clearResults: true, rerender: false });
    userFlowTestReplayQueue = orderedSessionIds.slice(startIndex);
    userFlowTestReplayIndex = 0;
    playCurrentUserFlowTestReplay();
    return true;
  }

  function updateUserFlowTestReplayState(previousState, nextState) {
    const sessionId = userFlowTestReplayCurrentSessionId;

    if (!sessionId) {
      return;
    }

    const wasReplaying = Boolean(
      previousState?.isReplaying && previousState.replaySessionId === sessionId,
    );
    const isReplaying = Boolean(
      nextState?.isReplaying && nextState.replaySessionId === sessionId,
    );

    if (isReplaying) {
      userFlowTestReplayStarted = true;
    }

    const replayFailed = Boolean(
      !nextState.isReplaying &&
        nextState.failedReplaySessionId === sessionId &&
        previousState?.failedReplaySessionId !== sessionId,
    );

    if (replayFailed) {
      if (replayNavigationSessionId === sessionId) {
        clearReplayNavigationState({ rerender: false });
      }

      scheduleNextUserFlowTestReplay();
      return;
    }

    if (wasReplaying && !isReplaying && userFlowTestReplayStarted) {
      if (nextState.completedReplaySessionId === sessionId) {
        setUserFlowTestReplayCompleted(sessionId);
        scheduleNextUserFlowTestReplay();
      } else {
        cancelUserFlowTestReplay({ rerender: false });
      }
    }
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
      const isTestReplayNavigation =
        userFlowTestReplayCurrentSessionId === sessionId;
      clearReplayNavigationState({ rerender: false });

      if (isTestReplayNavigation) {
        scheduleNextUserFlowTestReplay();
        rerenderUserFlowTestReplay();
      } else {
        rerenderUserFlowOrganization();
      }

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
        const shouldStartTestReplay =
          userFlowTestReplayCurrentSessionId === expectedSessionId;
        clearReplayNavigationState({ rerender: false });

        if (shouldStartTestReplay) {
          rerenderUserFlowTestReplay();

          if (!requestUserFlowReplay(expectedSessionId)) {
            scheduleNextUserFlowTestReplay();
            rerenderUserFlowTestReplay();
          }
        } else {
          rerenderUserFlowOrganization();
        }
      }
    }, REPLAY_NAVIGATION_IDLE_MS);
  }

  function handleUserFlowControl(event) {
    const button = event.target.closest("[data-user-flow-command]");

    if (!button || button.disabled) {
      return;
    }

    const command = button.dataset.userFlowCommand;

    if (command === "clear") {
      const sessionCount = (currentUserFlowState.sessions || []).length;
      const tabCount = userFlowTabs.tabs.length;

      if (
        (!sessionCount && !tabCount) ||
        !window.confirm(
          `현재 팝업에 저장된 로그 ${sessionCount.toLocaleString("ko-KR")}개와 탭 ${tabCount.toLocaleString("ko-KR")}개를 모두 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 삭제하시겠습니까?`,
        )
      ) {
        return;
      }
    }

    if (command === "toggle-record" && !currentUserFlowState.isRecording) {
      const resumeSessionId =
        currentUserFlowState.resumeRecordingSessionId || "";
      const targetTabId = resumeSessionId
        ? getUserFlowSessionTabId(resumeSessionId)
        : userFlowTabs.activeTabId;
      if (
        targetTabId &&
        getUserFlowTabSessionCount(targetTabId) + 1 >
          MAX_USER_FLOW_SESSIONS_PER_TAB
      ) {
        showUserFlowTabLimit(targetTabId);
        return;
      }
    }

    const payload = {
      sessionId: button.dataset.sessionId || "",
    };
    const isTestReplayButton = Boolean(
      button.closest("#userFlowTestSessionList"),
    );

    if (
      command === "toggle-replay-session" &&
      isUserFlowTestReplayRunning() &&
      currentUserFlowState.isReplaying &&
      currentUserFlowState.replaySessionId === payload.sessionId
    ) {
      cancelUserFlowTestReplay();
    } else if (
      command === "toggle-replay-session" &&
      isTestReplayButton &&
      !currentUserFlowState.isReplaying
    ) {
      startUserFlowTestReplay(payload.sessionId);
      return;
    }

    if (command === "toggle-replay-session") {
      cancelUserFlowTestReplay({ rerender: false });
      requestUserFlowReplay(payload.sessionId);
      return;
    }

    if (command === "toggle-record") {
      cancelUserFlowTestReplay({ rerender: false });
    }

    if (command === "export-all-recordings") {
      payload.tabOrganization = {
        notice: normalizeUserFlowNotice(userFlowTabs.notice),
        sessionTabs: { ...userFlowTabs.sessionTabs },
        tabs: userFlowTabs.tabs.map((tab) => ({ ...tab })),
      };
    }

    const commandSent = sendUserFlowCommand(command, payload);

    if (commandSent && command === "clear") {
      resetUserFlowOrganization();
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
    } else {
      userFlowTestReplayCompletedSessionIds.delete(sessionId);
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
    const nameInput = event.target.closest("[data-user-flow-tab-name-input]");
    const requestedEditTabId =
      editButton?.dataset.userFlowTabEdit ||
      nameInput?.dataset.userFlowTabNameInput ||
      "";

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
      const tabIndex = userFlowTabs.tabs.findIndex((item) => item.id === tabId);
      const sessionIds = (currentUserFlowState.sessions || [])
        .filter((session) => getUserFlowSessionTabId(session.id) === tabId)
        .map((session) => session.id);

      if (!tab || tabIndex < 0) {
        return;
      }

      if (
        !window.confirm(
          `${tab.name} 탭을 삭제하면 탭 안의 로그 ${sessionIds.length.toLocaleString("ko-KR")}개도 모두 삭제됩니다.\n삭제하시겠습니까?`,
        )
      ) {
        return;
      }

      if (
        sessionIds.length &&
        !sendUserFlowCommand("delete-sessions", { sessionIds })
      ) {
        return;
      }

      const deletedSessionIds = new Set(sessionIds);
      sessionIds.forEach((sessionId) => {
        delete userFlowTabs.sessionTabs[sessionId];
      });
      userFlowTabs.sessionOrder = userFlowTabs.sessionOrder.filter(
        (sessionId) => !deletedSessionIds.has(sessionId),
      );
      userFlowTabs.testSessionIds = userFlowTabs.testSessionIds.filter(
        (sessionId) => !deletedSessionIds.has(sessionId),
      );
      userFlowTabs.tabs = userFlowTabs.tabs.filter((item) => item.id !== tabId);

      if (userFlowTabs.activeTabId === tabId) {
        userFlowTabs.activeTabId =
          userFlowTabs.tabs[Math.min(tabIndex, userFlowTabs.tabs.length - 1)]?.id ||
          userFlowTabs.tabs[0]?.id ||
          "";
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

  function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function captureUserFlowSessionPositions() {
    return new Map(
      Array.from(
        document.querySelectorAll(
          ".user-flow-view-panel:not([hidden]) .user-flow-session-list [data-user-flow-session-id]",
        ),
      ).map((session) => [
        session.dataset.userFlowSessionId,
        session.getBoundingClientRect(),
      ]),
    );
  }

  function animateUserFlowSessionMove(previousPositions, movedSessionId) {
    if (!previousPositions?.size) {
      return;
    }

    window.requestAnimationFrame(() => {
      document
        .querySelectorAll(
          ".user-flow-view-panel:not([hidden]) .user-flow-session-list [data-user-flow-session-id]",
        )
        .forEach((session) => {
          if (typeof session.animate !== "function") {
            return;
          }

          const sessionId = session.dataset.userFlowSessionId;
          const previousRect = previousPositions.get(sessionId);

          if (previousRect) {
            const currentRect = session.getBoundingClientRect();
            const translateX = previousRect.left - currentRect.left;
            const translateY = previousRect.top - currentRect.top;

            if (Math.abs(translateX) >= 1 || Math.abs(translateY) >= 1) {
              session.animate(
                [
                  { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
                  { transform: "translate3d(0, 0, 0)" },
                ],
                {
                  duration: USER_FLOW_MOVE_ANIMATION_MS,
                  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
                },
              );
            }
          }

          if (sessionId === movedSessionId) {
            session.animate(
              [
                { boxShadow: "0 0 0 2px rgba(18, 102, 214, 0.3)" },
                { boxShadow: "0 0 0 0 rgba(18, 102, 214, 0)" },
              ],
              {
                duration: USER_FLOW_MOVE_ANIMATION_MS + 80,
                easing: "ease-out",
              },
            );
          }
        });
    });
  }

  function animateUserFlowSessionAddition(sessionId) {
    if (!sessionId) {
      return;
    }

    window.requestAnimationFrame(() => {
      const session = Array.from(
        document.querySelectorAll(
          ".user-flow-view-panel:not([hidden]) .user-flow-session-list [data-user-flow-session-id]",
        ),
      ).find((item) => item.dataset.userFlowSessionId === sessionId);

      if (typeof session?.animate !== "function") {
        return;
      }

      session.animate(
        [
          { opacity: 0, transform: "translate3d(0, -16px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: USER_FLOW_MOVE_ANIMATION_MS + 80,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        },
      );
    });
  }

  function showUserFlowMoveToast() {
    const toast = document.querySelector("#userFlowMoveToast");

    if (!toast) {
      return;
    }

    window.clearTimeout(userFlowMoveToastTimer);
    window.clearTimeout(userFlowMoveToastClearTimer);
    toast.classList.remove("is-visible");
    toast.textContent = "";
    void toast.offsetWidth;
    toast.textContent = "이동되었습니다";
    toast.classList.add("is-visible");

    userFlowMoveToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      userFlowMoveToastClearTimer = window.setTimeout(() => {
        if (!toast.classList.contains("is-visible")) {
          toast.textContent = "";
        }
      }, 160);
    }, 1200);
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
    const movedSessionId = draggedUserFlowSessionId;
    const previousPositions = captureUserFlowSessionPositions();
    let moveCompleted = false;
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
      } else {
        moveCompleted = true;
      }
    }

    resetUserFlowSessionDrag();
    rerenderUserFlowOrganization();
    animateUserFlowSessionMove(previousPositions, movedSessionId);

    if (moveCompleted) {
      showUserFlowMoveToast();
    }
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
    const movedSessionId = draggedUserFlowSessionId;
    const previousPositions = captureUserFlowSessionPositions();
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
    animateUserFlowSessionMove(previousPositions, movedSessionId);
  }

  function handleUserFlowSessionDrop(event) {
    const tab = event.target.closest("[data-user-flow-tab-drop]");

    if (!tab || !draggedUserFlowSessionId || isUserFlowOrganizationBlocked()) {
      return;
    }

    event.preventDefault();
    const movedSessionId = draggedUserFlowSessionId;
    const previousPositions = captureUserFlowSessionPositions();
    const targetTabId = tab.dataset.userFlowTabDrop;

    if (userFlowTabs.tabs.some((item) => item.id === targetTabId)) {
      const sourceTabId = getUserFlowSessionTabId(draggedUserFlowSessionId);

      if (sourceTabId === targetTabId) {
        resetUserFlowSessionDrag();
        return;
      }

      if (
        getUserFlowTabSessionCount(targetTabId) >= MAX_USER_FLOW_SESSIONS_PER_TAB
      ) {
        showUserFlowTabLimit(targetTabId);
        resetUserFlowSessionDrag();
        return;
      }

      userFlowTabs.sessionTabs[draggedUserFlowSessionId] = targetTabId;
      editingUserFlowTabId = "";

      if (!persistUserFlowTabs()) {
        userFlowTabs.sessionTabs[draggedUserFlowSessionId] = sourceTabId;
        resetUserFlowSessionDrag();
        return;
      }

      resetUserFlowSessionDrag();
      rerenderUserFlowOrganization();
      animateUserFlowSessionMove(previousPositions, movedSessionId);
      showUserFlowMoveToast();
    }
  }

  function handleUserFlowTabStorage(event) {
    if (event.key !== USER_FLOW_TAB_STORAGE_KEY) {
      return;
    }

    const nextUserFlowTabs = readUserFlowTabs();

    if (JSON.stringify(nextUserFlowTabs) === JSON.stringify(userFlowTabs)) {
      return;
    }

    userFlowTabs = nextUserFlowTabs;
    editingUserFlowTabId = "";
    editingUserFlowNotice = false;
    syncingUserFlowTabsFromStorage = true;

    try {
      rerenderUserFlowOrganization();
    } finally {
      syncingUserFlowTabsFromStorage = false;
    }
  }

  function handleUserFlowNoticeControl(event) {
    const editButton = event.target.closest("[data-user-flow-notice-edit]");
    const toggleButton = event.target.closest("[data-user-flow-notice-toggle]");

    if (toggleButton && !toggleButton.disabled) {
      const previousCollapsed = Boolean(userFlowTabs.noticeCollapsed);
      userFlowTabs.noticeCollapsed = !previousCollapsed;
      editingUserFlowNotice = false;

      if (!persistUserFlowTabs()) {
        userFlowTabs.noticeCollapsed = previousCollapsed;
      }

      renderUserFlowNotice();
      return;
    }

    if (editButton && !editButton.disabled) {
      editingUserFlowNotice = true;
      renderUserFlowNotice();
      window.requestAnimationFrame(() => {
        const input = document.querySelector("#userFlowNoticeInput");
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }

  function handleUserFlowNoticeSubmit(event) {
    const form = event.target.closest("#userFlowNoticeForm");

    if (!form) {
      return;
    }

    event.preventDefault();
    const input = form.querySelector("#userFlowNoticeInput");
    const previousNotice = userFlowTabs.notice;
    userFlowTabs.notice = normalizeUserFlowNotice(input?.value);

    if (!persistUserFlowTabs()) {
      userFlowTabs.notice = previousNotice;
      input?.focus();
      return;
    }

    editingUserFlowNotice = false;
    renderUserFlowNotice();
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

    const isProgressStatus =
      statusState === "ready" && /(?:중|중입니다)$/.test(String(message).trim());
    setUserFlowStatus(status, message, statusState, {
      animateDots: isProgressStatus,
    });
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
    const parentWindow = getActiveParentWindow();

    if (!parentWindow || event.source !== parentWindow) {
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
      stopParentReconnect();

      if (replayNavigationSessionId) {
        markReplayNavigationParentReady();
      }

      const nextUserFlowState = event.data.state || {};
      updateUserFlowTestReplayState(
        currentUserFlowState,
        nextUserFlowState,
      );
      renderUserFlowState(nextUserFlowState);
    }
  }

  function handlePopupTabChange(event) {
    if (event.detail?.tabName === "user-flow") {
      sendUserFlowCommand("get-state");
    }
  }

  function markReplayNavigationParentReady() {
    if (replayNavigationSessionId) {
      window.clearTimeout(replayNavigationTimer);
      replayNavigationParentReady = true;
      window.clearTimeout(replayNavigationIdleTimer);
      replayNavigationIdleTimer = 0;
      replayNavigationTimer = 0;
    }
  }

  function handleParentReady() {
    const popupCoreParentWindow = window.PopupCore?.getParentWindow?.();

    if (isParentWindowOpen(popupCoreParentWindow)) {
      activeParentWindow = popupCoreParentWindow;
    } else if (isParentWindowOpen(window.opener)) {
      activeParentWindow = window.opener;
    }

    markReplayNavigationParentReady();
    sendUserFlowCommand("get-state");
  }

  function monitorParentConnection() {
    if (!activeParentWindow || isParentWindowOpen(activeParentWindow)) {
      return;
    }

    activeParentWindow = null;
    stopParentReconnect();
    clearReplayNavigationState({ rerender: false });

    if (userFlowTestReplayCurrentSessionId) {
      cancelUserFlowTestReplay({ rerender: false });
      rerenderUserFlowTestReplay();
    }

    if (currentUserFlowState.isRecording || currentUserFlowState.isReplaying) {
      renderUserFlowState({
        ...currentUserFlowState,
        isRecording: false,
        isReplaying: false,
        activeRecordingSessionId: "",
        replaySessionId: "",
        replayCompletedEventCount: 0,
        replayRemainingMs: 0,
        isWaitingForRequests: false,
        pendingRequestCount: 0,
        blockingRequestCount: 0,
      });
    }
  }

  if (!window.UserFlowImport) {
    throw new Error("사용자 플로우 가져오기 모듈을 불러오지 못했습니다.");
  }

  userFlowImportController = window.UserFlowImport.createController({
    getState: () => currentUserFlowState,
    getTabs: () => userFlowTabs,
    setTabs: (tabs) => {
      userFlowTabs = tabs;
    },
    getTabCounts: getUserFlowTabCounts,
    getTabSessionCount: getUserFlowTabSessionCount,
    persistTabs: persistUserFlowTabs,
    rerender: rerenderUserFlowOrganization,
    sendCommand: sendUserFlowCommand,
    showStatus: showUserFlowImportStatus,
    showTabLimit: showUserFlowTabLimit,
    limits: {
      maxSessions: MAX_USER_FLOW_SESSIONS,
      maxSessionsPerTab: MAX_USER_FLOW_SESSIONS_PER_TAB,
      maxTabs: MAX_USER_FLOW_TABS,
    },
  });
  userFlowImportController.attach();

  document.addEventListener("click", handleUserFlowControl);
  document.addEventListener("click", handleUserFlowViewControl);
  document.addEventListener("click", handleUserFlowTestSessionRemove);
  document.addEventListener("click", handleUserFlowTabControl);
  document.addEventListener("click", handleUserFlowNoticeControl);
  document.addEventListener("click", handleUserFlowNameControl);
  document.addEventListener("focusout", handleUserFlowTabNameFocusOut);
  document.addEventListener("keydown", handleUserFlowTabNameKeydown);
  document.addEventListener("keydown", handleUserFlowNameKeydown);
  document.addEventListener("submit", handleUserFlowNoticeSubmit);
  document.addEventListener("submit", handleUserFlowNameSubmit);
  document.addEventListener("dragstart", handleUserFlowSessionDragStart);
  document.addEventListener("dragover", handleUserFlowTestDragOver);
  document.addEventListener("dragover", handleUserFlowTabDragOver);
  document.addEventListener("dragover", handleUserFlowSessionOrderDragOver);
  document.addEventListener("dragend", resetUserFlowSessionDrag);
  document.addEventListener("drop", handleUserFlowTestDrop);
  document.addEventListener("drop", handleUserFlowSessionDrop);
  document.addEventListener("drop", handleUserFlowSessionOrderDrop);
  document.addEventListener(POPUP_TAB_CHANGE_EVENT, handlePopupTabChange);
  document.addEventListener(PARENT_READY_EVENT, handleParentReady);
  window.addEventListener("message", handleUserFlowStateMessage);
  window.addEventListener("storage", handleUserFlowTabStorage);
  parentConnectionCheckTimer = window.setInterval(
    monitorParentConnection,
    PARENT_CONNECTION_CHECK_MS,
  );
  window.addEventListener(
    "pagehide",
    () => {
      window.clearInterval(parentConnectionCheckTimer);
      clearUserFlowTestReplayTimers();
      stopUserFlowStatusDots();
      stopParentReconnect();
    },
    { once: true },
  );

  const initialUserFlowStatus = document.querySelector("#userFlowStatus");

  if (initialUserFlowStatus) {
    setUserFlowStatus(initialUserFlowStatus, "연결 대기", "idle");
  }

  renderUserFlowTabs([]);
  sendUserFlowCommand("get-state");

  window.UserFlowPopup = Object.freeze({
    importFile: userFlowImportController.importFile,
    importUrl: userFlowImportController.importUrl,
    renderState: renderUserFlowState,
    requestState: () => sendUserFlowCommand("get-state"),
  });
})();
