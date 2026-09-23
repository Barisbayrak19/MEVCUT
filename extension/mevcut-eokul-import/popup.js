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
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    const isEOkul = (url = "") =>
      /^https:\/\/(?:www\.)?e-okul\.meb\.gov\.tr\//i.test(url) &&
      /\/IlkOgretim\/OKL\//i.test(url);

    let eOkul;
    if (isEOkul(activeTab?.url)) eOkulTab;
    else ({ eOkul } = await findTabs());

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

    const extracted = await chrome.scripting.executeScript({
      target: { tabId: eOkulTabId },
      world: "MAIN",
      func: async () => {
        const app = window.app;
        if (!app) throw new Error("e-Okul uygulaması bulunamadı. Öğrenci Günlük Devamsızlık Girişi sayfasını açın.");

        const options = [...document.querySelectorAll("select option")]
          .map(o => ({
            code: String(o.value || "").trim(),
            name: String(o.textContent || "").replace(/\s+/g, " ").trim()
          }))
          .filter(x => x.code && x.code !== "-1" && /Sınıf\s*\/\s*[A-ZÇĞİÖŞÜ0-9]/i.test(x.name));

        const seen = new Set();
        const classes = options.filter(x => !seen.has(x.code) && seen.add(x.code));
        if (!classes.length) throw new Error("e-Okul sınıf/şube listesi bulunamadı.");

        const post = async (method, body) => {
          const r = await fetch("/IlkOgretim/OKL/IOK08001.aspx/" + method, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify(body)
          });
          const j = await r.json().catch(() => null);
          if (!r.ok) throw new Error("HTTP " + r.status);
          if (!j?.d) throw new Error("Geçersiz e-Okul yanıtı.");
          return j.d;
        };

        const students = [];
        const errors = [];

        for (const item of classes) {
          try {
            const response = await post("Listele", {
              donemKodu: app.donemKodu,
              subeKodu: item.code,
              tarih: app.secilenTarih,
              kurumKoduFrontend: app.kurumKodu
            });
            const list = Array.isArray(response.Liste) ? response.Liste : [];
            for (const row of list) {
              students.push({
                studentNo: String(row.OgrNo || "").trim(),
                name: String(row.AdSoyad || "").trim(),
                tcNo: String(row.TcNo || "").trim(),
                classCode: item.code,
                className: item.name
              });
            }
          } catch (error) {
            errors.push({ className: item.name, message: String(error?.message || error) });
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const unique = new Map();
        for (const student of students) {
          if (!student.studentNo) continue;
          unique.set(student.classCode + "|" + student.studentNo, student);
        }

        return {
          organizationId: "ilk-okul",
          periodCode: String(app.donemKodu || ""),
          institutionCode: String(app.kurumKodu || ""),
          importedAt: new Date().toISOString(),
          classes,
          students: [...unique.values()],
          errors
        };
      }
    });

    const payload = extracted?.[0]?.result;
    if (!payload) throw new Error("e-Okul verisi alınamadı.");

    setStatus(`${payload.classes.length} sınıf bulundu, ${payload.students.length} öğrenci bulundu. MEVCUT'a aktarılıyor...`);

    const { mevcut } = await findTabs();
    let mevcutTabId = mevcut?.id;

    if (!mevcutTabId) {
      const created = await chrome.tabs.create({ url: "https://mevcut-33328.web.app/" });
      mevcutTabId = created.id;
      await new Promise(resolve => {
        const listener = (tabId, changeInfo) => {
          if (tabId === mevcutTabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener();
      });
    }

    const serialized = JSON.stringify (payload);
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

    setStatus("Veriler MEVCUT'a gönderildi. Aktarım sayfası açılıyor...", "ok");
    resultEl.textContent = payload.errors.length
      ? `${payload.errors.length} sınıfta okuma hatası oluştu.`
      : "MEVCUT aktarımı başlatıldı.";
  } catch (error) {
    setStatus("Hata: " + (error?.message || error), "error");
  } finally {
    startEl.disabled = false;
  }
});

check();