(() => {
  "use strict";

  if (window.UserFlowRecorder) {
    return;
  }

  const STORAGE_KEY = "response-mapping-user-flow-recording:v1";
  const MESSAGE_COMMAND = "response-mapping-user-flow-command";
  const MESSAGE_STATE = "response-mapping-user-flow-state";
  const IGNORE_ATTRIBUTE = "data-user-flow-ignore";
  const VISUAL_STYLE_ID = "user-flow-recorder-visual-style";
  const CLICK_PULSE_MS = 420;
  const REPLAY_OVERLAY_TRANSITION_MS = 160;
  const MAX_EVENTS = 10000;
  const MAX_SESSIONS = 20;
  const MAX_SESSION_NAME_LENGTH = 40;
  const SCROLL_SAMPLE_MS = 80;
  const STATE_NOTIFY_MS = 120;
  const REPLAY_PROGRESS_NOTIFY_MS = 250;
  const TARGET_WAIT_MS = 5000;
  const SENSITIVE_AUTOCOMPLETE = new Set([
    "cc-csc",
    "cc-number",
    "current-password",
    "new-password",
    "one-time-code",
  ]);
  const VISUAL_CSS = `
    .user-flow-click-pulse {
      position: fixed;
      z-index: 2147482999;
      width: 18px;
      height: 18px;
      border: 2px solid #1266d6;
      border-radius: 50%;
      background: rgba(18, 102, 214, 0.12);
      pointer-events: none;
      transform: translate(-50%, -50%) scale(0.72);
      animation: user-flow-click-pulse ${CLICK_PULSE_MS}ms ease-out forwards;
    }

    @keyframes user-flow-click-pulse {
      0% {
        opacity: 0.9;
        transform: translate(-50%, -50%) scale(0.72);
      }

      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(1.9);
      }
    }

    .user-flow-runtime-status {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 2147482999;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 7px 11px;
      border: 1px solid currentColor;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 8px 22px rgba(23, 32, 42, 0.16);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      font-weight: 800;
      line-height: 20px;
      opacity: 0;
      pointer-events: none;
      transform: translateY(6px);
      transition:
        opacity 140ms ease,
        transform 140ms ease;
    }

    .user-flow-runtime-status[data-mode="recording"] {
      color: #b42345;
    }

    .user-flow-runtime-status[data-mode="replaying"] {
      color: #0f766e;
    }

    .user-flow-runtime-status.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .user-flow-runtime-icon {
      position: relative;
      flex: 0 0 18px;
      width: 18px;
      height: 18px;
    }

    .user-flow-runtime-status[data-mode="recording"] .user-flow-runtime-icon::before {
      position: absolute;
      inset: 5px;
      border-radius: 50%;
      background: currentColor;
      animation: user-flow-record-pulse 900ms ease-in-out infinite;
      content: "";
    }

    .user-flow-runtime-status[data-mode="recording"] .user-flow-runtime-icon::after {
      position: absolute;
      inset: 2px;
      border: 1px solid currentColor;
      border-radius: 50%;
      animation: user-flow-record-ring 900ms ease-out infinite;
      content: "";
    }

    .user-flow-runtime-status[data-mode="replaying"] .user-flow-runtime-icon::before {
      position: absolute;
      top: 5px;
      left: 7px;
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 6px solid currentColor;
      content: "";
    }

    .user-flow-runtime-status[data-mode="replaying"] .user-flow-runtime-icon::after {
      position: absolute;
      inset: 1px;
      border: 1.5px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: user-flow-replay-spin 680ms linear infinite;
      content: "";
    }

    @keyframes user-flow-record-pulse {
      50% {
        opacity: 0.45;
        transform: scale(0.78);
      }
    }

    @keyframes user-flow-record-ring {
      0% {
        opacity: 0.8;
        transform: scale(0.72);
      }

      100% {
        opacity: 0;
        transform: scale(1.35);
      }
    }

    .user-flow-replay-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147482997;
      background: rgba(15, 23, 42, 0.12);
      opacity: 0;
      pointer-events: none;
      transition: opacity ${REPLAY_OVERLAY_TRANSITION_MS}ms ease;
    }

    .user-flow-replay-overlay.is-visible {
      opacity: 1;
    }

    @keyframes user-flow-replay-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

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
    replayCompletedEventCount: 0,
    replayProgressTimer: 0,
    lastError: "",
    scrollLastAt: new Map(),
    scrollTimers: new Map(),
    clients: new Map(),
    notifyTimer: 0,
    runtimeStatus: null,
    runtimeStatusFrame: 0,
    runtimeStatusTimer: 0,
    replayOverlay: null,
    replayOverlayFrame: 0,
    replayOverlayTimer: 0,
  };

  function readRecording() {
    try {
      const recording = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");

      if (!recording) {
        return;
      }

      if (Array.isArray(recording.sessions)) {
        state.sessions = recording.sessions
          .filter((session) => session && Array.isArray(session.events))
          .slice(0, MAX_SESSIONS)
          .map((session, index) => ({
            id: session.id || `recording-${session.recordedAt || Date.now()}-${index}`,
            name: typeof session.name === "string" ? session.name : "",
            recordedAt: session.recordedAt || null,
            events: session.events,
          }));
      } else if (Array.isArray(recording.events) && recording.events.length) {
        const recordedAt = recording.recordedAt || Date.now();
        state.sessions = [
          {
            id: `recording-${recordedAt}`,
            name: "",
            recordedAt,
            events: recording.events,
          },
        ];
      }

      const latestSession = state.sessions[0];

      if (latestSession) {
        state.currentSessionId = latestSession.id;
        state.events = latestSession.events;
        state.recordedAt = latestSession.recordedAt;
      }
    } catch (error) {
      state.lastError = "저장된 녹음 데이터를 불러오지 못했습니다.";
    }
  }

  function persistRecording() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          sessions: state.sessions,
        }),
      );
      state.lastError = "";
      return true;
    } catch (error) {
      state.lastError = "녹음 데이터를 로컬 스토리지에 저장하지 못했습니다.";
      return false;
    }
  }

  function getDurationMs(events = state.events) {
    return events.length ? events[events.length - 1].at : 0;
  }

  function getPublicState() {
    const replayDurationMs = getDurationMs();
    const replayElapsedMs = state.isReplaying
      ? Math.max(0, performance.now() - state.replayStartedAt)
      : 0;

    return {
      isRecording: state.isRecording,
      isReplaying: state.isReplaying,
      canReplay: state.sessions.some((session) => session.events.length > 0),
      activeRecordingSessionId: state.isRecording ? state.currentSessionId : "",
      replaySessionId: state.replaySessionId,
      replayCompletedEventCount: state.replayCompletedEventCount,
      replayRemainingMs: state.isReplaying
        ? Math.max(0, replayDurationMs - replayElapsedMs)
        : 0,
      eventCount: state.events.length,
      durationMs: getDurationMs(),
      recordedAt: state.recordedAt,
      sessions: state.sessions.map((session) => ({
        id: session.id,
        name: session.name || "",
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

  function ensureVisualStyles() {
    if (document.getElementById(VISUAL_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = VISUAL_STYLE_ID;
    style.setAttribute(IGNORE_ATTRIBUTE, "true");
    style.textContent = VISUAL_CSS;
    (document.head || document.body)?.append(style);
  }

  function showClickPulse(clientX, clientY) {
    if (!document.body) {
      return;
    }

    const pulse = document.createElement("span");
    pulse.className = "user-flow-click-pulse";
    pulse.setAttribute(IGNORE_ATTRIBUTE, "true");
    pulse.style.left = `${Math.round(clientX)}px`;
    pulse.style.top = `${Math.round(clientY)}px`;
    document.body.append(pulse);

    window.setTimeout(() => pulse.remove(), CLICK_PULSE_MS);
  }

  function showRuntimeStatus(mode) {
    if (!document.body) {
      return;
    }

    let status = state.runtimeStatus;

    if (!status || !status.isConnected) {
      status = document.createElement("div");
      status.className = "user-flow-runtime-status";
      status.setAttribute(IGNORE_ATTRIBUTE, "true");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.innerHTML = `
        <span class="user-flow-runtime-icon" aria-hidden="true"></span>
        <span data-user-flow-runtime-label></span>
      `;
      document.body.append(status);
      state.runtimeStatus = status;
    }

    status.dataset.mode = mode;
    status.querySelector("[data-user-flow-runtime-label]").textContent =
      mode === "recording" ? "녹음 중" : "재생 중";
    status.hidden = false;

    window.clearTimeout(state.runtimeStatusTimer);
    window.cancelAnimationFrame(state.runtimeStatusFrame);
    state.runtimeStatusFrame = window.requestAnimationFrame(() => {
      state.runtimeStatusFrame = 0;
      status.classList.add("is-visible");
    });
  }

  function hideRuntimeStatus() {
    const status = state.runtimeStatus;

    if (!status) {
      return;
    }

    window.cancelAnimationFrame(state.runtimeStatusFrame);
    state.runtimeStatusFrame = 0;
    window.clearTimeout(state.runtimeStatusTimer);
    status.classList.remove("is-visible");
    state.runtimeStatusTimer = window.setTimeout(() => {
      if (!state.isRecording && !state.isReplaying) {
        status.hidden = true;
      }
    }, 140);
  }

  function showReplayOverlay() {
    if (!document.body) {
      return;
    }

    let overlay = state.replayOverlay;

    if (!overlay || !overlay.isConnected) {
      overlay = document.createElement("div");
      overlay.className = "user-flow-replay-overlay";
      overlay.setAttribute(IGNORE_ATTRIBUTE, "true");
      overlay.setAttribute("aria-hidden", "true");
      document.body.append(overlay);
      state.replayOverlay = overlay;
    }

    window.clearTimeout(state.replayOverlayTimer);
    overlay.hidden = false;
    window.cancelAnimationFrame(state.replayOverlayFrame);
    state.replayOverlayFrame = window.requestAnimationFrame(() => {
      state.replayOverlayFrame = 0;

      if (state.isReplaying) {
        overlay.classList.add("is-visible");
      }
    });
  }

  function hideReplayOverlay() {
    const overlay = state.replayOverlay;

    if (!overlay) {
      return;
    }

    window.cancelAnimationFrame(state.replayOverlayFrame);
    state.replayOverlayFrame = 0;
    window.clearTimeout(state.replayOverlayTimer);
    overlay.classList.remove("is-visible");
    state.replayOverlayTimer = window.setTimeout(() => {
      if (!state.isReplaying) {
        overlay.classList.remove("is-visible");
        overlay.hidden = true;
      }
    }, REPLAY_OVERLAY_TRANSITION_MS);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/["\\#.;:[\],>+~*^$|=()\s]/g, "\\$&");
  }

  function cssStringEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function isIgnoredTarget(target) {
    return Boolean(target?.closest?.(`[${IGNORE_ATTRIBUTE}]`));
  }

  function getStableSelector(element) {
    if (!element || element === document) {
      return "";
    }

    if (element === window || element === document.documentElement || element === document.body) {
      return "__window__";
    }

    if (element.id) {
      const idSelector = `#${cssEscape(element.id)}`;

      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    }

    for (const attribute of ["data-testid", "data-test", "data-cy", "name"]) {
      const value = element.getAttribute(attribute);

      if (!value) {
        continue;
      }

      const selector = `${element.tagName.toLowerCase()}[${attribute}="${cssStringEscape(value)}"]`;

      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tagName = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children || []).filter(
        (sibling) => sibling.tagName === current.tagName,
      );
      parts.unshift(`${tagName}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = current.parentElement;
    }

    return parts.length ? `body > ${parts.join(" > ")}` : "body";
  }

  function isFormElement(element) {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element.isContentEditable
    );
  }

  function isSensitiveInput(element) {
    if (!(element instanceof HTMLInputElement)) {
      return false;
    }

    return (
      element.type === "password" ||
      SENSITIVE_AUTOCOMPLETE.has((element.autocomplete || "").toLowerCase())
    );
  }

  function getFormValue(element) {
    if (isSensitiveInput(element)) {
      return { redacted: true };
    }

    if (element instanceof HTMLInputElement) {
      if (element.type === "file") {
        return { unsupported: true };
      }

      if (element.type === "checkbox" || element.type === "radio") {
        return {
          checked: element.checked,
          value: element.value,
        };
      }

      return { value: element.value };
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return { value: element.value };
    }

    if (element.isContentEditable) {
      return { text: element.textContent || "" };
    }

    return {};
  }

  function setNativeValue(element, property, value) {
    let prototype = element;

    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);

      if (descriptor?.set) {
        descriptor.set.call(element, value);
        return;
      }

      prototype = Object.getPrototypeOf(prototype);
    }

    element[property] = value;
  }

  function applyFormValue(element, detail) {
    if (detail?.redacted || detail?.unsupported) {
      return false;
    }

    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        setNativeValue(element, "checked", Boolean(detail.checked));
      } else {
        setNativeValue(element, "value", detail.value ?? "");
      }
      return true;
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      setNativeValue(element, "value", detail.value ?? "");
      return true;
    }

    if (element.isContentEditable) {
      element.textContent = detail.text ?? "";
      return true;
    }

    return false;
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

    if (persist) {
      persistRecording();
    }

    notifyClients();
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;

    if (!target || isIgnoredTarget(target)) {
      return;
    }

    if (state.isRecording && !state.isReplaying) {
      showClickPulse(event.clientX, event.clientY);
    }

    pushEvent({
      type: "click",
      selector: getStableSelector(target),
      button: event.button,
      pointer: {
        clientX: Math.round(event.clientX),
        clientY: Math.round(event.clientY),
      },
    });
  }

  function handleFormChange(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;

    if (!target || isIgnoredTarget(target) || !isFormElement(target)) {
      return;
    }

    const detail = getFormValue(target);

    if (detail.unsupported) {
      return;
    }

    pushEvent({
      type: event.type,
      selector: getStableSelector(target),
      detail,
    });
  }

  function normalizeScrollTarget(target) {
    if (
      target === document ||
      target === document.documentElement ||
      target === document.body ||
      target === window
    ) {
      return window;
    }

    return target;
  }

  function getScrollEvent(target) {
    const normalizedTarget = normalizeScrollTarget(target);

    if (normalizedTarget === window) {
      return {
        type: "scroll",
        selector: "__window__",
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    }

    return {
      type: "scroll",
      selector: getStableSelector(normalizedTarget),
      scrollLeft: normalizedTarget.scrollLeft,
      scrollTop: normalizedTarget.scrollTop,
    };
  }

  function handleScroll(event) {
    if (!state.isRecording || state.isReplaying) {
      return;
    }

    const target = normalizeScrollTarget(event.target);
    const scrollEvent = getScrollEvent(target);
    const key = scrollEvent.selector;
    const now = performance.now();
    const lastAt = state.scrollLastAt.get(key) || 0;

    if (now - lastAt >= SCROLL_SAMPLE_MS) {
      state.scrollLastAt.set(key, now);
      pushEvent(scrollEvent, { persist: false });
    }

    window.clearTimeout(state.scrollTimers.get(key));
    state.scrollTimers.set(
      key,
      window.setTimeout(() => {
        state.scrollLastAt.set(key, performance.now());
        pushEvent(getScrollEvent(target));
      }, SCROLL_SAMPLE_MS),
    );
  }

  function findTarget(selector) {
    if (selector === "__window__") {
      return window;
    }

    try {
      return document.querySelector(selector);
    } catch (error) {
      return null;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
  }

  async function waitForTarget(selector) {
    const startedAt = performance.now();

    while (performance.now() - startedAt < TARGET_WAIT_MS) {
      const target = findTarget(selector);

      if (target) {
        return target;
      }

      await sleep(50);
    }

    return null;
  }

  function playScroll(recordedEvent) {
    const target = findTarget(recordedEvent.selector);

    if (target === window) {
      try {
        window.scrollTo({
          left: recordedEvent.scrollX || 0,
          top: recordedEvent.scrollY || 0,
          behavior: "smooth",
        });
      } catch (error) {
        window.scrollTo(recordedEvent.scrollX || 0, recordedEvent.scrollY || 0);
      }
      return;
    }

    if (!target) {
      return;
    }

    if (typeof target.scrollTo === "function") {
      try {
        target.scrollTo({
          left: recordedEvent.scrollLeft || 0,
          top: recordedEvent.scrollTop || 0,
          behavior: "smooth",
        });
        return;
      } catch (error) {
        // Fall through for browsers that only support numeric scrollTo arguments.
      }
    }

    target.scrollLeft = recordedEvent.scrollLeft || 0;
    target.scrollTop = recordedEvent.scrollTop || 0;
  }

  function playClick(target, recordedEvent) {
    const pointer = recordedEvent.pointer || {};
    const targetRect = target.getBoundingClientRect();
    const mouseOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: recordedEvent.button || 0,
      clientX: pointer.clientX || 0,
      clientY: pointer.clientY || 0,
    };

    showClickPulse(
      targetRect.left + targetRect.width / 2,
      targetRect.top + targetRect.height / 2,
    );

    for (const eventType of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      target.dispatchEvent(new MouseEvent(eventType, mouseOptions));
    }

    if (typeof target.click === "function") {
      target.click();
    } else {
      target.dispatchEvent(new MouseEvent("click", mouseOptions));
    }
  }

  function playFormChange(target, recordedEvent) {
    if (!applyFormValue(target, recordedEvent.detail || {})) {
      return;
    }

    target.dispatchEvent(
      new Event(recordedEvent.type, {
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  async function playEvent(recordedEvent) {
    if (recordedEvent.type === "scroll") {
      playScroll(recordedEvent);
      return;
    }

    const target = await waitForTarget(recordedEvent.selector);

    if (!target || target === window) {
      return;
    }

    if (recordedEvent.type === "click") {
      playClick(target, recordedEvent);
      return;
    }

    if (recordedEvent.type === "input" || recordedEvent.type === "change") {
      playFormChange(target, recordedEvent);
    }
  }

  function startRecording() {
    stopReplay();
    const recordedAt = Date.now();
    const session = {
      id: `recording-${recordedAt}-${Math.random().toString(36).slice(2, 8)}`,
      name: "",
      recordedAt,
      events: [],
    };

    state.sessions = [session, ...state.sessions].slice(0, MAX_SESSIONS);
    state.currentSessionId = session.id;
    state.events = session.events;
    state.isRecording = true;
    state.recordedAt = recordedAt;
    state.startAt = performance.now();
    state.lastError = "";
    state.scrollLastAt.clear();
    state.scrollTimers.forEach((timer) => window.clearTimeout(timer));
    state.scrollTimers.clear();
    showRuntimeStatus("recording");
    persistRecording();
    notifyClients({ immediate: true });
  }

  function stopRecording() {
    if (!state.isRecording) {
      return;
    }

    state.isRecording = false;
    hideRuntimeStatus();
    state.scrollTimers.forEach((timer) => window.clearTimeout(timer));
    state.scrollTimers.clear();
    persistRecording();
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
    state.replayCompletedEventCount = 0;
    stopReplayProgressNotifications();
    hideRuntimeStatus();
    hideReplayOverlay();
    notifyClients({ immediate: true });
  }

  async function replay(sessionId = state.currentSessionId || state.sessions[0]?.id) {
    const session = state.sessions.find((item) => item.id === sessionId);

    if (!session?.events.length || state.isReplaying) {
      return;
    }

    stopRecording();
    state.currentSessionId = session.id;
    state.events = session.events;
    state.recordedAt = session.recordedAt;
    state.replayAbort = false;
    state.replayRunId += 1;
    const replayRunId = state.replayRunId;
    state.isReplaying = true;
    state.replaySessionId = session.id;
    state.replayStartedAt = performance.now();
    state.replayCompletedEventCount = 0;
    state.lastError = "";
    showReplayOverlay();
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

      for (const recordedEvent of state.events) {
        if (state.replayAbort || state.replayRunId !== replayRunId) {
          break;
        }

        const waitMs = recordedEvent.at - (performance.now() - replayStartedAt);

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        if (state.replayAbort || state.replayRunId !== replayRunId) {
          break;
        }

        await playEvent(recordedEvent);
        state.replayCompletedEventCount += 1;
        notifyClients();
      }
    } finally {
      if (state.replayRunId === replayRunId) {
        state.isReplaying = false;
        state.replayAbort = false;
        state.replaySessionId = "";
        state.replayStartedAt = 0;
        state.replayCompletedEventCount = 0;
        stopReplayProgressNotifications();
        hideRuntimeStatus();
        hideReplayOverlay();
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
    state.lastError = "";
    window.localStorage.removeItem(STORAGE_KEY);
    notifyClients({ immediate: true });
  }

  function renameSession(sessionId, name) {
    if (!sessionId || state.isRecording || state.isReplaying) {
      return false;
    }

    const session = state.sessions.find((item) => item.id === sessionId);
    const normalizedName = String(name || "").trim().slice(0, MAX_SESSION_NAME_LENGTH);

    if (!session || !normalizedName) {
      return false;
    }

    session.name = normalizedName;
    persistRecording();
    notifyClients({ immediate: true });
    return true;
  }

  function deleteSession(sessionId) {
    if (!sessionId || state.isRecording || state.isReplaying) {
      return false;
    }

    const sessionIndex = state.sessions.findIndex((session) => session.id === sessionId);

    if (sessionIndex < 0) {
      return false;
    }

    state.sessions.splice(sessionIndex, 1);

    if (state.currentSessionId === sessionId) {
      const latestSession = state.sessions[0];
      state.currentSessionId = latestSession?.id || "";
      state.events = latestSession?.events || [];
      state.recordedAt = latestSession?.recordedAt || null;
    }

    persistRecording();
    notifyClients({ immediate: true });
    return true;
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
          state.isRecording ? stopRecording() : startRecording();
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
      case "rename-session":
        renameSession(event.data.sessionId, event.data.sessionName);
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

  function attachListeners() {
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleFormChange, true);
    document.addEventListener("change", handleFormChange, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("message", handleCommandMessage);
    window.addEventListener("pagehide", persistRecording);
  }

  readRecording();
  attachListeners();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureVisualStyles, { once: true });
  } else {
    ensureVisualStyles();
  }

  window.UserFlowRecorder = Object.freeze({
    clear: clearRecording,
    deleteSession,
    getEvents: (sessionId = state.currentSessionId) => [
      ...(state.sessions.find((session) => session.id === sessionId)?.events || []),
    ],
    getState: getPublicState,
    renameSession,
    replay,
    replaySession: replay,
    start: startRecording,
    stop: stopRecording,
    stopReplay,
  });
})();
