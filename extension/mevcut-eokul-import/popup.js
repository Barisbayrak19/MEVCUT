const pageEl = document.getElementById("page");
const infoEl = document.getElementById("info");
const startEl = document.getElementById("start");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

let eOkulTabId = null;

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = "status " + cls;
}

async function findTabs() {
  const tabs = await chrome.tabs.query({});
  const isEOkul = (url = "") =>
    /^https:\/\/(?:www\.)?e-okul\.meb\.gov\.tr\//i.test(url) &&
    /\/IlkOgretim\/OKL\//i.test(url);

  const eOkul = tabs.find(t => isEOkul(t.url));
  const mevcut = tabs.find(t => /^https:\/\/mevcut-33328\.web\.app\//i.test(t.url || ""));
  return { eOkul, mevcut };
}

async function check() {
  try {
    pageEl.textContent = "Kontrol ediliyor...";

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    const isEOkul = (url = "") =>
      /^https:\/\/(?:www\.)?e-okul\.meb\.gov\.tr\//i.test(url) &&
      /\/IlkOgretim\/OKL\//i.test(url);

    let eOkul;
    if (isEOkul(activeTab?.url)) {
      eOkul = activeTab;
    } else {
      ({ eOkul } = await findTabs());
    }

    if (!eOkul) {
      pageEl.textContent = "e-Okul sekmesi bulunamadı.";
      infoEl.textContent = "e-Okul'da Öğrenci Günlük Devamsızlık Girişi sayfasını açın.";
      startEl.disabled = true;
      return;
    }

    eOkulTabId = eOkul.id;

    const { mevcut } = await findTabs();
    pageEl.textContent = "e-Okul hazır.";
    infoEl.textContent = mevcut
      ? "MEVCUT sekmesi de açık. Veriler doğrudan aktarılacak."
      : "MEVCUT sekmesi bulunamadı; aktarım sırasında açılacak.";
    startEl.disabled = false;
  } catch (error) {
    pageEl.textContent = "Kontrol başarısız.";
    infoEl.textContent = error?.message || String(error);
    setStatus("Hata: " + (error?.message || error), "error");
    startEl.disabled = true;
  }
}

startEl.addEventListener("click", async () => {
  startEl.disabled = true;
  resultEl.textContent = "";
  setStatus("e-Okul verileri okunuyor...");

  try {
    if (!eOkulTabId) throw new Error("e-Okul sekmesi bulunamadı.");

    const serialized = JSON.stringify(payload);
    if (serialized.length > 4500000) {
      throw new Error("Aktarım verisi tarayıcı depolama sınırını aşıyor.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: mevcutTabId },
      world: "MAIN",
      func: (data) => {
        sessionStorage.setItem("mevcut-eokul-import", JSON.stringify(data));
        const target = new URL("https://mevcut-33328.web.app/");
        target.searchParams.set("eokulImport", "1");
        window.location.href = target.toString();
      },
      args: [payload]
    });

    setStatus("Veriler MEVCUT\'a gönderildi. Aktarım sayfası açılıyor...", "ok");
    resultEl.textContent = payload.errors.length
      ? `${payload.errors.length} sınıfta okuma hatası oluştu.`
      : "MEVCUT aktarımı başlatıldı.";
    resultEl.textContent = payload.errors.length
      ? `${payload.errors.length} sınıfta okuma hatası oluştu; MEVCUT sonuç ekranında ayrıca gösterilecek.`
      : "Aktarım tamamlandı.";
  } catch (error) {
    setStatus("Hata: " + (error?.message || error), "error");
  } finally {
    startEl.disabled = false;
  }
});

check();
