(() => {
  const isAcademicPage = () =>
    /https:\/\/(?:www\.)?e-okul\.meb\.gov\.tr\//i.test(
      location.href
    ) &&
    /\/IlkOgretim\/OKL\/IOK09004\.aspx/i.test(
      location.href
    );

  if (!isAcademicPage()) return;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent =
    "MEVCUT'a Ders-Öğretmen Verisini Aktar";
  button.style.cssText =
    "position:fixed;right:18px;bottom:18px;z-index:2147483647;" +
    "padding:12px 16px;border:0;border-radius:10px;" +
    "background:#0f172a;color:#fff;font:700 13px system-ui;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;";

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Aktarılıyor...";

    try {
      const payload = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "MEVCUT_READ_ACADEMIC" },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(
                new Error(
                  chrome.runtime.lastError.message
                )
              );
              return;
            }

            if (!response?.ok) {
              reject(
                new Error(
                  response?.error ||
                  "Akademik veri okunamadı."
                )
              );
              return;
            }

            resolve(response.payload);
          }
        );
      });

      await chrome.runtime.sendMessage({
        type: "MEVCUT_SEND_ACADEMIC",
        payload,
      });

      button.textContent = "MEVCUT'a gönderildi";
    } catch (error) {
      button.disabled = false;
      button.textContent =
        "Hata: " +
        (error?.message || String(error));
    }
  });

  document.body.appendChild(button);
})();
