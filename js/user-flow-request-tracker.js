(() => {
  "use strict";

  if (window.UserFlowRequestTracker) {
    return;
  }

  const AUTO_REQUEST_TRACKING_MARKER = Symbol.for(
    "response-mapping-user-flow-auto-request-tracking",
  );
  const XHR_REQUEST_META = Symbol.for(
    "response-mapping-user-flow-xhr-request-meta",
  );

  function create(options = {}) {
    const requestStart = options.requestStart;
    const requestEnd = options.requestEnd;
    const trackedFetchResponses = new WeakSet();

    if (typeof requestStart !== "function" || typeof requestEnd !== "function") {
      throw new TypeError("통신 시작 및 종료 처리 함수가 필요합니다.");
    }

    function getRequestId(type, method, requestUrl) {
      const normalizedMethod =
        String(method || "GET").trim().toUpperCase() || "GET";
      let normalizedUrl = String(requestUrl || "").trim();

      try {
        const parsedUrl = new URL(normalizedUrl, window.location.href);
        normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
      } catch (error) {
        normalizedUrl ||= "unknown";
      }

      return `${type}:${normalizedMethod}:${normalizedUrl}`;
    }

    function getRejectedRequestInfo(error) {
      return {
        message: error?.message || "통신 요청에 실패했습니다.",
        ok: false,
        status: 0,
      };
    }

    function trackFetchResponseBody(response, requestId) {
      if (!response || trackedFetchResponses.has(response)) {
        return;
      }

      trackedFetchResponses.add(response);

      ["arrayBuffer", "blob", "formData", "json", "text", "clone"].forEach((methodName) => {
        const originalMethod = response[methodName];

        if (typeof originalMethod !== "function") {
          return;
        }

        try {
          Object.defineProperty(response, methodName, {
            configurable: true,
            writable: true,
            value: function (...args) {
              if (methodName === "clone") {
                const clonedResponse = Reflect.apply(originalMethod, this, args);
                trackFetchResponseBody(clonedResponse, requestId);
                return clonedResponse;
              }

              const bodyRequestId = requestStart(requestId);
              let bodyPromise;

              try {
                bodyPromise = Reflect.apply(originalMethod, this, args);
              } catch (error) {
                requestEnd(bodyRequestId);
                throw error;
              }

              return Promise.resolve(bodyPromise).then(
                (body) => {
                  requestEnd(bodyRequestId);
                  return body;
                },
                (error) => {
                  requestEnd(bodyRequestId);
                  throw error;
                },
              );
            },
          });
        } catch (error) {
          // Leave non-configurable response methods unchanged.
        }
      });
    }

    function installFetchTracking() {
      const originalFetch = window.fetch;

      if (
        typeof originalFetch !== "function" ||
        originalFetch[AUTO_REQUEST_TRACKING_MARKER]
      ) {
        return false;
      }

      function trackedFetch(input, init) {
        const isRequest =
          typeof window.Request === "function" && input instanceof window.Request;
        const method = init?.method || (isRequest ? input.method : "GET");
        const requestUrl = isRequest ? input.url : input;
        const requestId = requestStart(getRequestId("fetch", method, requestUrl));
        let fetchPromise;

        try {
          fetchPromise = Reflect.apply(originalFetch, window, [input, init]);
        } catch (error) {
          requestEnd(requestId, getRejectedRequestInfo(error));
          throw error;
        }

        return Promise.resolve(fetchPromise).then(
          (response) => {
            trackFetchResponseBody(
              response,
              getRequestId("fetch-body", method, requestUrl),
            );
            requestEnd(requestId, response);
            return response;
          },
          (error) => {
            requestEnd(requestId, getRejectedRequestInfo(error));
            throw error;
          },
        );
      }

      Object.defineProperty(trackedFetch, AUTO_REQUEST_TRACKING_MARKER, {
        value: true,
      });
      window.fetch = trackedFetch;
      return true;
    }

    function getXhrResponseInfo(xhr, eventType) {
      if (["abort", "error", "timeout"].includes(eventType)) {
        return {
          message:
            eventType === "abort"
              ? "통신 요청이 취소되었습니다."
              : eventType === "timeout"
                ? "통신 요청 시간이 초과되었습니다."
                : "통신 요청에 실패했습니다.",
          ok: false,
          status: 0,
        };
      }

      try {
        return {
          status: xhr.status,
          statusText: xhr.statusText,
        };
      } catch (error) {
        return { status: 0 };
      }
    }

    function installXhrTracking() {
      const XhrConstructor = window.XMLHttpRequest;

      if (typeof XhrConstructor !== "function") {
        return false;
      }

      const xhrPrototype = XhrConstructor.prototype;
      const originalOpen = xhrPrototype.open;
      const originalSend = xhrPrototype.send;

      if (
        typeof originalOpen !== "function" ||
        typeof originalSend !== "function" ||
        originalSend[AUTO_REQUEST_TRACKING_MARKER]
      ) {
        return false;
      }

      function trackedOpen(method, requestUrl, ...rest) {
        this[XHR_REQUEST_META] = {
          method: method || "GET",
          url: requestUrl,
        };
        return Reflect.apply(originalOpen, this, [method, requestUrl, ...rest]);
      }

      function trackedSend(...args) {
        const requestMeta = this[XHR_REQUEST_META] || {};
        const requestId = requestStart(
          getRequestId("xhr", requestMeta.method, requestMeta.url),
        );
        const xhr = this;
        const completionEvents = ["load", "error", "abort", "timeout", "loadend"];
        let completed = false;

        function finish(event) {
          if (completed) {
            return;
          }

          completed = true;
          completionEvents.forEach((eventName) =>
            xhr.removeEventListener(eventName, finish),
          );
          requestEnd(requestId, getXhrResponseInfo(xhr, event?.type || "error"));
        }

        completionEvents.forEach((eventName) =>
          xhr.addEventListener(eventName, finish),
        );

        try {
          return Reflect.apply(originalSend, xhr, args);
        } catch (error) {
          finish({ type: "error" });
          throw error;
        }
      }

      Object.defineProperty(trackedSend, AUTO_REQUEST_TRACKING_MARKER, {
        value: true,
      });
      xhrPrototype.open = trackedOpen;
      xhrPrototype.send = trackedSend;
      return true;
    }

    function install() {
      try {
        installFetchTracking();
      } catch (error) {
        console.warn(
          "UserFlowRecorder: fetch 통신 감지를 설치하지 못했습니다.",
          error,
        );
      }

      try {
        installXhrTracking();
      } catch (error) {
        console.warn(
          "UserFlowRecorder: Ajax 통신 감지를 설치하지 못했습니다.",
          error,
        );
      }
    }

    return Object.freeze({ install });
  }

  window.UserFlowRequestTracker = Object.freeze({ create });
})();
