(() => {
  "use strict";

  if (window.UserFlowRecorderEvents) {
    return;
  }

  const CHECKABLE_EVENT_GROUP_MS = 150;
  const PERCENT_PRECISION = 6;
  const SCROLL_SAMPLE_MS = 80;
  const TARGET_WAIT_MS = 5000;
  const SENSITIVE_AUTOCOMPLETE = new Set([
    "cc-csc",
    "cc-number",
    "current-password",
    "new-password",
    "one-time-code",
  ]);

  function create(options = {}) {
    const ignoreAttribute =
      String(options.ignoreAttribute || "").trim() || "data-user-flow-ignore";
    const isRecording =
      typeof options.isRecording === "function" ? options.isRecording : () => false;
    const isReplaying =
      typeof options.isReplaying === "function" ? options.isReplaying : () => false;
    const recordEvent = options.recordEvent;
    const renderClickPulse =
      typeof options.showClickPulse === "function"
        ? options.showClickPulse
        : () => {};
    const scrollLastAt = new Map();
    const scrollTimers = new Map();

    if (typeof recordEvent !== "function") {
      throw new TypeError("녹화 이벤트 처리 함수가 필요합니다.");
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
      return Boolean(target?.closest?.(`[${ignoreAttribute}]`));
    }

    function clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }

    function getPercent(position, maximum, fallback = 0) {
      const numericPosition = Number(position);
      const numericMaximum = Number(maximum);

      if (!Number.isFinite(numericPosition) || !Number.isFinite(numericMaximum)) {
        return fallback;
      }

      if (numericMaximum <= 0) {
        return fallback;
      }

      return Number(
        (clamp(numericPosition / numericMaximum, 0, 1) * 100).toFixed(
          PERCENT_PRECISION,
        ),
      );
    }

    function getPositionFromPercent(percent, maximum, fallback = 0) {
      const numericPercent = Number(percent);
      const numericMaximum = Number(maximum);

      if (Number.isFinite(numericPercent) && Number.isFinite(numericMaximum)) {
        return Math.max(0, numericMaximum) * (clamp(numericPercent, 0, 100) / 100);
      }

      const numericFallback = Number(fallback);
      return Number.isFinite(numericFallback) ? Math.max(0, numericFallback) : 0;
    }

    function getWindowScrollBounds() {
      const scrollingElement = document.scrollingElement || document.documentElement;
      const viewportWidth = window.innerWidth || scrollingElement?.clientWidth || 0;
      const viewportHeight = window.innerHeight || scrollingElement?.clientHeight || 0;

      return {
        maxX: Math.max(0, (scrollingElement?.scrollWidth || 0) - viewportWidth),
        maxY: Math.max(0, (scrollingElement?.scrollHeight || 0) - viewportHeight),
      };
    }

    function getElementScrollBounds(element) {
      return {
        maxLeft: Math.max(0, element.scrollWidth - element.clientWidth),
        maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
      };
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

    function handleClick(event) {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;

      if (!target || isIgnoredTarget(target)) {
        return;
      }

      if (isRecording() && !isReplaying()) {
        renderClickPulse(event.clientX, event.clientY);
      }

      const targetRect = target.getBoundingClientRect();
      const pointerType =
        event.pointerType || (event.sourceCapabilities?.firesTouchEvents ? "touch" : "mouse");

      recordEvent({
        type: "click",
        selector: getStableSelector(target),
        button: event.button,
        pointer: {
          xPercent: getPercent(event.clientX - targetRect.left, targetRect.width, 50),
          yPercent: getPercent(event.clientY - targetRect.top, targetRect.height, 50),
          pointerType,
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

      recordEvent({
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
        const { maxX, maxY } = getWindowScrollBounds();

        return {
          type: "scroll",
          selector: "__window__",
          scrollXPercent: getPercent(window.scrollX, maxX),
          scrollYPercent: getPercent(window.scrollY, maxY),
        };
      }

      const { maxLeft, maxTop } = getElementScrollBounds(normalizedTarget);

      return {
        type: "scroll",
        selector: getStableSelector(normalizedTarget),
        scrollLeftPercent: getPercent(normalizedTarget.scrollLeft, maxLeft),
        scrollTopPercent: getPercent(normalizedTarget.scrollTop, maxTop),
      };
    }

    function handleScroll(event) {
      if (!isRecording() || isReplaying()) {
        return;
      }

      const target = normalizeScrollTarget(event.target);
      const scrollEvent = getScrollEvent(target);
      const key = scrollEvent.selector;
      const now = performance.now();
      const lastAt = scrollLastAt.get(key) || 0;

      if (now - lastAt >= SCROLL_SAMPLE_MS) {
        scrollLastAt.set(key, now);
        recordEvent(scrollEvent, { persist: false });
      }

      window.clearTimeout(scrollTimers.get(key));
      scrollTimers.set(
        key,
        window.setTimeout(() => {
          scrollLastAt.set(key, performance.now());
          recordEvent(getScrollEvent(target));
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

    function waitForRenderFrame() {
      return new Promise((resolve) => {
        let completed = false;
        const fallbackTimer = window.setTimeout(finish, 100);

        function finish() {
          if (completed) {
            return;
          }

          completed = true;
          window.clearTimeout(fallbackTimer);
          resolve();
        }

        window.requestAnimationFrame(finish);
      });
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

    function createReplayTargetError(selector) {
      const targetSelector = String(selector || "").trim().slice(0, 180);
      return new Error(
        targetSelector
          ? `재생 대상 요소를 찾지 못했습니다. (${targetSelector})`
          : "재생 대상 요소의 선택자 정보가 없습니다.",
      );
    }

    async function playScroll(recordedEvent) {
      const target = await waitForTarget(recordedEvent.selector);

      if (target === window) {
        const { maxX, maxY } = getWindowScrollBounds();
        const left = getPositionFromPercent(
          recordedEvent.scrollXPercent,
          maxX,
          recordedEvent.scrollX,
        );
        const top = getPositionFromPercent(
          recordedEvent.scrollYPercent,
          maxY,
          recordedEvent.scrollY,
        );

        try {
          window.scrollTo({
            left,
            top,
            behavior: "smooth",
          });
        } catch (error) {
          window.scrollTo(left, top);
        }
        return;
      }

      if (!target) {
        throw createReplayTargetError(recordedEvent.selector);
      }

      const { maxLeft, maxTop } = getElementScrollBounds(target);
      const left = getPositionFromPercent(
        recordedEvent.scrollLeftPercent,
        maxLeft,
        recordedEvent.scrollLeft,
      );
      const top = getPositionFromPercent(
        recordedEvent.scrollTopPercent,
        maxTop,
        recordedEvent.scrollTop,
      );

      if (typeof target.scrollTo === "function") {
        try {
          target.scrollTo({
            left,
            top,
            behavior: "smooth",
          });
          return;
        } catch (error) {
          // Fall through for browsers that only support numeric scrollTo arguments.
        }
      }

      target.scrollLeft = left;
      target.scrollTop = top;
    }

    function playClick(target, recordedEvent) {
      const pointer = recordedEvent.pointer || {};
      const targetRect = target.getBoundingClientRect();
      const clientX = Number.isFinite(Number(pointer.xPercent))
        ? targetRect.left +
          getPositionFromPercent(pointer.xPercent, targetRect.width, targetRect.width / 2)
        : Number.isFinite(Number(pointer.clientX))
          ? Number(pointer.clientX)
          : targetRect.left + targetRect.width / 2;
      const clientY = Number.isFinite(Number(pointer.yPercent))
        ? targetRect.top +
          getPositionFromPercent(pointer.yPercent, targetRect.height, targetRect.height / 2)
        : Number.isFinite(Number(pointer.clientY))
          ? Number(pointer.clientY)
          : targetRect.top + targetRect.height / 2;
      const mouseOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: recordedEvent.button || 0,
        clientX,
        clientY,
      };
      const pointerOptions = {
        ...mouseOptions,
        isPrimary: true,
        pointerType: pointer.pointerType || "mouse",
      };

      renderClickPulse(clientX, clientY);

      for (const eventType of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        const isPointerEvent = eventType.startsWith("pointer");
        const replayEvent =
          isPointerEvent && typeof window.PointerEvent === "function"
            ? new window.PointerEvent(eventType, pointerOptions)
            : new MouseEvent(eventType, isPointerEvent ? pointerOptions : mouseOptions);

        target.dispatchEvent(replayEvent);
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

    function isCheckableInput(element) {
      return Boolean(
        element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio"),
      );
    }

    function createReplayEvents(recordedEvents) {
      const skippedEventIndexes = new Set();

      return recordedEvents
        .map((recordedEvent, eventIndex) => {
          if (skippedEventIndexes.has(eventIndex)) {
            return null;
          }

          const replayEvent = {
            ...recordedEvent,
            replaySourceEventCount: 1,
          };

          if (recordedEvent.type !== "click") {
            return replayEvent;
          }

          for (
            let relatedIndex = eventIndex + 1;
            relatedIndex < recordedEvents.length;
            relatedIndex += 1
          ) {
            const relatedEvent = recordedEvents[relatedIndex];
            const elapsedMs = Number(relatedEvent.at) - Number(recordedEvent.at);

            if (elapsedMs > CHECKABLE_EVENT_GROUP_MS || relatedEvent.type === "click") {
              break;
            }

            if (
              relatedEvent.selector === recordedEvent.selector &&
              (relatedEvent.type === "input" || relatedEvent.type === "change") &&
              typeof relatedEvent.detail?.checked === "boolean"
            ) {
              replayEvent.replayChecked = relatedEvent.detail.checked;
              replayEvent.replaySourceEventCount += 1;
              skippedEventIndexes.add(relatedIndex);
            }
          }

          return replayEvent;
        })
        .filter(Boolean);
    }

    async function playCheckableClick(target, recordedEvent) {
      const desiredChecked = recordedEvent.replayChecked;

      if (target.type === "radio" && !desiredChecked) {
        setNativeValue(target, "checked", false);
        target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        await waitForRenderFrame();
        return;
      }

      setNativeValue(target, "checked", !desiredChecked);
      playClick(target, recordedEvent);
      await waitForRenderFrame();

      const currentTarget = findTarget(recordedEvent.selector);

      if (!isCheckableInput(currentTarget) || currentTarget.checked === desiredChecked) {
        return;
      }

      setNativeValue(currentTarget, "checked", desiredChecked);
      currentTarget.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
      currentTarget.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );
      await waitForRenderFrame();
    }

    async function playEvent(recordedEvent) {
      if (recordedEvent.type === "scroll") {
        await playScroll(recordedEvent);
        return;
      }

      const target = await waitForTarget(recordedEvent.selector);

      if (!target || target === window) {
        throw createReplayTargetError(recordedEvent.selector);
      }

      if (recordedEvent.type === "click") {
        if (
          isCheckableInput(target) &&
          typeof recordedEvent.replayChecked === "boolean"
        ) {
          await playCheckableClick(target, recordedEvent);
          return;
        }

        playClick(target, recordedEvent);
        return;
      }

      if (recordedEvent.type === "input" || recordedEvent.type === "change") {
        playFormChange(target, recordedEvent);
      }
    }

    function resetScrollTracking({ preserveLastSample = false } = {}) {
      scrollTimers.forEach((timer) => window.clearTimeout(timer));
      scrollTimers.clear();

      if (!preserveLastSample) {
        scrollLastAt.clear();
      }
    }

    return Object.freeze({
      createReplayEvents,
      handleClick,
      handleFormChange,
      handleScroll,
      playEvent,
      resetScrollTracking,
      sleep,
      waitForRenderFrame,
    });
  }

  window.UserFlowRecorderEvents = Object.freeze({ create });
})();
