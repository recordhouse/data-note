(() => {
  "use strict";

  if (window.UserFlowRecorderVisuals) {
    return;
  }

  const VISUAL_STYLE_ID = "user-flow-recorder-visual-style";
  const CLICK_PULSE_MS = 420;
  const SCREEN_MASK_TRANSITION_MS = 160;
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

    .user-flow-runtime-status[data-mode="replaying"] {
      color: #0f766e;
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
      contain: strict;
      isolation: isolate;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      transition: opacity ${SCREEN_MASK_TRANSITION_MS}ms ease;
    }

    .user-flow-screen-mask-layer {
      position: absolute;
      inset: 0;
      display: block;
      background-repeat: no-repeat;
      background-size: 100% 100%;
      -webkit-mask-image: linear-gradient(
        135deg,
        rgba(0, 0, 0, 0) 0%,
        rgba(0, 0, 0, 0.2) 28%,
        #000 50%,
        rgba(0, 0, 0, 0.2) 72%,
        rgba(0, 0, 0, 0) 100%
      );
      -webkit-mask-position: 0% 0%;
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-size: 140% 140%;
      mask-image: linear-gradient(
        135deg,
        rgba(0, 0, 0, 0) 0%,
        rgba(0, 0, 0, 0.2) 28%,
        #000 50%,
        rgba(0, 0, 0, 0.2) 72%,
        rgba(0, 0, 0, 0) 100%
      );
      mask-position: 0% 0%;
      mask-repeat: no-repeat;
      mask-size: 140% 140%;
    }

    .user-flow-screen-mask-layer::after {
      content: "";
      position: absolute;
      inset: 0;
      display: block;
      background-image: var(--user-flow-screen-mask-dot-gradient);
      background-position: 0 0;
      background-repeat: no-repeat;
      background-size: 100% 100%;
      -webkit-mask-image: radial-gradient(
        circle,
        #000 0 1.4px,
        transparent 0
      );
      -webkit-mask-position: 0 0;
      -webkit-mask-repeat: repeat;
      -webkit-mask-size: 5px 5px;
      mask-image: radial-gradient(
        circle,
        #000 0 1.4px,
        transparent 0
      );
      mask-position: 0 0;
      mask-repeat: repeat;
      mask-size: 5px 5px;
      pointer-events: none;
    }

    .user-flow-screen-mask[data-mode="recording"]
      .user-flow-screen-mask-layer[data-layer="primary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(255, 24, 78, 0.95) 0, rgba(255, 24, 78, 0.75) 18px, rgba(255, 24, 78, 0.2) 50px, rgba(255, 24, 78, 0) 90px),
        linear-gradient(to top, rgba(255, 24, 78, 0.95) 0, rgba(255, 24, 78, 0.75) 18px, rgba(255, 24, 78, 0.2) 50px, rgba(255, 24, 78, 0) 90px),
        linear-gradient(to right, rgba(255, 24, 78, 0.95) 0, rgba(255, 24, 78, 0.75) 18px, rgba(255, 24, 78, 0.2) 50px, rgba(255, 24, 78, 0) 90px),
        linear-gradient(to left, rgba(255, 24, 78, 0.95) 0, rgba(255, 24, 78, 0.75) 18px, rgba(255, 24, 78, 0.2) 50px, rgba(255, 24, 78, 0) 90px);
    }

    .user-flow-screen-mask[data-mode="recording"]
      .user-flow-screen-mask-layer[data-layer="secondary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(139, 61, 246, 0.95) 0, rgba(139, 61, 246, 0.75) 18px, rgba(139, 61, 246, 0.2) 50px, rgba(139, 61, 246, 0) 90px),
        linear-gradient(to top, rgba(139, 61, 246, 0.95) 0, rgba(139, 61, 246, 0.75) 18px, rgba(139, 61, 246, 0.2) 50px, rgba(139, 61, 246, 0) 90px),
        linear-gradient(to left, rgba(139, 61, 246, 0.95) 0, rgba(139, 61, 246, 0.75) 18px, rgba(139, 61, 246, 0.2) 50px, rgba(139, 61, 246, 0) 90px),
        linear-gradient(to right, rgba(139, 61, 246, 0.95) 0, rgba(139, 61, 246, 0.75) 18px, rgba(139, 61, 246, 0.2) 50px, rgba(139, 61, 246, 0) 90px);
    }

    .user-flow-screen-mask[data-mode="replaying"]
      .user-flow-screen-mask-layer[data-layer="primary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(0, 190, 112, 0.95) 0, rgba(0, 190, 112, 0.75) 18px, rgba(0, 190, 112, 0.2) 50px, rgba(0, 190, 112, 0) 90px),
        linear-gradient(to top, rgba(0, 190, 112, 0.95) 0, rgba(0, 190, 112, 0.75) 18px, rgba(0, 190, 112, 0.2) 50px, rgba(0, 190, 112, 0) 90px),
        linear-gradient(to right, rgba(0, 190, 112, 0.95) 0, rgba(0, 190, 112, 0.75) 18px, rgba(0, 190, 112, 0.2) 50px, rgba(0, 190, 112, 0) 90px),
        linear-gradient(to left, rgba(0, 190, 112, 0.95) 0, rgba(0, 190, 112, 0.75) 18px, rgba(0, 190, 112, 0.2) 50px, rgba(0, 190, 112, 0) 90px);
    }

    .user-flow-screen-mask[data-mode="replaying"]
      .user-flow-screen-mask-layer[data-layer="secondary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(0, 178, 214, 0.95) 0, rgba(0, 178, 214, 0.75) 18px, rgba(0, 178, 214, 0.2) 50px, rgba(0, 178, 214, 0) 90px),
        linear-gradient(to top, rgba(0, 178, 214, 0.95) 0, rgba(0, 178, 214, 0.75) 18px, rgba(0, 178, 214, 0.2) 50px, rgba(0, 178, 214, 0) 90px),
        linear-gradient(to left, rgba(0, 178, 214, 0.95) 0, rgba(0, 178, 214, 0.75) 18px, rgba(0, 178, 214, 0.2) 50px, rgba(0, 178, 214, 0) 90px),
        linear-gradient(to right, rgba(0, 178, 214, 0.95) 0, rgba(0, 178, 214, 0.75) 18px, rgba(0, 178, 214, 0.2) 50px, rgba(0, 178, 214, 0) 90px);
    }

    .user-flow-screen-mask.is-visible {
      opacity: 1;
    }

    .user-flow-screen-mask.is-visible
      .user-flow-screen-mask-layer[data-layer="primary"] {
      animation:
        user-flow-screen-mask-orbit-clockwise 4000ms linear infinite,
        user-flow-screen-mask-breathe-primary 2700ms ease-in-out infinite alternate,
        user-flow-screen-mask-pulse 800ms ease-in-out infinite alternate;
    }

    .user-flow-screen-mask.is-visible
      .user-flow-screen-mask-layer[data-layer="secondary"] {
      animation:
        user-flow-screen-mask-orbit-counterclockwise 7000ms linear infinite,
        user-flow-screen-mask-breathe-secondary 4600ms ease-in-out -1200ms infinite alternate,
        user-flow-screen-mask-pulse 1300ms ease-in-out -400ms infinite alternate;
    }

    @keyframes user-flow-screen-mask-pulse {
      from {
        opacity: 0.35;
      }

      to {
        opacity: 1;
      }
    }

    @keyframes user-flow-screen-mask-orbit-clockwise {
      0%,
      100% {
        -webkit-mask-position: 0% 0%;
        mask-position: 0% 0%;
      }

      25% {
        -webkit-mask-position: 100% 0%;
        mask-position: 100% 0%;
      }

      50% {
        -webkit-mask-position: 100% 100%;
        mask-position: 100% 100%;
      }

      75% {
        -webkit-mask-position: 0% 100%;
        mask-position: 0% 100%;
      }
    }

    @keyframes user-flow-screen-mask-orbit-counterclockwise {
      0%,
      100% {
        -webkit-mask-position: 100% 100%;
        mask-position: 100% 100%;
      }

      25% {
        -webkit-mask-position: 100% 0%;
        mask-position: 100% 0%;
      }

      50% {
        -webkit-mask-position: 0% 0%;
        mask-position: 0% 0%;
      }

      75% {
        -webkit-mask-position: 0% 100%;
        mask-position: 0% 100%;
      }
    }

    @keyframes user-flow-screen-mask-breathe-primary {
      from {
        -webkit-mask-size: 105% 105%;
        mask-size: 105% 105%;
      }

      to {
        -webkit-mask-size: 300% 300%;
        mask-size: 300% 300%;
      }
    }

    @keyframes user-flow-screen-mask-breathe-secondary {
      from {
        -webkit-mask-size: 115% 115%;
        mask-size: 115% 115%;
      }

      to {
        -webkit-mask-size: 360% 360%;
        mask-size: 360% 360%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .user-flow-screen-mask.is-visible {
        animation: none;
        opacity: 0.82;
      }

      .user-flow-screen-mask.is-visible .user-flow-screen-mask-layer {
        animation: none;
        -webkit-mask-position: 50% 50%;
        mask-position: 50% 50%;
      }
    }

    @keyframes user-flow-replay-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  function create(options = {}) {
    const ignoreAttribute =
      String(options.ignoreAttribute || "").trim() || "data-user-flow-ignore";
    const isRecording =
      typeof options.isRecording === "function" ? options.isRecording : () => false;
    const isReplaying =
      typeof options.isReplaying === "function" ? options.isReplaying : () => false;
    let runtimeStatus = null;
    let runtimeStatusFrame = 0;
    let runtimeStatusTimer = 0;
    let screenMask = null;
    let screenMaskFrame = 0;
    let screenMaskTimer = 0;

    function ensureStyles() {
      if (document.getElementById(VISUAL_STYLE_ID)) {
        return;
      }

      const style = document.createElement("style");
      style.id = VISUAL_STYLE_ID;
      style.setAttribute(ignoreAttribute, "true");
      style.textContent = VISUAL_CSS;
      (document.head || document.body)?.append(style);
    }

    function showClickPulse(clientX, clientY) {
      if (!document.body) {
        return;
      }

      const pulse = document.createElement("span");
      pulse.className = "user-flow-click-pulse";
      pulse.setAttribute(ignoreAttribute, "true");
      pulse.style.left = `${Math.round(clientX)}px`;
      pulse.style.top = `${Math.round(clientY)}px`;
      document.body.append(pulse);

      window.setTimeout(() => pulse.remove(), CLICK_PULSE_MS);
    }

    function showRuntimeStatus(mode, statusState = "active") {
      if (!document.body) {
        return;
      }

      let status = runtimeStatus;

      if (!status || !status.isConnected) {
        status = document.createElement("div");
        status.className = "user-flow-runtime-status";
        status.setAttribute(ignoreAttribute, "true");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.innerHTML = `
          <span class="user-flow-runtime-icon" aria-hidden="true"></span>
          <span data-user-flow-runtime-label></span>
        `;
        document.body.append(status);
        runtimeStatus = status;
      }

      status.dataset.mode = mode;
      status.dataset.state = statusState;
      const isActive = statusState === "active";
      const isRecordingMode = mode === "recording";
      const label = isRecordingMode
        ? isActive
          ? "로그 저장 중"
          : "로그 저장 중지됨"
        : isActive
          ? "재생 중"
          : statusState === "completed"
            ? "재생 완료"
            : "재생 중지됨";

      status.title = label;
      status.setAttribute("aria-label", status.title);
      status.querySelector("[data-user-flow-runtime-label]").textContent = label;
      status.hidden = false;

      window.clearTimeout(runtimeStatusTimer);
      window.cancelAnimationFrame(runtimeStatusFrame);
      runtimeStatusFrame = window.requestAnimationFrame(() => {
        runtimeStatusFrame = 0;
        status.classList.add("is-visible");
      });
    }

    function hideRuntimeStatus() {
      const status = runtimeStatus;

      if (!status) {
        return;
      }

      window.cancelAnimationFrame(runtimeStatusFrame);
      runtimeStatusFrame = 0;
      window.clearTimeout(runtimeStatusTimer);
      status.classList.remove("is-visible");
      runtimeStatusTimer = window.setTimeout(() => {
        if (!isRecording() && !isReplaying()) {
          status.hidden = true;
        }
      }, 140);
    }

    function showScreenMask(mode) {
      if (!document.body) {
        return;
      }

      let mask = screenMask;

      if (!mask || !mask.isConnected) {
        mask = document.createElement("div");
        mask.className = "user-flow-screen-mask";
        mask.setAttribute(ignoreAttribute, "true");
        mask.setAttribute("aria-hidden", "true");

        ["primary", "secondary"].forEach((layerName) => {
          const layer = document.createElement("span");
          layer.className = "user-flow-screen-mask-layer";
          layer.dataset.layer = layerName;
          layer.setAttribute(ignoreAttribute, "true");
          mask.append(layer);
        });

        document.body.append(mask);
        screenMask = mask;
      }

      mask.dataset.mode = mode;
      window.clearTimeout(screenMaskTimer);
      mask.hidden = false;
      window.cancelAnimationFrame(screenMaskFrame);
      screenMaskFrame = window.requestAnimationFrame(() => {
        screenMaskFrame = 0;

        if (
          (mode === "recording" && isRecording()) ||
          (mode === "replaying" && isReplaying())
        ) {
          mask.classList.add("is-visible");
        }
      });
    }

    function hideScreenMask() {
      const mask = screenMask;

      if (!mask) {
        return;
      }

      window.cancelAnimationFrame(screenMaskFrame);
      screenMaskFrame = 0;
      window.clearTimeout(screenMaskTimer);
      mask.classList.remove("is-visible");
      screenMaskTimer = window.setTimeout(() => {
        if (!isRecording() && !isReplaying()) {
          mask.classList.remove("is-visible");
          mask.hidden = true;
        }
      }, SCREEN_MASK_TRANSITION_MS);
    }

    return Object.freeze({
      ensureStyles,
      hideRuntimeStatus,
      hideScreenMask,
      showClickPulse,
      showRuntimeStatus,
      showScreenMask,
    });
  }

  window.UserFlowRecorderVisuals = Object.freeze({ create });
})();
