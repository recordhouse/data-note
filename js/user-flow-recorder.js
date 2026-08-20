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
  const ACTION_INDICATOR_MS = 720;
  const MAX_EVENTS = 10000;
  const MAX_SESSIONS = 20;
  const SCROLL_SAMPLE_MS = 80;
  const STATE_NOTIFY_MS = 120;
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

    .user-flow-action-indicator {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 2147482999;
      min-height: 32px;
      padding: 7px 10px;
      border-left: 3px solid #1266d6;
      border-radius: 4px;
      background: rgba(23, 32, 42, 0.92);
      color: #ffffff;
      box-shadow: 0 8px 20px rgba(23, 32, 42, 0.18);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 800;
      line-height: 18px;
      opacity: 0;
      pointer-events: none;
      transform: translateY(6px);
      transition:
        opacity 140ms ease,
        transform 140ms ease;
    }

    .user-flow-action-indicator[data-kind="typing"] {
      border-left-color: #0f766e;
    }

    .user-flow-action-indicator[data-kind="selection"] {
      border-left-color: #9a6400;
    }

    .user-flow-action-indicator.is-visible {
      opacity: 1;
      transform: translateY(0);
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
    lastError: "",
    scrollLastAt: new Map(),
    scrollTimers: new Map(),
    clients: new Map(),
    notifyTimer: 0,
    actionIndicator: null,
    actionIndicatorTimer: 0,
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
            recordedAt: session.recordedAt || null,
            events: session.events,
          }));
      } else if (Array.isArray(recording.events) && recording.events.length) {
        const recordedAt = recording.recordedAt || Date.now();
        state.sessions = [
          {
            id: `recording-${recordedAt}`,
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
    return {
      isRecording: state.isRecording,
      isReplaying: state.isReplaying,
      canReplay: state.sessions.some((session) => session.events.length > 0),
      activeRecordingSessionId: state.isRecording ? state.currentSessionId : "",
      replaySessionId: state.replaySessionId,
      eventCount: state.events.length,
      durationMs: getDurationMs(),
      recordedAt: state.recordedAt,
      sessions: state.sessions.map((session) => ({
        id: session.id,
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

  function showActionIndicator(message, kind) {
    if (!document.body) {
      return;
    }

    let indicator = state.actionIndicator;

    if (!indicator || !indicator.isConnected) {
      indicator = document.createElement("div");
      indicator.className = "user-flow-action-indicator";
      indicator.setAttribute(IGNORE_ATTRIBUTE, "true");
      document.body.append(indicator);
      state.actionIndicator = indicator;
    }

    indicator.textContent = message;
    indicator.dataset.kind = kind;
    indicator.classList.add("is-visible");

    window.clearTimeout(state.actionIndicatorTimer);
    state.actionIndicatorTimer = window.setTimeout(() => {
      indicator.classList.remove("is-visible");
    }, ACTION_INDICATOR_MS);
  }

  function hideActionIndicator() {
    window.clearTimeout(state.actionIndicatorTimer);
    state.actionIndicatorTimer = 0;
    state.actionIndicator?.classList.remove("is-visible");
  }

  function showFormActionIndicator(element) {
    const isSelection =
      element instanceof HTMLSelectElement ||
      (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type));

    showActionIndicator(isSelection ? "선택 변경" : "입력 중", isSelection ? "selection" : "typing");
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

    if (state.isRecording && !state.isReplaying) {
      showFormActionIndicator(target);
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

    showActionIndicator("스크롤 중", "scroll");

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

    showActionIndicator("스크롤 중", "scroll");

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

    showFormActionIndicator(target);

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
    persistRecording();
    notifyClients({ immediate: true });
  }

  function stopRecording() {
    if (!state.isRecording) {
      return;
    }

    state.isRecording = false;
    hideActionIndicator();
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
    hideActionIndicator();
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
    state.lastError = "";
    notifyClients({ immediate: true });

    try {
      window.focus();
    } catch (error) {
      // Browsers may ignore focus requests between windows.
    }

    const replayStartedAt = performance.now();

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
    }

    if (state.replayRunId === replayRunId) {
      state.isReplaying = false;
      state.replayAbort = false;
      state.replaySessionId = "";
      notifyClients({ immediate: true });
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
    getEvents: (sessionId = state.currentSessionId) => [
      ...(state.sessions.find((session) => session.id === sessionId)?.events || []),
    ],
    getState: getPublicState,
    replay,
    replaySession: replay,
    start: startRecording,
    stop: stopRecording,
    stopReplay,
  });
})();
