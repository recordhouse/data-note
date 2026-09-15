(() => {
  "use strict";

  if (
    window.PopupCore?.context === "popup" ||
    document.querySelector("#userFlowPanel") ||
    window.UserFlowRecorder
  ) {
    return;
  }

  const STORAGE_KEY = "response-mapping-user-flow-recording:v1";
  const MESSAGE_COMMAND = "response-mapping-user-flow-command";
  const MESSAGE_STATE = "response-mapping-user-flow-state";
  const IGNORE_ATTRIBUTE = "data-user-flow-ignore";
  const MAX_EVENTS = 10000;
  const MAX_SESSIONS = 150;
  const MAX_SESSION_NAME_LENGTH = 40;
  // 목록 제목의 [값]을 읽을 URL 파라미터 키입니다. 예: ?title=Hello
  const USER_FLOW_TITLE_QUERY_PARAM_KEY = "state";
  const MAX_SESSION_TITLE_PREFIX_LENGTH = 80;
  const STATE_NOTIFY_MS = 120;
  const REPLAY_PROGRESS_NOTIFY_MS = 250;
  const REQUEST_WAIT_TIMEOUT_MS = 30000;
  const REQUEST_ABORT_POLL_MS = 50;
  const REQUEST_REPEAT_RESUME_LIMIT = 5;
  const RECORDING_FORMAT_VERSION = 4;
  const ARCHIVE_MANIFEST_FILE_NAME = "user-flow-manifest.json";
  const MAX_NOTICE_LENGTH = 1000;
  const IMPORTABLE_EVENT_TYPES = new Set(["change", "click", "input", "scroll"]);
  const state = {
    events: [],
    sessions: [],
    currentSessionId: "",
    isRecording: false,
    isReplaying: false,
    replaySessionId: "",
    recordedAt: null,
    startAt: 0,
    replayAbort: false,
    replayRunId: 0,
    replayStartedAt: 0,
    replayPausedMs: 0,
    replayRequestWaitStartedAt: 0,
    replayCompletedEventCount: 0,
    resumableRecordingSessionId: "",
    resumableRecordingElapsedMs: 0,
    stoppedRecordingSourceSessionId: "",
    stoppedRecordingBackupSessionId: "",
    responseError: "",
    replayProgressTimer: 0,
    lastError: "",
    clients: new Map(),
    notifyTimer: 0,
    pendingRequests: new Map(),
    requestWaiters: new Set(),
    replayRequestRepeatCounts: new Map(),
    ignoredReplayRequests: new Set(),
  };
  const dirtySessionIds = new Set();
  const deletedSessionIds = new Set();
  let pendingRecordingSync = false;
  const recorderVisuals = window.UserFlowRecorderVisuals?.create({
    ignoreAttribute: IGNORE_ATTRIBUTE,
    isRecording: () => state.isRecording,
    isReplaying: () => state.isReplaying,
  });
  const ensureVisualStyles = recorderVisuals?.ensureStyles || (() => {});
  const hideRuntimeStatus = recorderVisuals?.hideRuntimeStatus || (() => {});
  const hideScreenMask = recorderVisuals?.hideScreenMask || (() => {});
  const showClickPulse = recorderVisuals?.showClickPulse || (() => {});
  const showRuntimeStatus = recorderVisuals?.showRuntimeStatus || (() => {});
  const showScreenMask = recorderVisuals?.showScreenMask || (() => {});
  const recorderEvents = window.UserFlowRecorderEvents?.create({
    ignoreAttribute: IGNORE_ATTRIBUTE,
    isRecording: () => state.isRecording,
    isReplaying: () => state.isReplaying,
    recordEvent: pushEvent,
    showClickPulse,
  });

  if (!recorderEvents) {
    throw new Error("사용자 행동 녹화 모듈을 찾지 못했습니다.");
  }

  const {
    createReplayEvents,
    handleClick,
    handleFormChange,
    handleScroll,
    playEvent,
    resetScrollTracking,
    sleep,
    waitForRenderFrame,
  } = recorderEvents;

  function getCurrentPage() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function normalizeSessionTitlePrefix(value) {
    return String(value || "").trim().slice(0, MAX_SESSION_TITLE_PREFIX_LENGTH);
  }

  function getCurrentSessionTitlePrefix() {
    const parameterKey = String(USER_FLOW_TITLE_QUERY_PARAM_KEY || "").trim();

    if (!parameterKey) {
      return "";
    }

    try {
      return normalizeSessionTitlePrefix(
        new URL(window.location.href).searchParams.get(parameterKey),
      );
    } catch (error) {
      return "";
    }
  }

  function normalizeReplayPage(page) {
    if (typeof page !== "string" || !page.trim()) {
      return "";
    }

    try {
      const pageUrl = new URL(page.trim(), window.location.href);

      if (pageUrl.origin !== window.location.origin) {
        return "";
      }

      return `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`;
    } catch (error) {
      return "";
    }
  }

  function getReplayStartPage(session) {
    for (const recordedEvent of session?.events || []) {
      const page = normalizeReplayPage(recordedEvent?.page);

      if (page) {
        return page;
      }
    }

    return "";
  }

  function navigateToReplayStart(session) {
    const targetPage = getReplayStartPage(session);

    if (!targetPage || targetPage === getCurrentPage()) {
      return false;
    }

    try {
      window.ResponseMappingPopup?.preserveForNavigation?.();
      window.location.assign(targetPage);
    } catch (error) {
      window.ResponseMappingPopup?.preserveForNavigation?.(false);
      state.lastError = "녹화를 시작한 페이지로 이동하지 못했습니다.";
      notifyClients({ immediate: true });
    }

    return true;
  }

  function normalizeStoredRecordingSessions(recording) {
    if (Array.isArray(recording?.sessions)) {
      return recording.sessions
        .filter((session) => session && Array.isArray(session.events))
        .map((session, index) => ({
          id: session.id || `recording-${session.recordedAt || Date.now()}-${index}`,
          name: typeof session.name === "string" ? session.name : "",
          titlePrefix: normalizeSessionTitlePrefix(
            typeof session.titlePrefix === "string"
              ? session.titlePrefix
              : getCurrentSessionTitlePrefix(),
          ),
          importSourceZipName:
            typeof session.importSourceZipName === "string"
              ? session.importSourceZipName
              : "",
          recordedAt: session.recordedAt || null,
          events: session.events,
        }));
    }

    if (Array.isArray(recording?.events) && recording.events.length) {
      const recordedAt = recording.recordedAt || Date.now();
      return [
        {
          id: `recording-${recordedAt}`,
          name: "",
          titlePrefix: getCurrentSessionTitlePrefix(),
          recordedAt,
          events: recording.events,
        },
      ];
    }

    return [];
  }

  function readStoredRecordingSessions() {
    const recording = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return normalizeStoredRecordingSessions(recording);
  }

  function sortRecordingSessions(sessions) {
    return [...sessions].sort(
      (first, second) =>
        Number(second.recordedAt || 0) - Number(first.recordedAt || 0),
    );
  }

  function setRecordingSessions(sessions) {
    state.sessions = sortRecordingSessions(sessions).slice(0, MAX_SESSIONS);
    const currentSession = state.sessions.find(
      (session) => session.id === state.currentSessionId,
    );
    const selectedSession = currentSession || state.sessions[0] || null;

    state.currentSessionId = selectedSession?.id || "";
    state.events = selectedSession?.events || [];
    state.recordedAt = selectedSession?.recordedAt || null;
    reconcileResumableRecordingState();
  }

  function reconcileResumableRecordingState() {
    const sessionIds = new Set(state.sessions.map((session) => session.id));

    if (
      state.resumableRecordingSessionId &&
      !sessionIds.has(state.resumableRecordingSessionId)
    ) {
      state.resumableRecordingSessionId = "";
      state.resumableRecordingElapsedMs = 0;
    } else if (!state.resumableRecordingSessionId) {
      state.resumableRecordingElapsedMs = 0;
    }

    if (
      (state.stoppedRecordingSourceSessionId &&
        !sessionIds.has(state.stoppedRecordingSourceSessionId)) ||
      (state.stoppedRecordingBackupSessionId &&
        !sessionIds.has(state.stoppedRecordingBackupSessionId))
    ) {
      state.stoppedRecordingSourceSessionId = "";
      state.stoppedRecordingBackupSessionId = "";
    }
  }

  function mergeRecordingSessions(storedSessions) {
    const sessionsById = new Map();

    storedSessions.forEach((session) => {
      if (session?.id && !sessionsById.has(session.id)) {
        sessionsById.set(session.id, session);
      }
    });

    deletedSessionIds.forEach((sessionId) => sessionsById.delete(sessionId));
    state.sessions.forEach((session) => {
      if (session?.id && dirtySessionIds.has(session.id)) {
        sessionsById.set(session.id, session);
      }
    });

    return sortRecordingSessions(Array.from(sessionsById.values()));
  }

  function synchronizeRecordingFromStorage({ notify = true } = {}) {
    if (state.isReplaying) {
      pendingRecordingSync = true;
      return false;
    }

    try {
      const storedSessions = readStoredRecordingSessions();
      const sessions =
        dirtySessionIds.size || deletedSessionIds.size
          ? mergeRecordingSessions(storedSessions)
          : storedSessions;
      setRecordingSessions(sessions);
      pendingRecordingSync = false;

      if (notify) {
        notifyClients({ immediate: true });
      }

      return true;
    } catch (error) {
      state.lastError = "저장된 녹화 데이터를 불러오지 못했습니다.";

      if (notify) {
        notifyClients({ immediate: true });
      }

      return false;
    }
  }

  function readRecording() {
    if (synchronizeRecordingFromStorage({ notify: false })) {
      dirtySessionIds.clear();
      deletedSessionIds.clear();
    }
  }

  function persistRecording() {
    try {
      const mergedSessions = mergeRecordingSessions(readStoredRecordingSessions());

      if (mergedSessions.length > MAX_SESSIONS) {
        state.lastError = `녹화는 최대 ${MAX_SESSIONS.toLocaleString("ko-KR")}개까지 저장할 수 있습니다. 기존 녹화를 삭제하거나 내보내 주세요.`;
        return false;
      }

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: RECORDING_FORMAT_VERSION,
          sessions: mergedSessions,
        }),
      );
      setRecordingSessions(mergedSessions);
      dirtySessionIds.clear();
      deletedSessionIds.clear();

      if (state.isRecording && state.currentSessionId) {
        dirtySessionIds.add(state.currentSessionId);
      }

      pendingRecordingSync = false;
      state.lastError = "";
      return true;
    } catch (error) {
      state.lastError = "녹화 데이터를 로컬 스토리지에 저장하지 못했습니다.";
      return false;
    }
  }

  function getDurationMs(events = state.events) {
    return events.length ? events[events.length - 1].at : 0;
  }

  function getPublicState() {
    const replayDurationMs = getDurationMs();
    const currentRequestWaitMs =
      state.isReplaying && state.replayRequestWaitStartedAt
        ? Math.max(0, performance.now() - state.replayRequestWaitStartedAt)
        : 0;
    const replayElapsedMs = state.isReplaying
      ? Math.max(
          0,
          performance.now() -
            state.replayStartedAt -
            state.replayPausedMs -
            currentRequestWaitMs,
        )
      : 0;

    return {
      isRecording: state.isRecording,
      isReplaying: state.isReplaying,
      canReplay: state.sessions.some((session) => session.events.length > 0),
      activeRecordingSessionId: state.isRecording ? state.currentSessionId : "",
      replaySessionId: state.replaySessionId,
      replayCompletedEventCount: state.replayCompletedEventCount,
      resumeRecordingSessionId:
        !state.isRecording && !state.isReplaying
          ? state.resumableRecordingSessionId
          : "",
      resumeRecordingEventCount:
        state.sessions.find(
          (session) => session.id === state.resumableRecordingSessionId,
        )?.events.length || 0,
      stoppedRecordingSourceSessionId: state.stoppedRecordingSourceSessionId,
      stoppedRecordingBackupSessionId: state.stoppedRecordingBackupSessionId,
      responseError: state.responseError,
      pendingRequestCount: getPendingRequestCount(),
      blockingRequestCount: getBlockingRequestCount(),
      isWaitingForRequests: Boolean(
        state.isReplaying && state.replayRequestWaitStartedAt,
      ),
      replayRemainingMs: state.isReplaying
        ? Math.max(0, replayDurationMs - replayElapsedMs)
        : 0,
      eventCount: state.events.length,
      durationMs: getDurationMs(),
      recordedAt: state.recordedAt,
      sessions: state.sessions.map((session) => ({
        startPage: getReplayStartPage(session),
        id: session.id,
        name: session.name || "",
        titlePrefix: session.titlePrefix || "",
        importSourceZipName: session.importSourceZipName || "",
        recordedAt: session.recordedAt,
        eventCount: session.events.length,
        durationMs: getDurationMs(session.events),
      })),
      error: state.lastError,
    };
  }

  function sendState(targetWindow, targetOrigin) {
    if (!targetWindow || targetWindow.closed) {
      return false;
    }

    try {
      targetWindow.postMessage(
        {
          type: MESSAGE_STATE,
          state: getPublicState(),
        },
        targetOrigin,
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function notifyClients({ immediate = false } = {}) {
    if (!immediate) {
      if (state.notifyTimer) {
        return;
      }

      state.notifyTimer = window.setTimeout(() => {
        state.notifyTimer = 0;
        notifyClients({ immediate: true });
      }, STATE_NOTIFY_MS);
      return;
    }

    window.clearTimeout(state.notifyTimer);
    state.notifyTimer = 0;

    state.clients.forEach((origin, client) => {
      if (!sendState(client, origin)) {
        state.clients.delete(client);
      }
    });
  }

  function startReplayProgressNotifications() {
    window.clearInterval(state.replayProgressTimer);
    state.replayProgressTimer = window.setInterval(() => {
      if (!state.isReplaying) {
        window.clearInterval(state.replayProgressTimer);
        state.replayProgressTimer = 0;
        return;
      }

      notifyClients({ immediate: true });
    }, REPLAY_PROGRESS_NOTIFY_MS);
  }

  function stopReplayProgressNotifications() {
    window.clearInterval(state.replayProgressTimer);
    state.replayProgressTimer = 0;
  }

  function isAllowedMessage(event) {
    if (!event.source || typeof event.source.postMessage !== "function") {
      return false;
    }

    if (window.location.origin === "null") {
      return event.origin === "null";
    }

    return event.origin === window.location.origin;
  }



  function pushEvent(recordedEvent, { persist = true } = {}) {
    if (!state.isRecording || state.isReplaying) {
      return;
    }

    if (state.events.length >= MAX_EVENTS) {
      stopRecording();
      state.lastError = `최대 ${MAX_EVENTS.toLocaleString("ko-KR")}개의 행동까지 저장할 수 있습니다.`;
      notifyClients({ immediate: true });
      return;
    }

    state.events.push({
      at: Math.max(0, Math.round(performance.now() - state.startAt)),
      page: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      ...recordedEvent,
    });
    dirtySessionIds.add(state.currentSessionId);

    if (persist) {
      persistRecording();
    }

    notifyClients();
  }


  function getPendingRequestCount() {
    let requestCount = 0;

    state.pendingRequests.forEach((count) => {
      requestCount += count;
    });

    return requestCount;
  }

  function getBlockingRequestCount() {
    let requestCount = 0;

    state.pendingRequests.forEach((count, requestId) => {
      if (!state.ignoredReplayRequests.has(requestId)) {
        requestCount += count;
      }
    });

    return requestCount;
  }

  function hasBlockingRequests() {
    return getBlockingRequestCount() > 0;
  }

  function clearReplayRequestTracking() {
    state.replayRequestRepeatCounts.clear();
    state.ignoredReplayRequests.clear();
  }

  function initializeReplayRequestTracking() {
    clearReplayRequestTracking();

    state.pendingRequests.forEach((count, requestId) => {
      state.replayRequestRepeatCounts.set(requestId, count);

      if (count >= REQUEST_REPEAT_RESUME_LIMIT) {
        state.ignoredReplayRequests.add(requestId);
      }
    });
  }

  function normalizeRequestId(requestId) {
    const normalizedId = String(requestId || "").trim().slice(0, 160);
    return normalizedId || `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function settleRequestWaiters(completed) {
    Array.from(state.requestWaiters).forEach((finish) => finish(completed));
  }

  function requestStart(requestId) {
    const normalizedId = normalizeRequestId(requestId);
    const requestCount = state.pendingRequests.get(normalizedId) || 0;
    let reachedRepeatLimit = false;

    state.pendingRequests.set(normalizedId, requestCount + 1);

    if (state.isReplaying) {
      const repeatCount =
        (state.replayRequestRepeatCounts.get(normalizedId) || 0) + 1;
      state.replayRequestRepeatCounts.set(normalizedId, repeatCount);

      if (
        repeatCount >= REQUEST_REPEAT_RESUME_LIMIT &&
        !state.ignoredReplayRequests.has(normalizedId)
      ) {
        state.ignoredReplayRequests.add(normalizedId);
        reachedRepeatLimit = true;
        console.info(
          `UserFlowRecorder: ${normalizedId} 통신이 ${REQUEST_REPEAT_RESUME_LIMIT}회 반복되어 재생 대기에서 제외합니다.`,
        );
      }
    }

    if (!hasBlockingRequests()) {
      settleRequestWaiters(true);
    }

    notifyClients({ immediate: reachedRepeatLimit });
    return normalizedId;
  }

  function getResponseErrorMessage(responseInfo) {
    if (!responseInfo || typeof responseInfo !== "object") {
      return "";
    }

    const status = Number(responseInfo.status);
    const hasStatus = Number.isFinite(status) && status > 0;
    const isSuccessful =
      typeof responseInfo.ok === "boolean"
        ? responseInfo.ok
        : !hasStatus || (status >= 200 && status < 300);

    if (isSuccessful) {
      return "";
    }

    const statusText = String(responseInfo.statusText || "").trim().slice(0, 100);
    const detail = String(responseInfo.message || "").trim().slice(0, 240);
    const statusLabel = hasStatus
      ? `${Math.round(status)}${statusText ? ` ${statusText}` : ""}`
      : "네트워크 오류";

    return `응답 오류: ${statusLabel}${detail ? ` - ${detail}` : ""}`;
  }

  function requestEnd(requestId, responseInfo) {
    const normalizedId = String(requestId || "").trim().slice(0, 160);
    const requestCount = state.pendingRequests.get(normalizedId) || 0;

    if (!normalizedId || !requestCount) {
      return false;
    }

    if (requestCount > 1) {
      state.pendingRequests.set(normalizedId, requestCount - 1);
    } else {
      state.pendingRequests.delete(normalizedId);
    }

    const responseError = getResponseErrorMessage(responseInfo);

    if (state.isReplaying && responseError) {
      state.responseError = responseError;
    }

    if (!hasBlockingRequests()) {
      settleRequestWaiters(true);
    }

    notifyClients({ immediate: Boolean(responseError) });
    return true;
  }

  function resetPendingRequests() {
    if (
      !state.pendingRequests.size &&
      !state.replayRequestRepeatCounts.size &&
      !state.ignoredReplayRequests.size
    ) {
      return false;
    }

    state.pendingRequests.clear();
    clearReplayRequestTracking();
    settleRequestWaiters(false);
    notifyClients();
    return true;
  }

  function installAutomaticRequestTracking() {
    const tracker = window.UserFlowRequestTracker?.create({
      requestEnd,
      requestStart,
    });

    if (!tracker) {
      console.warn("UserFlowRecorder: 통신 감지 모듈을 찾지 못했습니다.");
      return;
    }

    tracker.install();
  }

  function waitForRequests(options = {}) {
    if (!hasBlockingRequests()) {
      return Promise.resolve(true);
    }

    const requestedTimeout =
      typeof options === "number" ? options : options?.timeoutMs;
    const parsedTimeout = Number(requestedTimeout);
    const timeoutMs = Number.isFinite(parsedTimeout)
      ? Math.max(0, parsedTimeout)
      : REQUEST_WAIT_TIMEOUT_MS;
    const shouldAbort =
      typeof options?.shouldAbort === "function" ? options.shouldAbort : null;

    return new Promise((resolve) => {
      let completed = false;
      let timeoutTimer = 0;
      let abortTimer = 0;

      function finish(requestsCompleted) {
        if (completed) {
          return;
        }

        completed = true;
        state.requestWaiters.delete(finish);
        window.clearTimeout(timeoutTimer);
        window.clearInterval(abortTimer);
        resolve(requestsCompleted);
      }

      state.requestWaiters.add(finish);
      timeoutTimer = window.setTimeout(() => finish(false), timeoutMs);

      if (shouldAbort) {
        abortTimer = window.setInterval(() => {
          if (shouldAbort()) {
            finish(false);
          }
        }, REQUEST_ABORT_POLL_MS);
      }

      if (!hasBlockingRequests()) {
        finish(true);
      } else if (shouldAbort?.()) {
        finish(false);
      }
    });
  }


  async function waitForReplayRequests(replayRunId) {
    if (!hasBlockingRequests()) {
      return true;
    }

    const waitStartedAt = performance.now();
    state.replayRequestWaitStartedAt = waitStartedAt;
    notifyClients({ immediate: true });

    const requestsCompleted = await waitForRequests({
      timeoutMs: REQUEST_WAIT_TIMEOUT_MS,
      shouldAbort: () => state.replayAbort || state.replayRunId !== replayRunId,
    });
    const replayIsActive = !state.replayAbort && state.replayRunId === replayRunId;

    if (!replayIsActive) {
      return false;
    }

    if (!requestsCompleted && hasBlockingRequests()) {
      console.warn(
        `UserFlowRecorder: 통신 대기 시간이 ${REQUEST_WAIT_TIMEOUT_MS / 1000}초를 초과해 다음 행동을 계속합니다.`,
      );
      resetPendingRequests();
    }

    await waitForRenderFrame();

    if (state.replayRunId !== replayRunId) {
      return false;
    }

    state.replayPausedMs += Math.max(0, performance.now() - waitStartedAt);
    state.replayRequestWaitStartedAt = 0;
    notifyClients({ immediate: true });
    return true;
  }


  function createUniqueSessionId(recordedAt = Date.now(), reservedIds) {
    const ids =
      reservedIds || new Set(state.sessions.map((session) => String(session.id || "")));
    let sessionId = "";

    do {
      sessionId = `recording-${recordedAt}-${Math.random().toString(36).slice(2, 8)}`;
    } while (ids.has(sessionId));

    ids.add(sessionId);
    return sessionId;
  }

  function normalizeImportedEvents(events) {
    if (!Array.isArray(events)) {
      return null;
    }

    return events
      .slice(0, MAX_EVENTS)
      .filter(
        (recordedEvent) =>
          recordedEvent &&
          typeof recordedEvent === "object" &&
          IMPORTABLE_EVENT_TYPES.has(recordedEvent.type) &&
          Number.isFinite(Number(recordedEvent.at)),
      )
      .map((recordedEvent) => ({
        ...recordedEvent,
        at: Math.max(0, Math.round(Number(recordedEvent.at))),
      }))
      .sort((first, second) => first.at - second.at);
  }

  function normalizeImportedSessions(
    importData,
    { skipZipNameDuplicateCheck = false } = {},
  ) {
    const candidates = Array.isArray(importData?.sessions)
      ? importData.sessions
      : importData?.session
        ? [importData.session]
        : Array.isArray(importData?.events)
          ? [importData]
          : [];
    const reservedIds = new Set(state.sessions.map((session) => String(session.id || "")));
    const importedZipNames = new Set(
      state.sessions
        .map((session) =>
          String(session.importSourceZipName || "").trim().toLowerCase(),
        )
        .filter(Boolean),
    );
    const importedSessions = [];

    for (const candidate of candidates.slice(0, MAX_SESSIONS)) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const events = normalizeImportedEvents(candidate.events);

      if (!events) {
        continue;
      }

      const recordedAtValue = Number(candidate.recordedAt);
      const recordedAt =
        Number.isFinite(recordedAtValue) && recordedAtValue > 0
          ? Math.round(recordedAtValue)
          : Date.now();
      const importedId =
        typeof candidate.id === "string" ? candidate.id.trim().slice(0, 160) : "";
      const importSourceZipName =
        typeof candidate.importSourceZipName === "string"
          ? candidate.importSourceZipName.trim().slice(0, 255)
          : "";

      if (
        (importedId && reservedIds.has(importedId)) ||
        (!skipZipNameDuplicateCheck &&
          importSourceZipName &&
          importedZipNames.has(importSourceZipName.toLowerCase()))
      ) {
        continue;
      }

      const sessionId = importedId || createUniqueSessionId(recordedAt, reservedIds);
      reservedIds.add(sessionId);
      importedSessions.push({
        id: sessionId,
        name: String(candidate.name || "").trim().slice(0, MAX_SESSION_NAME_LENGTH),
        titlePrefix: normalizeSessionTitlePrefix(
          typeof candidate.titlePrefix === "string"
            ? candidate.titlePrefix
            : getCurrentSessionTitlePrefix(),
        ),
        importSourceZipName,
        recordedAt,
        events,
      });
    }

    return importedSessions;
  }

  function importRecordings(importData, options = {}) {
    if (state.isRecording || state.isReplaying) {
      state.lastError = "녹화 또는 재생 중에는 가져올 수 없습니다.";
      notifyClients({ immediate: true });
      return false;
    }

    if (!synchronizeRecordingFromStorage({ notify: false })) {
      notifyClients({ immediate: true });
      return false;
    }

    const importedSessions = normalizeImportedSessions(importData, options);

    if (!importedSessions.length) {
      state.lastError = "가져올 새 녹화가 없거나 이미 존재하는 녹화입니다.";
      notifyClients({ immediate: true });
      return false;
    }

    if (state.sessions.length + importedSessions.length > MAX_SESSIONS) {
      state.lastError = `녹화는 최대 ${MAX_SESSIONS.toLocaleString("ko-KR")}개까지 저장할 수 있습니다. 기존 녹화를 삭제하거나 내보내 주세요.`;
      notifyClients({ immediate: true });
      return false;
    }

    const previousState = {
      currentSessionId: state.currentSessionId,
      events: state.events,
      recordedAt: state.recordedAt,
      sessions: state.sessions,
      resumableRecordingSessionId: state.resumableRecordingSessionId,
      resumableRecordingElapsedMs: state.resumableRecordingElapsedMs,
      stoppedRecordingSourceSessionId: state.stoppedRecordingSourceSessionId,
      stoppedRecordingBackupSessionId: state.stoppedRecordingBackupSessionId,
    };
    const previousDirtySessionIds = new Set(dirtySessionIds);
    const previousDeletedSessionIds = new Set(deletedSessionIds);

    state.sessions = [...importedSessions, ...state.sessions];
    state.currentSessionId = importedSessions[0].id;
    state.events = importedSessions[0].events;
    state.recordedAt = importedSessions[0].recordedAt;
    state.resumableRecordingSessionId = "";
    state.resumableRecordingElapsedMs = 0;
    state.stoppedRecordingSourceSessionId = "";
    state.stoppedRecordingBackupSessionId = "";
    importedSessions.forEach((session) => dirtySessionIds.add(session.id));

    if (!persistRecording()) {
      state.sessions = previousState.sessions;
      state.currentSessionId = previousState.currentSessionId;
      state.events = previousState.events;
      state.recordedAt = previousState.recordedAt;
      state.resumableRecordingSessionId =
        previousState.resumableRecordingSessionId;
      state.resumableRecordingElapsedMs =
        previousState.resumableRecordingElapsedMs;
      state.stoppedRecordingSourceSessionId =
        previousState.stoppedRecordingSourceSessionId;
      state.stoppedRecordingBackupSessionId =
        previousState.stoppedRecordingBackupSessionId;
      dirtySessionIds.clear();
      previousDirtySessionIds.forEach((sessionId) => dirtySessionIds.add(sessionId));
      deletedSessionIds.clear();
      previousDeletedSessionIds.forEach((sessionId) =>
        deletedSessionIds.add(sessionId),
      );
      notifyClients({ immediate: true });
      return false;
    }

    notifyClients({ immediate: true });
    return true;
  }

  function resumeRecording() {
    if (state.isRecording || state.isReplaying) {
      return false;
    }

    const sessionId = state.resumableRecordingSessionId;

    if (!synchronizeRecordingFromStorage({ notify: false })) {
      notifyClients({ immediate: true });
      return false;
    }

    const session = state.sessions.find((item) => item.id === sessionId);

    if (!sessionId || !session) {
      state.resumableRecordingSessionId = "";
      state.resumableRecordingElapsedMs = 0;
      state.lastError = "이어서 녹화할 데이터를 찾지 못했습니다.";
      notifyClients({ immediate: true });
      return false;
    }

    if (state.sessions.length >= MAX_SESSIONS) {
      state.lastError = `이어서 녹화하려면 중지 시점 복사본을 저장할 공간이 필요합니다. 기존 녹화를 삭제한 뒤 다시 시도해주세요.`;
      notifyClients({ immediate: true });
      return false;
    }

    const resumedAt = Date.now();
    session.recordedAt = resumedAt;
    session.titlePrefix = getCurrentSessionTitlePrefix();
    state.currentSessionId = session.id;
    state.events = session.events;
    state.recordedAt = resumedAt;
    state.isRecording = true;
    state.startAt =
      performance.now() -
      Math.max(
        getDurationMs(session.events),
        Number(state.resumableRecordingElapsedMs) || 0,
      );
    state.responseError = "";
    state.lastError = "";
    state.stoppedRecordingSourceSessionId = "";
    state.stoppedRecordingBackupSessionId = "";
    resetScrollTracking();
    dirtySessionIds.add(session.id);

    showScreenMask("recording");
    showRuntimeStatus("recording");
    notifyClients({ immediate: true });
    return true;
  }

  function startRecording() {
    stopReplay();

    if (!synchronizeRecordingFromStorage({ notify: false })) {
      notifyClients({ immediate: true });
      return false;
    }

    if (state.sessions.length + 2 > MAX_SESSIONS) {
      state.lastError = `새 녹화와 중지 시점 복사본을 저장할 공간이 필요합니다. 기존 녹화를 삭제하거나 내보내 주세요.`;
      notifyClients({ immediate: true });
      return false;
    }

    const recordedAt = Date.now();
    const session = {
      id: createUniqueSessionId(recordedAt),
      name: "",
      titlePrefix: getCurrentSessionTitlePrefix(),
      recordedAt,
      events: [],
    };
    const previousState = {
      currentSessionId: state.currentSessionId,
      events: state.events,
      recordedAt: state.recordedAt,
      sessions: state.sessions,
      resumableRecordingSessionId: state.resumableRecordingSessionId,
      resumableRecordingElapsedMs: state.resumableRecordingElapsedMs,
      stoppedRecordingSourceSessionId: state.stoppedRecordingSourceSessionId,
      stoppedRecordingBackupSessionId: state.stoppedRecordingBackupSessionId,
    };

    state.sessions = [session, ...state.sessions];
    state.currentSessionId = session.id;
    state.events = session.events;
    state.isRecording = true;
    state.recordedAt = recordedAt;
    state.startAt = performance.now();
    state.responseError = "";
    state.lastError = "";
    state.resumableRecordingSessionId = session.id;
    state.resumableRecordingElapsedMs = 0;
    state.stoppedRecordingSourceSessionId = "";
    state.stoppedRecordingBackupSessionId = "";
    resetScrollTracking();
    dirtySessionIds.add(session.id);

    if (!persistRecording()) {
      dirtySessionIds.delete(session.id);
      state.sessions = previousState.sessions;
      state.currentSessionId = previousState.currentSessionId;
      state.events = previousState.events;
      state.recordedAt = previousState.recordedAt;
      state.resumableRecordingSessionId =
        previousState.resumableRecordingSessionId;
      state.resumableRecordingElapsedMs =
        previousState.resumableRecordingElapsedMs;
      state.stoppedRecordingSourceSessionId =
        previousState.stoppedRecordingSourceSessionId;
      state.stoppedRecordingBackupSessionId =
        previousState.stoppedRecordingBackupSessionId;
      state.isRecording = false;
      notifyClients({ immediate: true });
      return false;
    }

    showScreenMask("recording");
    showRuntimeStatus("recording");
    notifyClients({ immediate: true });
    return true;
  }

  function stopRecording() {
    if (!state.isRecording) {
      return;
    }

    const sourceSession = state.sessions.find(
      (session) => session.id === state.currentSessionId,
    );
    const previousSessions = state.sessions;
    const previousStoppedSourceSessionId =
      state.stoppedRecordingSourceSessionId;
    const previousStoppedBackupSessionId =
      state.stoppedRecordingBackupSessionId;
    const previousDirtySessionIds = new Set(dirtySessionIds);
    const previousSourceTitlePrefix = sourceSession?.titlePrefix || "";
    const stoppedAt = Date.now();
    const stoppedTitlePrefix = getCurrentSessionTitlePrefix();

    if (sourceSession) {
      sourceSession.titlePrefix = stoppedTitlePrefix;
      dirtySessionIds.add(sourceSession.id);
    }

    const stoppedRecordingElapsedMs = sourceSession
      ? Math.max(
          getDurationMs(sourceSession.events),
          Math.max(0, Math.round(performance.now() - state.startAt)),
        )
      : 0;
    const backupSession =
      sourceSession && state.sessions.length < MAX_SESSIONS
        ? {
            ...sourceSession,
            id: createUniqueSessionId(stoppedAt),
            importSourceZipName: "",
            recordedAt: stoppedAt,
            events: JSON.parse(JSON.stringify(sourceSession.events)),
          }
        : null;

    state.isRecording = false;
    state.resumableRecordingSessionId = sourceSession?.id || "";
    state.resumableRecordingElapsedMs = stoppedRecordingElapsedMs;
    state.stoppedRecordingSourceSessionId = sourceSession?.id || "";
    state.stoppedRecordingBackupSessionId = backupSession?.id || "";

    if (backupSession) {
      state.sessions = [...state.sessions, backupSession];
      dirtySessionIds.add(backupSession.id);
    }

    hideScreenMask();
    showRuntimeStatus("recording", "stopped");
    resetScrollTracking({ preserveLastSample: true });

    if (!persistRecording()) {
      if (sourceSession) {
        sourceSession.titlePrefix = previousSourceTitlePrefix;
      }

      state.sessions = previousSessions;
      state.stoppedRecordingSourceSessionId = previousStoppedSourceSessionId;
      state.stoppedRecordingBackupSessionId = previousStoppedBackupSessionId;
      dirtySessionIds.clear();
      previousDirtySessionIds.forEach((sessionId) =>
        dirtySessionIds.add(sessionId),
      );
      setRecordingSessions(state.sessions);
    } else if (sourceSession && !backupSession) {
      state.lastError = `중지 시점 복사본은 최대 ${MAX_SESSIONS.toLocaleString("ko-KR")}개 제한으로 저장하지 못했습니다.`;
    }

    notifyClients({ immediate: true });
  }

  function stopReplay() {
    if (!state.isReplaying) {
      return;
    }

    state.replayAbort = true;
    state.replayRunId += 1;
    state.isReplaying = false;
    state.replaySessionId = "";
    state.replayStartedAt = 0;
    state.replayPausedMs = 0;
    state.replayRequestWaitStartedAt = 0;
    state.replayCompletedEventCount = 0;
    state.lastError = "";
    clearReplayRequestTracking();
    stopReplayProgressNotifications();
    showRuntimeStatus("replaying", "stopped");
    hideScreenMask();

    if (pendingRecordingSync) {
      synchronizeRecordingFromStorage({ notify: false });
    }

    notifyClients({ immediate: true });
  }

  async function replay(sessionId = state.currentSessionId || state.sessions[0]?.id) {
    const session = state.sessions.find((item) => item.id === sessionId);

    if (!session?.events.length || state.isReplaying) {
      return;
    }

    state.responseError = "";
    state.lastError = "";
    notifyClients({ immediate: true });
    stopRecording();

    if (navigateToReplayStart(session)) {
      return;
    }

    state.currentSessionId = session.id;
    state.events = session.events;
    state.recordedAt = session.recordedAt;
    state.replayAbort = false;
    state.replayRunId += 1;
    const replayRunId = state.replayRunId;
    state.isReplaying = true;
    state.replaySessionId = session.id;
    state.replayStartedAt = performance.now();
    state.replayPausedMs = 0;
    state.replayRequestWaitStartedAt = 0;
    state.replayCompletedEventCount = 0;
    state.lastError = "";
    initializeReplayRequestTracking();
    showScreenMask("replaying");
    showRuntimeStatus("replaying");
    startReplayProgressNotifications();
    notifyClients({ immediate: true });

    try {
      window.focus();
    } catch (error) {
      // Browsers may ignore focus requests between windows.
    }

    try {
      const replayStartedAt = state.replayStartedAt;
      const replayEvents = createReplayEvents(state.events);

      if (!(await waitForReplayRequests(replayRunId))) {
        return;
      }

      for (const recordedEvent of replayEvents) {
        if (state.replayAbort || state.replayRunId !== replayRunId) {
          break;
        }

        const waitMs =
          recordedEvent.at -
          (performance.now() - replayStartedAt - state.replayPausedMs);

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        if (state.replayAbort || state.replayRunId !== replayRunId) {
          break;
        }

        if (!(await waitForReplayRequests(replayRunId))) {
          break;
        }

        await playEvent(recordedEvent);

        if (state.replayRunId !== replayRunId) {
          break;
        }

        state.replayCompletedEventCount += recordedEvent.replaySourceEventCount || 1;
        notifyClients();
        await sleep(0);
      }

      if (!state.replayAbort && state.replayRunId === replayRunId) {
        await waitForReplayRequests(replayRunId);
      }
    } finally {
      if (state.replayRunId === replayRunId) {
        state.isReplaying = false;
        state.replayAbort = false;
        state.replaySessionId = "";
        state.replayStartedAt = 0;
        state.replayPausedMs = 0;
        state.replayRequestWaitStartedAt = 0;
        state.replayCompletedEventCount = 0;
        clearReplayRequestTracking();
        stopReplayProgressNotifications();
        showRuntimeStatus("replaying", "completed");
        hideScreenMask();

        if (pendingRecordingSync) {
          synchronizeRecordingFromStorage({ notify: false });
        }

        notifyClients({ immediate: true });
      }
    }
  }

  function clearRecording() {
    stopRecording();
    stopReplay();
    state.events = [];
    state.sessions = [];
    state.currentSessionId = "";
    state.recordedAt = null;
    state.responseError = "";
    state.lastError = "";
    state.resumableRecordingSessionId = "";
    state.resumableRecordingElapsedMs = 0;
    state.stoppedRecordingSourceSessionId = "";
    state.stoppedRecordingBackupSessionId = "";
    dirtySessionIds.clear();
    deletedSessionIds.clear();
    pendingRecordingSync = false;
    hideRuntimeStatus();
    window.localStorage.removeItem(STORAGE_KEY);
    notifyClients({ immediate: true });
  }

  function getExportFileTimestamp(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((value) => String(value).padStart(2, "0"))
      .join("");
    const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((value) => String(value).padStart(2, "0"))
      .join("");

    return `${datePart}-${timePart}`;
  }

  function downloadUserFlowFile(blob, fileName) {
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = fileName;
    link.hidden = true;
    link.setAttribute(IGNORE_ATTRIBUTE, "true");
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  }

  function sanitizeArchiveName(value, fallback) {
    const sanitized = String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 80);
    return sanitized || fallback;
  }

  function createUniqueArchiveName(preferredName, usedNames) {
    const extensionIndex = preferredName.toLowerCase().endsWith(".json")
      ? preferredName.length - 5
      : preferredName.length;
    const baseName = preferredName.slice(0, extensionIndex);
    const extension = preferredName.slice(extensionIndex);
    let uniqueName = preferredName;
    let suffix = 2;

    while (usedNames.has(uniqueName.toLowerCase())) {
      uniqueName = `${baseName} (${suffix})${extension}`;
      suffix += 1;
    }

    usedNames.add(uniqueName.toLowerCase());
    return uniqueName;
  }

  function normalizeExportTabs(tabOrganization) {
    const requestedTabs = Array.isArray(tabOrganization?.tabs)
      ? tabOrganization.tabs
      : [];
    const tabs = [];
    const tabIds = new Set();
    const usedFolderNames = new Set();

    requestedTabs.forEach((tab, index) => {
      const id = String(tab?.id || "").trim().slice(0, 120);

      if (!id || tabIds.has(id)) {
        return;
      }

      const requestedName = sanitizeArchiveName(
        tab?.name,
        `Tab ${String(index + 1).padStart(2, "0")}`,
      );
      const folderName = createUniqueArchiveName(requestedName, usedFolderNames);
      tabIds.add(id);
      tabs.push({ folderName, id });
    });

    if (!tabs.length) {
      tabs.push({ folderName: "Tab 01", id: "default" });
    }

    return tabs;
  }

  function exportAllRecordings(tabOrganization = {}) {
    if (state.isRecording || state.isReplaying || !state.sessions.length) {
      return false;
    }

    try {
      if (!window.UserFlowArchive) {
        throw new Error("ZIP 모듈을 불러오지 못했습니다.");
      }

      const exportedAt = Date.now();
      const tabs = normalizeExportTabs(tabOrganization);
      const notice = String(tabOrganization?.notice || "")
        .replace(/\r\n?/g, "\n")
        .trim()
        .slice(0, MAX_NOTICE_LENGTH);
      const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
      const fallbackTab = tabs[0];
      const sessionTabs =
        tabOrganization?.sessionTabs && typeof tabOrganization.sessionTabs === "object"
          ? tabOrganization.sessionTabs
          : {};
      const usedFileNames = new Map(
        tabs.map((tab) => [tab.id, new Set()]),
      );
      const entries = [
        {
          data: JSON.stringify(
            {
              exportedAt: new Date(exportedAt).toISOString(),
              notice,
              type: "response-mapping-user-flow-archive",
              version: 1,
            },
            null,
            2,
          ),
          modifiedAt: exportedAt,
          name: ARCHIVE_MANIFEST_FILE_NAME,
        },
        ...tabs.map((tab) => ({
          isDirectory: true,
          modifiedAt: exportedAt,
          name: `${tab.folderName}/`,
        })),
      ];

      state.sessions.forEach((session) => {
        const assignedTab = tabById.get(sessionTabs[session.id]) || fallbackTab;
        const usedNames = usedFileNames.get(assignedTab.id) || new Set();
        const timestamp = getExportFileTimestamp(session.recordedAt || exportedAt);
        const sessionIdSuffix = session.id
          .slice(-6)
          .replace(/[^a-zA-Z0-9_-]/g, "");
        const requestedFileName = `${sanitizeArchiveName(
          session.name,
          `user-flow-${timestamp}`,
        )}-${sessionIdSuffix || "recording"}.json`;
        const fileName = createUniqueArchiveName(requestedFileName, usedNames);
        const exportData = {
          version: RECORDING_FORMAT_VERSION,
          exportedAt: new Date(exportedAt).toISOString(),
          session: {
            id: session.id,
            name: session.name || "",
            titlePrefix: session.titlePrefix || "",
            recordedAt: session.recordedAt,
            events: session.events,
          },
        };

        usedFileNames.set(assignedTab.id, usedNames);
        entries.push({
          data: JSON.stringify(exportData, null, 2),
          modifiedAt: session.recordedAt || exportedAt,
          name: `${assignedTab.folderName}/${fileName}`,
        });
      });

      const archive = window.UserFlowArchive.createArchive(entries);
      downloadUserFlowFile(
        archive,
        `user-flow-all-${getExportFileTimestamp(exportedAt)}.zip`,
      );
      state.lastError = "";
      notifyClients({ immediate: true });
      return true;
    } catch (error) {
      state.lastError = error?.message || "전체 녹화를 ZIP 파일로 내보내지 못했습니다.";
      notifyClients({ immediate: true });
      return false;
    }
  }

  function exportRecording(sessionId) {
    const session = state.sessions.find((item) => item.id === sessionId);

    if (!session || state.isRecording || state.isReplaying) {
      return false;
    }

    try {
      const exportedAt = Date.now();
      const exportData = {
        version: RECORDING_FORMAT_VERSION,
        exportedAt: new Date(exportedAt).toISOString(),
        session: {
          id: session.id,
          name: session.name || "",
          titlePrefix: session.titlePrefix || "",
          recordedAt: session.recordedAt,
          events: session.events,
        },
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const sessionIdSuffix = session.id.slice(-6).replace(/[^a-zA-Z0-9_-]/g, "");
      downloadUserFlowFile(
        blob,
        `user-flow-${getExportFileTimestamp(session.recordedAt || exportedAt)}-${sessionIdSuffix}.json`,
      );
      state.lastError = "";
      return true;
    } catch (error) {
      state.lastError = "선택한 녹화를 JSON 파일로 내보내지 못했습니다.";
      notifyClients({ immediate: true });
      return false;
    }
  }

  function renameSession(sessionId, name) {
    if (!sessionId || state.isRecording || state.isReplaying) {
      return false;
    }

    synchronizeRecordingFromStorage({ notify: false });

    const session = state.sessions.find((item) => item.id === sessionId);
    const normalizedName = String(name || "").trim().slice(0, MAX_SESSION_NAME_LENGTH);

    if (!session || !normalizedName) {
      return false;
    }

    const previousName = session.name;
    const wasDirty = dirtySessionIds.has(session.id);
    session.name = normalizedName;
    dirtySessionIds.add(session.id);

    if (!persistRecording()) {
      session.name = previousName;

      if (!wasDirty) {
        dirtySessionIds.delete(session.id);
      }

      notifyClients({ immediate: true });
      return false;
    }

    notifyClients({ immediate: true });
    return true;
  }

  function deleteSessions(sessionIds) {
    if (state.isRecording || state.isReplaying) {
      return false;
    }

    synchronizeRecordingFromStorage({ notify: false });
    const requestedIds = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        .map((sessionId) => String(sessionId || "").trim())
        .filter(Boolean),
    );
    const deletedSessions = state.sessions.filter((session) =>
      requestedIds.has(session.id),
    );

    if (!deletedSessions.length) {
      return false;
    }

    const previousSessions = state.sessions;
    const previousCurrentSessionId = state.currentSessionId;
    const previousEvents = state.events;
    const previousRecordedAt = state.recordedAt;
    const previousResumableRecordingSessionId =
      state.resumableRecordingSessionId;
    const previousResumableRecordingElapsedMs =
      state.resumableRecordingElapsedMs;
    const previousStoppedRecordingSourceSessionId =
      state.stoppedRecordingSourceSessionId;
    const previousStoppedRecordingBackupSessionId =
      state.stoppedRecordingBackupSessionId;
    const previousDirtySessionIds = new Set(dirtySessionIds);
    const previousDeletedSessionIds = new Set(deletedSessionIds);

    state.sessions = state.sessions.filter((session) => !requestedIds.has(session.id));
    deletedSessions.forEach((session) => {
      dirtySessionIds.delete(session.id);
      deletedSessionIds.add(session.id);
    });

    if (requestedIds.has(state.currentSessionId)) {
      const latestSession = state.sessions[0];
      state.currentSessionId = latestSession?.id || "";
      state.events = latestSession?.events || [];
      state.recordedAt = latestSession?.recordedAt || null;
    }

    if (requestedIds.has(state.resumableRecordingSessionId)) {
      state.resumableRecordingSessionId = "";
      state.resumableRecordingElapsedMs = 0;
    }

    if (
      requestedIds.has(state.stoppedRecordingSourceSessionId) ||
      requestedIds.has(state.stoppedRecordingBackupSessionId)
    ) {
      state.stoppedRecordingSourceSessionId = "";
      state.stoppedRecordingBackupSessionId = "";
    }

    if (!persistRecording()) {
      state.sessions = previousSessions;
      state.currentSessionId = previousCurrentSessionId;
      state.events = previousEvents;
      state.recordedAt = previousRecordedAt;
      state.resumableRecordingSessionId =
        previousResumableRecordingSessionId;
      state.resumableRecordingElapsedMs =
        previousResumableRecordingElapsedMs;
      state.stoppedRecordingSourceSessionId =
        previousStoppedRecordingSourceSessionId;
      state.stoppedRecordingBackupSessionId =
        previousStoppedRecordingBackupSessionId;
      dirtySessionIds.clear();
      previousDirtySessionIds.forEach((dirtySessionId) =>
        dirtySessionIds.add(dirtySessionId),
      );
      deletedSessionIds.clear();
      previousDeletedSessionIds.forEach((deletedSessionId) =>
        deletedSessionIds.add(deletedSessionId),
      );
      setRecordingSessions(state.sessions);
      notifyClients({ immediate: true });
      return false;
    }

    notifyClients({ immediate: true });
    return true;
  }

  function deleteSession(sessionId) {
    return deleteSessions([sessionId]);
  }

  function handleCommandMessage(event) {
    if (!event.data || event.data.type !== MESSAGE_COMMAND || !isAllowedMessage(event)) {
      return;
    }

    const targetOrigin = event.origin === "null" ? "*" : event.origin;
    state.clients.set(event.source, targetOrigin);

    switch (event.data.command) {
      case "toggle-record":
        if (!state.isReplaying) {
          if (state.isRecording) {
            stopRecording();
          } else if (state.resumableRecordingSessionId) {
            resumeRecording();
          } else {
            startRecording();
          }
        }
        break;
      case "toggle-replay":
        if (!state.isRecording) {
          state.isReplaying ? stopReplay() : replay();
        }
        break;
      case "toggle-replay-session":
        if (state.isRecording || !event.data.sessionId) {
          break;
        }

        if (state.isReplaying) {
          if (state.replaySessionId === event.data.sessionId) {
            stopReplay();
          }
        } else {
          replay(event.data.sessionId);
        }
        break;
      case "delete-session":
        deleteSession(event.data.sessionId);
        break;
      case "delete-sessions":
        deleteSessions(event.data.sessionIds);
        break;
      case "rename-session":
        renameSession(event.data.sessionId, event.data.sessionName);
        break;
      case "export-recording":
        exportRecording(event.data.sessionId);
        break;
      case "export-all-recordings":
        exportAllRecordings(event.data.tabOrganization);
        break;
      case "import-recordings":
        importRecordings(event.data.importData, {
          skipZipNameDuplicateCheck: Boolean(
            event.data.skipZipNameDuplicateCheck,
          ),
        });
        break;
      case "clear":
        clearRecording();
        break;
      case "get-state":
        sendState(event.source, targetOrigin);
        break;
      default:
        break;
    }
  }

  function handleRecordingStorage(event) {
    if (
      (event.key !== STORAGE_KEY && event.key !== null) ||
      (event.storageArea && event.storageArea !== window.localStorage)
    ) {
      return;
    }

    synchronizeRecordingFromStorage();
  }

  function handleRecordingPageShow() {
    synchronizeRecordingFromStorage();
  }

  function handleRecordingPageHide() {
    if (dirtySessionIds.size || deletedSessionIds.size) {
      persistRecording();
    }
  }

  function attachListeners() {
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleFormChange, true);
    document.addEventListener("change", handleFormChange, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("message", handleCommandMessage);
    window.addEventListener("storage", handleRecordingStorage);
    window.addEventListener("pageshow", handleRecordingPageShow);
    window.addEventListener("pagehide", handleRecordingPageHide);
  }

  readRecording();
  attachListeners();
  installAutomaticRequestTracking();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureVisualStyles, { once: true });
  } else {
    ensureVisualStyles();
  }

  window.UserFlowRecorder = Object.freeze({
    clear: clearRecording,
    deleteSession,
    deleteSessions,
    exportAllRecordings,
    exportRecording,
    getEvents: (sessionId = state.currentSessionId) => [
      ...(state.sessions.find((session) => session.id === sessionId)?.events || []),
    ],
    getState: getPublicState,
    importRecordings,
    renameSession,
    replay,
    replaySession: replay,
    requestEnd,
    requestStart,
    resetPendingRequests,
    resume: resumeRecording,
    start: startRecording,
    stop: stopRecording,
    stopReplay,
    waitForRequests,
  });

})();
