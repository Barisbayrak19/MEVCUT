(() => {
  if (location.origin !== "https://mevcut-33328.web.app") return;

  const sendResult = (detail) => {
    window.postMessage(
      {
        source: "MEVCUT_EXTENSION",
        type: "MEVCUT_EOKUL_RESULT",
        ...detail,
      },
      location.origin
    );
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const message = event.data;
    if (
      !message ||
      message.source !== "MEVCUT" ||
      message.type !== "MEVCUT_EOKUL_COMMAND"
    ) {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "MEVCUT_EOKUL_COMMAND",
        action: message.action,
        requestId: message.requestId,
        payload: message.payload || {},
      },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResult({
            requestId: message.requestId,
            action: message.action,
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        sendResult({
          requestId: message.requestId,
          action: message.action,
          ...(response || {
            ok: false,
            error: "Extension yanıt vermedi.",
          }),
        });
      }
    );
  });

  window.postMessage(
    {
      source: "MEVCUT_EXTENSION",
      type: "MEVCUT_EOKUL_EXTENSION_READY",
    },
    location.origin
  );
})();
