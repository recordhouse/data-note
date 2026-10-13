(() => {
  "use strict";

  if (window.UserFlowRecorderVisuals) {
    return;
  }

  const VISUAL_STYLE_ID = "user-flow-recorder-visual-style";
  const CLICK_PULSE_MS = 520;
  const ACTION_FEEDBACK_MS = 480;
  const SCROLL_FEEDBACK_IDLE_MS = 280;
  const SCREEN_MASK_TRANSITION_MS = 160;
  const VISUAL_CSS = `
    @property --user-flow-screen-mask-strong-stop {
      syntax: "<length>";
      inherits: true;
      initial-value: 24px;
    }

    @property --user-flow-screen-mask-soft-stop {
      syntax: "<length>";
      inherits: true;
      initial-value: 67px;
    }

    @property --user-flow-screen-mask-edge {
      syntax: "<length>";
      inherits: true;
      initial-value: 120px;
    }

    .user-flow-click-pulse {
      --user-flow-action-primary: #00be70;
      --user-flow-action-secondary: #00b2d6;
      position: fixed;
      z-index: 2147482999;
      width: 16px;
      height: 16px;
      border: 1.5px solid var(--user-flow-action-primary);
      border-radius: 50%;
      background: color-mix(in srgb, var(--user-flow-action-primary) 15%, transparent);
      box-shadow: 0 0 18px color-mix(in srgb, var(--user-flow-action-secondary) 24%, transparent);
      pointer-events: none;
      transform: translate(-50%, -50%) scale(0.55);
      animation: user-flow-click-pulse ${CLICK_PULSE_MS}ms cubic-bezier(0.16, 0.72, 0.24, 1) forwards;
    }

    .user-flow-click-pulse[data-mode="recording"] {
      --user-flow-action-primary: #ff184e;
      --user-flow-action-secondary: #8b3df6;
    }

    .user-flow-click-pulse[data-mode="replaying"] {
      --user-flow-action-primary: #00be70;
      --user-flow-action-secondary: #00b2d6;
    }

    @keyframes user-flow-click-pulse {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.55);
      }

      18% {
        opacity: 0.92;
      }

      62% {
        opacity: 0.54;
      }

      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(2.25);
      }
    }

    .user-flow-action-feedback {
      position: fixed;
      z-index: 2147482998;
      box-sizing: border-box;
      min-width: 12px;
      min-height: 12px;
      border: 1.5px solid rgba(0, 190, 112, 0.72);
      border-radius: 7px;
      background: linear-gradient(
        100deg,
        rgba(0, 190, 112, 0.04),
        rgba(0, 178, 214, 0.14),
        rgba(0, 190, 112, 0.03)
      );
      box-shadow:
        0 0 0 3px rgba(0, 178, 214, 0.08),
        0 4px 16px rgba(0, 190, 112, 0.12);
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      transform: scale(0.985);
      transform-origin: center;
    }

    .user-flow-action-feedback.is-active {
      animation: user-flow-action-feedback ${ACTION_FEEDBACK_MS}ms ease-out forwards;
    }

    .user-flow-action-feedback[data-kind="input"]::after,
    .user-flow-action-feedback[data-kind="change"]::after {
      position: absolute;
      top: 22%;
      right: 7px;
      bottom: 22%;
      width: 2px;
      border-radius: 2px;
      background: #00b2d6;
      box-shadow: 0 0 6px rgba(0, 178, 214, 0.48);
      content: "";
      animation: user-flow-input-caret 360ms ease-in-out 2;
    }

    .user-flow-action-feedback[data-kind="scroll"] {
      border-color: rgba(0, 178, 214, 0.64);
      background: rgba(255, 255, 255, 0.72);
      box-shadow:
        0 0 0 3px rgba(0, 190, 112, 0.08),
        0 5px 14px rgba(0, 80, 72, 0.12);
      transition:
        opacity 180ms ease,
        transform 220ms ease;
    }

    .user-flow-action-feedback[data-kind="scroll"].is-active {
      animation: none;
      opacity: 0.9;
      transform: scale(1);
    }

    .user-flow-action-feedback[data-kind="scroll"]::after {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 7px;
      height: 7px;
      border-right: 2px solid #00be70;
      border-bottom: 2px solid #00be70;
      content: "";
      opacity: 0.92;
      transform: translate(-50%, -60%) rotate(45deg);
      transition: transform 180ms ease;
    }

    .user-flow-action-feedback[data-direction="up"]::after {
      transform: translate(-50%, -40%) rotate(225deg);
    }

    .user-flow-action-feedback[data-direction="left"]::after {
      transform: translate(-40%, -50%) rotate(135deg);
    }

    .user-flow-action-feedback[data-direction="right"]::after {
      transform: translate(-60%, -50%) rotate(-45deg);
    }

    .user-flow-action-feedback[data-compact="true"] {
      width: 26px !important;
      height: 40px !important;
      border-radius: 13px;
    }

    @keyframes user-flow-action-feedback {
      0% {
        opacity: 0;
        transform: scale(0.985);
      }

      22% {
        opacity: 0.9;
        transform: scale(1);
      }

      100% {
        opacity: 0;
        transform: scale(1.012);
      }
    }

    @keyframes user-flow-input-caret {
      50% {
        opacity: 0.18;
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
      --user-flow-screen-mask-strong-stop: 24px;
      --user-flow-screen-mask-soft-stop: 67px;
      --user-flow-screen-mask-edge: 120px;
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
        linear-gradient(to bottom, rgba(255, 24, 78, 1) 0, rgba(255, 24, 78, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(255, 24, 78, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(255, 24, 78, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to top, rgba(255, 24, 78, 1) 0, rgba(255, 24, 78, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(255, 24, 78, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(255, 24, 78, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to right, rgba(255, 24, 78, 1) 0, rgba(255, 24, 78, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(255, 24, 78, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(255, 24, 78, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to left, rgba(255, 24, 78, 1) 0, rgba(255, 24, 78, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(255, 24, 78, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(255, 24, 78, 0) var(--user-flow-screen-mask-edge));
    }

    .user-flow-screen-mask[data-mode="recording"]
      .user-flow-screen-mask-layer[data-layer="secondary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(139, 61, 246, 1) 0, rgba(139, 61, 246, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(139, 61, 246, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(139, 61, 246, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to top, rgba(139, 61, 246, 1) 0, rgba(139, 61, 246, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(139, 61, 246, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(139, 61, 246, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to left, rgba(139, 61, 246, 1) 0, rgba(139, 61, 246, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(139, 61, 246, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(139, 61, 246, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to right, rgba(139, 61, 246, 1) 0, rgba(139, 61, 246, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(139, 61, 246, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(139, 61, 246, 0) var(--user-flow-screen-mask-edge));
    }

    .user-flow-screen-mask[data-mode="replaying"]
      .user-flow-screen-mask-layer[data-layer="primary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(0, 190, 112, 1) 0, rgba(0, 190, 112, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 190, 112, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 190, 112, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to top, rgba(0, 190, 112, 1) 0, rgba(0, 190, 112, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 190, 112, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 190, 112, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to right, rgba(0, 190, 112, 1) 0, rgba(0, 190, 112, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 190, 112, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 190, 112, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to left, rgba(0, 190, 112, 1) 0, rgba(0, 190, 112, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 190, 112, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 190, 112, 0) var(--user-flow-screen-mask-edge));
    }

    .user-flow-screen-mask[data-mode="replaying"]
      .user-flow-screen-mask-layer[data-layer="secondary"] {
      --user-flow-screen-mask-dot-gradient:
        linear-gradient(to bottom, rgba(0, 178, 214, 1) 0, rgba(0, 178, 214, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 178, 214, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 178, 214, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to top, rgba(0, 178, 214, 1) 0, rgba(0, 178, 214, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 178, 214, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 178, 214, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to left, rgba(0, 178, 214, 1) 0, rgba(0, 178, 214, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 178, 214, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 178, 214, 0) var(--user-flow-screen-mask-edge)),
        linear-gradient(to right, rgba(0, 178, 214, 1) 0, rgba(0, 178, 214, 0.88) var(--user-flow-screen-mask-strong-stop), rgba(0, 178, 214, 0.08) var(--user-flow-screen-mask-soft-stop), rgba(0, 178, 214, 0) var(--user-flow-screen-mask-edge));
    }

    .user-flow-screen-mask.is-visible {
      opacity: 1;
    }

    .user-flow-screen-mask.is-visible
      .user-flow-screen-mask-layer[data-layer="primary"] {
      animation:
        user-flow-screen-mask-orbit-clockwise 4000ms linear infinite,
        user-flow-screen-mask-breathe-primary 2700ms ease-in-out infinite alternate,
        user-flow-screen-mask-pulse 800ms ease-in-out infinite alternate,
        user-flow-screen-mask-depth-primary 3600ms cubic-bezier(0.45, 0, 0.2, 1) infinite;
    }

    .user-flow-screen-mask.is-visible
      .user-flow-screen-mask-layer[data-layer="secondary"] {
      animation:
        user-flow-screen-mask-orbit-counterclockwise 7000ms linear infinite,
        user-flow-screen-mask-breathe-secondary 4600ms ease-in-out -1200ms infinite alternate,
        user-flow-screen-mask-pulse 1300ms ease-in-out -400ms infinite alternate,
        user-flow-screen-mask-depth-secondary 5700ms cubic-bezier(0.25, 0.75, 0.35, 1) -1700ms infinite;
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

    @keyframes user-flow-screen-mask-depth-primary {
      0%,
      100% {
        --user-flow-screen-mask-strong-stop: 17px;
        --user-flow-screen-mask-soft-stop: 48px;
        --user-flow-screen-mask-edge: 85px;
      }

      22% {
        --user-flow-screen-mask-strong-stop: 38px;
        --user-flow-screen-mask-soft-stop: 106px;
        --user-flow-screen-mask-edge: 190px;
      }

      54% {
        --user-flow-screen-mask-strong-stop: 23px;
        --user-flow-screen-mask-soft-stop: 64px;
        --user-flow-screen-mask-edge: 115px;
      }

      78% {
        --user-flow-screen-mask-strong-stop: 33px;
        --user-flow-screen-mask-soft-stop: 92px;
        --user-flow-screen-mask-edge: 165px;
      }
    }

    @keyframes user-flow-screen-mask-depth-secondary {
      0%,
      100% {
        --user-flow-screen-mask-strong-stop: 21px;
        --user-flow-screen-mask-soft-stop: 59px;
        --user-flow-screen-mask-edge: 105px;
      }

      33% {
        --user-flow-screen-mask-strong-stop: 46px;
        --user-flow-screen-mask-soft-stop: 129px;
        --user-flow-screen-mask-edge: 230px;
      }

      61% {
        --user-flow-screen-mask-strong-stop: 18px;
        --user-flow-screen-mask-soft-stop: 50px;
        --user-flow-screen-mask-edge: 90px;
      }

      84% {
        --user-flow-screen-mask-strong-stop: 37px;
        --user-flow-screen-mask-soft-stop: 104px;
        --user-flow-screen-mask-edge: 185px;
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
    let actionFeedback = null;
    let actionFeedbackTimer = 0;
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

    function showClickPulse(clientX, clientY, mode = "") {
      if (!document.body) {
        return;
      }

      const pulse = document.createElement("span");
      pulse.className = "user-flow-click-pulse";
      pulse.setAttribute(ignoreAttribute, "true");
      pulse.dataset.mode = mode === "recording" || mode === "replaying"
        ? mode
        : isRecording()
          ? "recording"
          : "replaying";
      pulse.style.left = `${Math.round(clientX)}px`;
      pulse.style.top = `${Math.round(clientY)}px`;
      document.body.append(pulse);

      window.setTimeout(() => pulse.remove(), CLICK_PULSE_MS);
    }

    function getActionFeedbackBox(target, kind) {
      const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
      const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);

      if (kind === "scroll") {
        return {
          compact: true,
          height: 40,
          left: Math.max(8, Math.round(viewportWidth / 2 - 13)),
          top: Math.max(8, Math.round(viewportHeight / 2 - 20)),
          width: 26,
        };
      }

      const usesViewportCue =
        target === window ||
        target === document ||
        target === document.body ||
        target === document.documentElement;

      if (usesViewportCue) {
        return {
          compact: true,
          height: 40,
          left: Math.max(8, viewportWidth - 42),
          top: Math.max(8, Math.round(viewportHeight / 2 - 20)),
          width: 26,
        };
      }

      let rect;

      try {
        rect = target?.getBoundingClientRect?.();
      } catch (error) {
        return null;
      }

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      const padding = 3;
      const left = Math.max(2, rect.left - padding);
      const top = Math.max(2, rect.top - padding);
      const right = Math.min(viewportWidth - 2, rect.right + padding);
      const bottom = Math.min(viewportHeight - 2, rect.bottom + padding);

      return {
        compact: false,
        height: Math.max(12, bottom - top),
        left,
        top,
        width: Math.max(12, right - left),
      };
    }

    function showReplayAction(target, kind, { direction = "down" } = {}) {
      if (!document.body || !isReplaying()) {
        return;
      }

      const normalizedKind = ["input", "change", "scroll"].includes(kind)
        ? kind
        : "change";
      const box = getActionFeedbackBox(target, normalizedKind);

      if (!box) {
        return;
      }

      let feedback = actionFeedback;

      if (!feedback || !feedback.isConnected) {
        feedback = document.createElement("span");
        feedback.className = "user-flow-action-feedback";
        feedback.setAttribute(ignoreAttribute, "true");
        feedback.setAttribute("aria-hidden", "true");
        document.body.append(feedback);
        actionFeedback = feedback;
      }

      window.clearTimeout(actionFeedbackTimer);
      const isScrollFeedback = normalizedKind === "scroll";

      if (!isScrollFeedback) {
        feedback.classList.remove("is-active");
      }

      feedback.dataset.kind = normalizedKind;
      feedback.dataset.compact = String(box.compact);
      feedback.dataset.direction = ["up", "down", "left", "right"].includes(direction)
        ? direction
        : "down";
      feedback.style.left = `${Math.round(box.left)}px`;
      feedback.style.top = `${Math.round(box.top)}px`;
      feedback.style.width = `${Math.round(box.width)}px`;
      feedback.style.height = `${Math.round(box.height)}px`;

      if (!isScrollFeedback) {
        void feedback.offsetWidth;
      }

      feedback.classList.add("is-active");
      actionFeedbackTimer = window.setTimeout(() => {
        feedback.classList.remove("is-active");
      }, isScrollFeedback ? SCROLL_FEEDBACK_IDLE_MS : ACTION_FEEDBACK_MS);
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
      showReplayAction,
      showRuntimeStatus,
      showScreenMask,
    });
  }

  window.UserFlowRecorderVisuals = Object.freeze({ create });
})();
