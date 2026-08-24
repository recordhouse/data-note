(() => {
  "use strict";

  if (!document.querySelector("#userFlowPanel") || window.UserFlowPopup) {
    return;
  }

  const MESSAGE_USER_FLOW_COMMAND = "response-mapping-user-flow-command";
  const MESSAGE_USER_FLOW_STATE = "response-mapping-user-flow-state";
  const POPUP_TAB_CHANGE_EVENT = "response-mapping-popup-tab-change";
  const MAX_USER_FLOW_IMPORT_BYTES = 10 * 1024 * 1024;

  let currentUserFlowState = {};
  let editingUserFlowSessionId = "";
  let renderedUserFlowSessionSignature = "";
  let userFlowDragDepth = 0;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
      activeRecordingSessionId: flowState.activeRecordingSessionId || "",
      editingUserFlowSessionId,
      isRecording: Boolean(flowState.isRecording),
      isReplaying: Boolean(flowState.isReplaying),
      replaySessionId: flowState.replaySessionId || "",
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

    const sessions = Array.isArray(flowState.sessions) ? flowState.sessions : [];

    if (
      flowState.isRecording ||
      flowState.isReplaying ||
      !sessions.some((session) => session.id === editingUserFlowSessionId)
    ) {
      editingUserFlowSessionId = "";
    }

    if (sessionCount) {
      sessionCount.textContent = `${sessions.length.toLocaleString("ko-KR")}개`;
    }

    if (!sessions.length) {
      renderedUserFlowSessionSignature = "";
      sessionList.innerHTML = `<div class="user-flow-empty">저장된 녹음이 없습니다.</div>`;
      return;
    }

    const sessionSignature = getUserFlowSessionSignature(flowState, sessions);

    if (renderedUserFlowSessionSignature === sessionSignature) {
      updateUserFlowSessionProgress(flowState, sessions);
      return;
    }

    renderedUserFlowSessionSignature = sessionSignature;

    sessionList.innerHTML = sessions
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
            data-state="${isRecordingSession ? "recording" : isReplayingSession ? "replaying" : "idle"}"
            data-user-flow-session-id="${escapeHtml(session.id)}"
          >
            <div class="user-flow-session-main">
              <strong class="user-flow-session-time">${escapeHtml(sessionName || recordedAt)}</strong>
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

    sendUserFlowCommand(button.dataset.userFlowCommand, {
      sessionId: button.dataset.sessionId || "",
    });
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

  async function importUserFlowFile(file) {
    if (isUserFlowImportBlocked()) {
      showUserFlowImportStatus("녹음 또는 재생 중에는 가져올 수 없습니다.");
      return;
    }

    if (!isJsonFile(file)) {
      showUserFlowImportStatus("JSON 파일만 가져올 수 있습니다.");
      return;
    }

    if (file.size > MAX_USER_FLOW_IMPORT_BYTES) {
      showUserFlowImportStatus("10MB 이하의 JSON 파일만 가져올 수 있습니다.");
      return;
    }

    try {
      const importData = JSON.parse(await file.text());
      showUserFlowImportStatus("가져오는 중", "ready");
      sendUserFlowCommand("import-recordings", { importData });
    } catch (error) {
      showUserFlowImportStatus("JSON 파일을 읽지 못했습니다.");
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
    const jsonFile = files.find(isJsonFile);
    resetUserFlowFileDrag();

    if (!jsonFile) {
      showUserFlowImportStatus("JSON 파일만 가져올 수 있습니다.");
      return;
    }

    importUserFlowFile(jsonFile);
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
  document.addEventListener("click", handleUserFlowImportTrigger);
  document.addEventListener("click", handleUserFlowNameControl);
  document.addEventListener("change", handleUserFlowImportChange);
  document.addEventListener("keydown", handleUserFlowNameKeydown);
  document.addEventListener("submit", handleUserFlowNameSubmit);
  document.addEventListener("dragenter", handleUserFlowDragEnter);
  document.addEventListener("dragover", handleUserFlowDragOver);
  document.addEventListener("dragleave", handleUserFlowDragLeave);
  document.addEventListener("dragend", resetUserFlowFileDrag);
  document.addEventListener("drop", handleUserFlowDrop);
  document.addEventListener(POPUP_TAB_CHANGE_EVENT, handlePopupTabChange);
  window.addEventListener("message", handleUserFlowStateMessage);
  window.addEventListener("blur", resetUserFlowFileDrag);

  sendUserFlowCommand("get-state");

  window.UserFlowPopup = Object.freeze({
    importFile: importUserFlowFile,
    renderState: renderUserFlowState,
    requestState: () => sendUserFlowCommand("get-state"),
  });
})();
