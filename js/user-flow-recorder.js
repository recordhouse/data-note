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
  const VISUAL_STYLE_ID = "user-flow-recorder-visual-style";
  const CLICK_PULSE_MS = 420;
  const SCREEN_MASK_TRANSITION_MS = 160;
  const MAX_EVENTS = 10000;
  const MAX_SESSIONS = 20;
  const MAX_SESSION_NAME_LENGTH = 40;
  const SCROLL_SAMPLE_MS = 80;
  const STATE_NOTIFY_MS = 120;
  const REPLAY_PROGRESS_NOTIFY_MS = 250;
  const TARGET_WAIT_MS = 5000;
  const IMPORTABLE_EVENT_TYPES = new Set(["change", "click", "input", "scroll"]);
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
      width: auto;
      min-width: 0;
      height: auto;
      min-height: 36px;
      margin: 0;
      padding: 7px 11px;
      border: 1px solid currentColor;
      border-radius: 6px;
      appearance: none;
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

    .user-flow-runtime-status[data-mode="recording"],
    .user-flow-runtime-status[data-mode="replaying"] {
      gap: 6px;
      min-height: 32px;
      padding: 4px 9px;
    }

    .user-flow-runtime-status[data-mode="recording"] {
      color: #b42345;
    }

    .user-flow-runtime-status[data-mode="recording"] .user-flow-runtime-icon {
      flex-basis: 20px;
      width: 20px;
      height: 20px;
    }

    .user-flow-runtime-status[data-mode="recording"] .user-flow-runtime-action,
    .user-flow-runtime-status[data-mode="replaying"] .user-flow-runtime-action {
      display: none;
    }

    .user-flow-runtime-status[data-mode="recording"]:hover {
      background: #fff1f4;
    }

    .user-flow-runtime-status[data-mode="recording"]:focus-visible {
      outline: 2px solid rgba(180, 35, 69, 0.35);
      outline-offset: 2px;
    }

    .user-flow-runtime-status[data-mode="replaying"] {
      color: #0f766e;
    }

    .user-flow-runtime-status[data-mode="replaying"]:hover {
      background: #ecfdf5;
    }

    .user-flow-runtime-status[data-mode="replaying"]:focus-visible {
      outline: 2px solid rgba(15, 118, 110, 0.35);
      outline-offset: 2px;
    }

    .user-flow-runtime-status[data-state] {
      cursor: pointer;
      pointer-events: auto;
    }

    .user-flow-runtime-status.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .user-flow-runtime-icon {
      position: relative;
      flex: 0 0 20px;
      width: 20px;
      height: 20px;
    }

    .user-flow-runtime-status[data-mode="recording"] .user-flow-runtime-icon::before {
      position: absolute;
      inset: 5px;
      border-radius: 50%;
      background: currentColor;
      content: "";
    }

    .user-flow-runtime-status[data-mode="recording"] .user-flow-runtime-icon::after {
      position: absolute;
      inset: 2px;
      border: 1px solid currentColor;
      border-radius: 50%;
      content: "";
    }

    .user-flow-runtime-status[data-mode="recording"][data-state="active"]
      .user-flow-runtime-icon::before {
      animation: user-flow-record-pulse 900ms ease-in-out infinite;
    }

    .user-flow-runtime-status[data-mode="recording"][data-state="active"]
      .user-flow-runtime-icon::after {
      animation: user-flow-record-ring 900ms ease-out infinite;
    }

    .user-flow-runtime-status[data-mode="recording"]:not([data-state="active"])
      .user-flow-runtime-icon::after {
      opacity: 0.45;
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
      inset: 2px;
      border: 1.5px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      content: "";
    }

    .user-flow-runtime-status[data-mode="replaying"][data-state="active"]
      .user-flow-runtime-icon::after {
      animation: user-flow-replay-spin 680ms linear infinite;
    }

    .user-flow-runtime-action {
      margin-left: 2px;
      padding-left: 9px;
      border-left: 1px solid currentColor;
      font-size: 12px;
      font-weight: 700;
      opacity: 0.8;
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

    .user-flow-screen-mask {
      position: fixed;
      inset: 0;
      z-index: 2147482997;
      opacity: 0;
      pointer-events: none;
      background-position: top, bottom, left, right;
      background-repeat: no-repeat;
      background-size: 100% 28px, 100% 28px, 28px 100%, 28px 100%;
      transition: opacity ${SCREEN_MASK_TRANSITION_MS}ms ease;
    }

    .user-flow-screen-mask[data-mode="recording"] {
      background-image:
        linear-gradient(to bottom, rgba(180, 35, 69, 0.65), transparent),
        linear-gradient(to top, rgba(180, 35, 69, 0.65), transparent),
        linear-gradient(to right, rgba(180, 35, 69, 0.65), transparent),
        linear-gradient(to left, rgba(180, 35, 69, 0.65), transparent);
    }

    .user-flow-screen-mask[data-mode="replaying"] {
      background-image:
        linear-gradient(to bottom, rgba(15, 118, 110, 0.65), transparent),
        linear-gradient(to top, rgba(15, 118, 110, 0.65), transparent),
        linear-gradient(to right, rgba(15, 118, 110, 0.65), transparent),
        linear-gradient(to left, rgba(15, 118, 110, 0.65), transparent);
    }

    .user-flow-screen-mask.is-visible {
      animation: user-flow-screen-mask-pulse 1050ms ease-in-out infinite alternate;
    }

    @keyframes user-flow-screen-mask-pulse {
      from {
        opacity: 0.35;
      }

      to {
        opacity: 1;
      }
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
    lastReplaySessionId: "",
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
    screenMask: null,
    screenMaskFrame: 0,
    screenMaskTimer: 0,
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

  function showRuntimeStatus(mode, statusState = "active") {
    if (!document.body) {
      return;
    }

    let status = state.runtimeStatus;

    if (!status || !status.isConnected) {
      status = document.createElement("button");
      status.type = "button";
      status.className = "user-flow-runtime-status";
      status.setAttribute(IGNORE_ATTRIBUTE, "true");
      status.setAttribute("aria-live", "polite");
      status.innerHTML = `
        <span class="user-flow-runtime-icon" aria-hidden="true"></span>
        <span data-user-flow-runtime-label></span>
        <span class="user-flow-runtime-action" data-user-flow-runtime-action></span>
      `;
      status.addEventListener("click", () => {
        if (status.dataset.mode === "recording") {
          if (state.isRecording) {
            stopRecording();
          } else if (!state.isReplaying) {
            startRecording();
          }
          return;
        }

        if (status.dataset.mode === "replaying") {
          if (state.isReplaying) {
            stopReplay();
          } else if (!state.isRecording) {
            const replaySessionExists = state.sessions.some(
              (session) => session.id === state.lastReplaySessionId,
            );
            replay(replaySessionExists ? state.lastReplaySessionId : undefined);
          }
        }
      });
      document.body.append(status);
      state.runtimeStatus = status;
    }

    status.dataset.mode = mode;
    status.dataset.state = statusState;
    const isActive = statusState === "active";
    const isRecordingMode = mode === "recording";
    const label = isRecordingMode
      ? isActive
        ? "녹음 중지"
        : "녹음 시작"
      : isActive
        ? "재생 중지"
        : statusState === "completed"
          ? "재생 완료"
          : "재생 시작";
    const action = isActive ? "중지" : isRecordingMode ? "다시 녹음" : "다시 재생";

    status.title = label;
    status.setAttribute("aria-label", status.title);
    status.querySelector("[data-user-flow-runtime-label]").textContent = label;
    status.querySelector("[data-user-flow-runtime-action]").textContent = action;
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

  function showScreenMask(mode) {
    if (!document.body) {
      return;
    }

    let mask = state.screenMask;

    if (!mask || !mask.isConnected) {
      mask = document.createElement("div");
      mask.className = "user-flow-screen-mask";
      mask.setAttribute(IGNORE_ATTRIBUTE, "true");
      mask.setAttribute("aria-hidden", "true");
      document.body.append(mask);
      state.screenMask = mask;
    }

    mask.dataset.mode = mode;
    window.clearTimeout(state.screenMaskTimer);
    mask.hidden = false;
    window.cancelAnimationFrame(state.screenMaskFrame);
    state.screenMaskFrame = window.requestAnimationFrame(() => {
      state.screenMaskFrame = 0;

      if (
        (mode === "recording" && state.isRecording) ||
        (mode === "replaying" && state.isReplaying)
      ) {
        mask.classList.add("is-visible");
      }
    });
  }

  function hideScreenMask() {
    const mask = state.screenMask;

    if (!mask) {
      return;
    }

    window.cancelAnimationFrame(state.screenMaskFrame);
    state.screenMaskFrame = 0;
    window.clearTimeout(state.screenMaskTimer);
    mask.classList.remove("is-visible");
    state.screenMaskTimer = window.setTimeout(() => {
      if (!state.isRecording && !state.isReplaying) {
        mask.classList.remove("is-visible");
        mask.hidden = true;
      }
    }, SCREEN_MASK_TRANSITION_MS);
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

  function normalizeImportedSessions(importData) {
    const candidates = Array.isArray(importData?.sessions)
      ? importData.sessions
      : importData?.session
        ? [importData.session]
        : Array.isArray(importData?.events)
          ? [importData]
          : [];
    const reservedIds = new Set(state.sessions.map((session) => String(session.id || "")));
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

      if (importedId && reservedIds.has(importedId)) {
        continue;
      }

      const sessionId = importedId || createUniqueSessionId(recordedAt, reservedIds);
      reservedIds.add(sessionId);
      importedSessions.push({
        id: sessionId,
        name: String(candidate.name || "").trim().slice(0, MAX_SESSION_NAME_LENGTH),
        recordedAt,
        events,
      });
    }

    return importedSessions;
  }

  function importRecordings(importData) {
    if (state.isRecording || state.isReplaying) {
      state.lastError = "녹음 또는 재생 중에는 가져올 수 없습니다.";
      notifyClients({ immediate: true });
      return false;
    }

    const importedSessions = normalizeImportedSessions(importData);

    if (!importedSessions.length) {
      state.lastError = "가져올 새 녹음이 없거나 이미 존재하는 녹음입니다.";
      notifyClients({ immediate: true });
      return false;
    }

    const previousState = {
      currentSessionId: state.currentSessionId,
      events: state.events,
      recordedAt: state.recordedAt,
      sessions: state.sessions,
    };

    state.sessions = [...importedSessions, ...state.sessions].slice(0, MAX_SESSIONS);
    state.currentSessionId = importedSessions[0].id;
    state.events = importedSessions[0].events;
    state.recordedAt = importedSessions[0].recordedAt;

    if (!persistRecording()) {
      state.sessions = previousState.sessions;
      state.currentSessionId = previousState.currentSessionId;
      state.events = previousState.events;
      state.recordedAt = previousState.recordedAt;
      notifyClients({ immediate: true });
      return false;
    }

    notifyClients({ immediate: true });
    return true;
  }

  function startRecording() {
    stopReplay();
    const recordedAt = Date.now();
    const session = {
      id: createUniqueSessionId(recordedAt),
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
    showScreenMask("recording");
    showRuntimeStatus("recording");
    persistRecording();
    notifyClients({ immediate: true });
  }

  function stopRecording() {
    if (!state.isRecording) {
      return;
    }

    state.isRecording = false;
    hideScreenMask();
    showRuntimeStatus("recording", "stopped");
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
    state.lastReplaySessionId = state.replaySessionId || state.lastReplaySessionId;
    state.replaySessionId = "";
    state.replayStartedAt = 0;
    state.replayCompletedEventCount = 0;
    stopReplayProgressNotifications();
    showRuntimeStatus("replaying", "stopped");
    hideScreenMask();
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
    state.lastReplaySessionId = session.id;
    state.replayStartedAt = performance.now();
    state.replayCompletedEventCount = 0;
    state.lastError = "";
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
        showRuntimeStatus("replaying", "completed");
        hideScreenMask();
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
    state.lastReplaySessionId = "";
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

  function exportRecording(sessionId) {
    const session = state.sessions.find((item) => item.id === sessionId);

    if (!session || state.isRecording || state.isReplaying) {
      return false;
    }

    try {
      const exportedAt = Date.now();
      const exportData = {
        version: 2,
        exportedAt: new Date(exportedAt).toISOString(),
        session: {
          id: session.id,
          name: session.name || "",
          recordedAt: session.recordedAt,
          events: session.events,
        },
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = downloadUrl;
      const sessionIdSuffix = session.id.slice(-6).replace(/[^a-zA-Z0-9_-]/g, "");
      link.download = `user-flow-${getExportFileTimestamp(session.recordedAt || exportedAt)}-${sessionIdSuffix}.json`;
      link.hidden = true;
      link.setAttribute(IGNORE_ATTRIBUTE, "true");
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      state.lastError = "";
      return true;
    } catch (error) {
      state.lastError = "선택한 녹음을 JSON 파일로 내보내지 못했습니다.";
      notifyClients({ immediate: true });
      return false;
    }
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
      case "export-recording":
        exportRecording(event.data.sessionId);
        break;
      case "import-recordings":
        importRecordings(event.data.importData);
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
    exportRecording,
    getEvents: (sessionId = state.currentSessionId) => [
      ...(state.sessions.find((session) => session.id === sessionId)?.events || []),
    ],
    getState: getPublicState,
    importRecordings,
    renameSession,
    replay,
    replaySession: replay,
    start: startRecording,
    stop: stopRecording,
    stopReplay,
  });
})();
