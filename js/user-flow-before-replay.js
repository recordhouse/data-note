(() => {
  "use strict";

  if (window.UserFlowBeforeReplay) {
    return;
  }

  const DEFAULT_ELEMENT_TIMEOUT_MS = 15000;
  const DEFAULT_PAGE_TIMEOUT_MS = 60000;
  const DEFAULT_NETWORK_TIMEOUT_MS = 180000;
  const DEFAULT_NETWORK_IDLE_MS = 500;
  const DEFAULT_PAGE_SETTLE_MS = 800;
  const POLL_INTERVAL_MS = 50;

  function normalizeSelector(value) {
    return String(value || "").trim();
  }

  function normalizeConfig(config) {
    const selectors = config?.selectors || {};
    return Object.freeze({
      url: String(config?.url || "").trim(),
      selectors: Object.freeze({
        select: normalizeSelector(selectors.select),
        firstButton: normalizeSelector(selectors.firstButton),
        input: normalizeSelector(selectors.input),
        submitButton: normalizeSelector(selectors.submitButton),
      }),
    });
  }

  function isConfigured(config) {
    return Boolean(normalizeConfig(config).url);
  }

  function extractValue(title) {
    const matches = String(title || "").matchAll(/\(([A-Z][^()]*)\)/g);

    for (const match of matches) {
      return match[1];
    }

    return "";
  }

  function delay(durationMs) {
    return new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }

  function getTargetSnapshot(targetWindow) {
    if (!targetWindow || targetWindow.closed) {
      throw new Error("재생할 사이트 창이 닫혀 있습니다.");
    }

    try {
      return {
        document: targetWindow.document,
        href: targetWindow.location.href,
      };
    } catch (error) {
      throw new Error("재생 전 작업 페이지에 접근할 수 없습니다.");
    }
  }

  async function waitFor(getValue, timeoutMs, timeoutMessage) {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const value = getValue();

      if (value) {
        return value;
      }

      await delay(POLL_INTERVAL_MS);
    }

    throw new Error(timeoutMessage);
  }

  function resolvePreparationUrl(config, baseUrl = window.location.href) {
    const normalizedConfig = normalizeConfig(config);
    let targetUrl;

    try {
      targetUrl = new URL(normalizedConfig.url, baseUrl);
    } catch (error) {
      throw new Error("재생 전 작업 주소가 올바르지 않습니다.");
    }

    const baseOrigin = new URL(baseUrl).origin;

    if (
      !["http:", "https:"].includes(targetUrl.protocol) ||
      targetUrl.origin !== baseOrigin
    ) {
      throw new Error("재생 전 작업 주소는 Data Note와 같은 사이트여야 합니다.");
    }

    return targetUrl;
  }

  async function waitForPage(targetWindow, timeoutMs) {
    return waitFor(
      () => {
        const snapshot = getTargetSnapshot(targetWindow);
        const readyState = snapshot.document?.readyState;
        return readyState === "interactive" || readyState === "complete"
          ? snapshot
          : null;
      },
      timeoutMs,
      "재생 전 작업 페이지를 불러오지 못했습니다.",
    );
  }

  async function waitForStablePage(targetWindow, timeoutMs, settleMs) {
    const startedAt = Date.now();
    let previousDocument = null;
    let previousHref = "";
    let stableStartedAt = 0;

    while (Date.now() - startedAt <= timeoutMs) {
      const snapshot = getTargetSnapshot(targetWindow);
      const ready = ["interactive", "complete"].includes(
        snapshot.document?.readyState,
      );

      if (
        ready &&
        snapshot.document === previousDocument &&
        snapshot.href === previousHref
      ) {
        stableStartedAt ||= Date.now();

        if (Date.now() - stableStartedAt >= settleMs) {
          return snapshot;
        }
      } else {
        previousDocument = snapshot.document;
        previousHref = snapshot.href;
        stableStartedAt = ready ? Date.now() : 0;
      }

      await delay(POLL_INTERVAL_MS);
    }

    throw new Error("재생 전 작업 결과 페이지가 안정화되지 않았습니다.");
  }

  function queryTarget(targetWindow, selector) {
    try {
      return targetWindow.document.querySelector(selector);
    } catch (error) {
      throw new Error(`재생 전 작업 셀렉터가 올바르지 않습니다: ${selector}`);
    }
  }

  async function waitForElement(
    targetWindow,
    selector,
    label,
    timeoutMs,
    predicate = (element) => Boolean(element),
  ) {
    if (!selector) {
      throw new Error(`${label} 셀렉터가 설정되지 않았습니다.`);
    }

    return waitFor(
      () => {
        const element = queryTarget(targetWindow, selector);
        return predicate(element) ? element : null;
      },
      timeoutMs,
      `${label} 요소를 찾지 못했습니다: ${selector}`,
    );
  }

  function dispatchFormEvent(targetWindow, element, type) {
    const EventConstructor = targetWindow.Event || Event;
    element.dispatchEvent(new EventConstructor(type, { bubbles: true }));
  }

  function selectThirdOption(targetWindow, selectElement) {
    const option = selectElement.options?.[2];

    if (!option) {
      throw new Error("지정한 셀렉트 박스에 세 번째 항목이 없습니다.");
    }

    selectElement.selectedIndex = 2;
    dispatchFormEvent(targetWindow, selectElement, "input");
    dispatchFormEvent(targetWindow, selectElement, "change");
  }

  function setInputValue(targetWindow, inputElement, value) {
    let prototype = Object.getPrototypeOf(inputElement);
    let valueSetter = null;

    while (prototype && !valueSetter) {
      valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      prototype = Object.getPrototypeOf(prototype);
    }

    if (valueSetter) {
      valueSetter.call(inputElement, value);
    } else {
      inputElement.value = value;
    }

    dispatchFormEvent(targetWindow, inputElement, "input");
    dispatchFormEvent(targetWindow, inputElement, "change");
  }

  function interceptDialogs(targetWindow) {
    const dialogDocument = getTargetSnapshot(targetWindow).document;
    const originalAlert = targetWindow.alert;
    const originalConfirm = targetWindow.confirm;
    const automaticAlert = () => undefined;
    const automaticConfirm = () => true;
    const restore = () => {
      try {
        if (targetWindow.document !== dialogDocument) {
          return;
        }

        targetWindow.alert = originalAlert;
        targetWindow.confirm = originalConfirm;
      } catch (error) {
        // Navigation replaces the old page and its dialog functions anyway.
      }
    };

    try {
      targetWindow.alert = automaticAlert;
      targetWindow.confirm = automaticConfirm;

      if (
        targetWindow.alert !== automaticAlert ||
        targetWindow.confirm !== automaticConfirm
      ) {
        throw new Error("브라우저 알림 자동 확인을 적용하지 못했습니다.");
      }
    } catch (error) {
      restore();
      throw new Error("브라우저 알림을 자동으로 확인할 수 없습니다.");
    }

    return restore;
  }

  async function waitForNetworkIdle(
    targetWindow,
    { idleMs, timeoutMs },
  ) {
    const recorder = await waitFor(
      () => getTargetSnapshot(targetWindow) && targetWindow.UserFlowRecorder,
      Math.min(DEFAULT_PAGE_TIMEOUT_MS, timeoutMs),
      "재생 전 작업 페이지의 통신 감지 기능을 불러오지 못했습니다.",
    );
    const completed = await recorder.waitForRequests({
      idleMs,
      includeIgnoredRequests: false,
      timeoutMs,
    });

    if (!completed) {
      throw new Error("재생 전 작업의 통신 대기 시간이 초과되었습니다.");
    }
  }

  async function run({
    baseUrl = window.location.href,
    config,
    elementTimeoutMs = DEFAULT_ELEMENT_TIMEOUT_MS,
    networkIdleMs = DEFAULT_NETWORK_IDLE_MS,
    networkTimeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
    pageSettleMs = DEFAULT_PAGE_SETTLE_MS,
    pageTimeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
    targetWindow,
    value,
  } = {}) {
    const normalizedConfig = normalizeConfig(config);
    const normalizedValue = String(value || "");

    if (!normalizedValue || !/^[A-Z]/.test(normalizedValue)) {
      throw new Error("로그 제목에서 대문자 영어로 시작하는 괄호 값을 찾지 못했습니다.");
    }

    const preparationUrl = resolvePreparationUrl(normalizedConfig, baseUrl);
    const currentSnapshot = getTargetSnapshot(targetWindow);

    if (currentSnapshot.href !== preparationUrl.href) {
      targetWindow.location.replace(preparationUrl.href);
    }

    await waitForPage(targetWindow, pageTimeoutMs);
    const selectElement = await waitForElement(
      targetWindow,
      normalizedConfig.selectors.select,
      "셀렉트 박스",
      elementTimeoutMs,
      (element) => Boolean(element?.options?.[2] && !element.disabled),
    );
    selectThirdOption(targetWindow, selectElement);

    const restoreDialogs = interceptDialogs(targetWindow);

    try {
      const firstButton = await waitForElement(
        targetWindow,
        normalizedConfig.selectors.firstButton,
        "첫 번째 버튼",
        elementTimeoutMs,
        (element) => Boolean(element && !element.disabled),
      );
      firstButton.click();

      const inputElement = await waitForElement(
        targetWindow,
        normalizedConfig.selectors.input,
        "입력창",
        elementTimeoutMs,
        (element) => Boolean(element && !element.disabled),
      );
      inputElement.click();
      inputElement.focus?.();
      setInputValue(targetWindow, inputElement, normalizedValue);

      const submitButton = await waitForElement(
        targetWindow,
        normalizedConfig.selectors.submitButton,
        "마지막 버튼",
        elementTimeoutMs,
        (element) => Boolean(element && !element.disabled),
      );
      submitButton.click();

      await waitForStablePage(targetWindow, pageTimeoutMs, pageSettleMs);
      await waitForNetworkIdle(targetWindow, {
        idleMs: networkIdleMs,
        timeoutMs: networkTimeoutMs,
      });
    } finally {
      restoreDialogs();
    }

    return Object.freeze({
      preparationUrl: preparationUrl.href,
      value: normalizedValue,
    });
  }

  window.UserFlowBeforeReplay = Object.freeze({
    extractValue,
    isConfigured,
    normalizeConfig,
    resolvePreparationUrl,
    run,
  });
})();
