async function findEOkulTab(requiredPage, openIfMissing = true) {
  const tabs = await chrome.tabs.query({
    url: ["https://e-okul.meb.gov.tr/*"],
  });

  const matches = tabs.filter((tab) => {
    const url = tab.url || "";

    if (!/https:\/\/e-okul\.meb\.gov\.tr\//i.test(url)) {
      return false;
    }

    if (requiredPage === "attendance") {
      return /\/IlkOgretim\/OKL\/IOK08001\.aspx/i.test(url);
    }

    if (requiredPage === "academic") {
      return /\/IlkOgretim\/OKL\/IOK09004\.aspx/i.test(url);
    }

    return /\/IlkOgretim\/OKL\//i.test(url);
  });

  if (matches.length) {
    return matches.find((tab) => tab.active) || matches[0];
  }

  if (!openIfMissing) {
    throw new Error(
      requiredPage === "attendance"
        ? "IOK08001 e-Okul sekmesi bulunamadı."
        : requiredPage === "academic"
          ? "IOK09004 e-Okul sekmesi bulunamadı."
          : "e-Okul sekmesi bulunamadı."
    );
  }

  const url =
    requiredPage === "academic"
      ? "https://e-okul.meb.gov.tr/IlkOgretim/OKL/IOK09004.aspx"
      : "https://e-okul.meb.gov.tr/IlkOgretim/OKL/IOK08001.aspx";

  const tab = await chrome.tabs.create({
    url,
    active: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const refreshed = await chrome.tabs.get(tab.id);

  if (!refreshed?.id) {
    throw new Error("e-Okul sekmesi açılamadı.");
  }

  return refreshed;
}

async function getBridgeStatus() {
  const tabs = await chrome.tabs.query({
    url: ["https://e-okul.meb.gov.tr/*"],
  });

  return {
    extensionVersion: chrome.runtime.getManifest().version,
    eOkulTabs: tabs.map((tab) => ({
      id: tab.id,
      active: Boolean(tab.active),
      title: String(tab.title || ""),
      url: String(tab.url || ""),
    })),
    attendanceTabs: tabs.filter((tab) =>
      /\/IlkOgretim\/OKL\/IOK08001\.aspx/i.test(tab.url || "")
    ).length,
    academicTabs: tabs.filter((tab) =>
      /\/IlkOgretim\/OKL\/IOK09004\.aspx/i.test(tab.url || "")
    ).length,
  };
}

async function runMain(tabId, func, args = []) {
  const result = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func,
    args,
  });

  return result?.[0]?.result;
}

async function extractStudents() {
  const app = window.app;

  if (!app) {
    throw new Error(
      "e-Okul uygulaması bulunamadı. Öğrenci Günlük Devamsızlık Girişi sayfasını açın."
    );
  }

  const options = [...document.querySelectorAll("select option")]
    .map((option) => ({
      code: String(option.value || "").trim(),
      name: String(option.textContent || "").replace(/\s+/g, " ").trim(),
    }))
    .filter(
      (item) =>
        item.code &&
        item.code !== "-1" &&
        /Sınıf\s*\/\s*[A-ZÇĞİÖŞÜ0-9]/i.test(item.name)
    );

  const uniqueClasses = [];
  const seenClasses = new Set();

  for (const item of options) {
    if (!seenClasses.has(item.code)) {
      seenClasses.add(item.code);
      uniqueClasses.push(item);
    }
  }

  if (!uniqueClasses.length) {
    throw new Error("e-Okul sınıf/şube listesi bulunamadı.");
  }

  const post = async (method, body) => {
    const response = await fetch(
      "/IlkOgretim/OKL/IOK08001.aspx/" + method,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body),
      }
    );

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    if (!json?.d) {
      throw new Error("Geçersiz e-Okul yanıtı.");
    }

    return json.d;
  };

  const students = [];
  const errors = [];

  for (const item of uniqueClasses) {
    try {
      const response = await post("Listele", {
        donemKodu: app.donemKodu,
        subeKodu: item.code,
        tarih: app.secilenTarih,
        kurumKoduFrontend: app.kurumKodu,
      });

      const list = Array.isArray(response.Liste)
        ? response.Liste
        : [];

      for (const row of list) {
        students.push({
          studentNo: String(row.OgrNo || "").trim(),
          name: String(row.AdSoyad || "").trim(),
          tcNo: String(row.TcNo || "").trim(),
          classCode: item.code,
          className: item.name,
        });
      }
    } catch (error) {
      errors.push({
        className: item.name,
        message: String(error?.message || error),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const unique = new Map();

  for (const student of students) {
    if (!student.studentNo) continue;
    unique.set(
      student.classCode + "|" + student.studentNo,
      student
    );
  }

  return {
    mode: "students",
    organizationId: "ilk-okul",
    periodCode: String(app.donemKodu || ""),
    institutionCode: String(app.kurumKodu || ""),
    importedAt: new Date().toISOString(),
    classes: uniqueClasses,
    students: [...unique.values()],
    assignments: [],
    schedules: [],
    errors,
  };
}

function extractAcademic() {
  if (!/\/IlkOgretim\/OKL\/IOK09004\.aspx/i.test(location.pathname)) {
    throw new Error("IOK09004 Ders Öğretmenleri sayfası açık değil.");
  }

  const select = document.querySelector("#ddlSinifiSubesi");
  const selected = select?.selectedOptions?.[0];

  if (!selected || selected.value === "-1") {
    throw new Error("Önce e-Okul'da bir sınıf/şube seçin.");
  }

  const table =
    document.querySelector("#Table5") ||
    document.querySelector("#dgListe");

  if (!table) {
    throw new Error("Ders öğretmeni listesi bulunamadı.");
  }

  const assignments = [];

  for (const row of [...table.querySelectorAll("tr")].slice(1)) {
    const cells = [...row.querySelectorAll("td")]
      .map((cell) =>
        String(cell.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      );

    if (
      cells.length < 3 ||
      !/\d{8,11}/.test(cells[0])
    ) {
      continue;
    }

    assignments.push({
      classCode: String(selected.value),
      className: String(selected.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
      subjectCode: cells[2].toLocaleUpperCase("tr-TR"),
      subjectName: cells[2],
      teacherName: cells[1],
      source: "e-okul",
    });
  }

  const unique = new Map();

  for (const item of assignments) {
    unique.set(
      item.classCode +
        "|" +
        item.subjectName +
        "|" +
        item.teacherName,
      item
    );
  }

  return {
    mode: "academic",
    organizationId: "ilk-okul",
    periodCode: "",
    institutionCode: "",
    importedAt: new Date().toISOString(),
    classes: [],
    students: [],
    assignments: [...unique.values()],
    schedules: [],
    errors: [],
  };
}

async function sendAttendanceToEOkul(attendance) {
  if (!attendance) {
    throw new Error("Gönderilecek yoklama verisi bulunamadı.");
  }

  const app = window.app;

  if (!app) {
    throw new Error("e-Okul Vue uygulaması bulunamadı.");
  }

  if (!app.donemKodu || !app.kurumKodu) {
    throw new Error(
      "e-Okul başlangıç bilgileri henüz yüklenmemiş. Sayfanın tamamen açılmasını bekleyin."
    );
  }

  const isoToTR = (value) => {
    const parts = String(value).split("-");
    if (parts.length !== 3) {
      throw new Error("Geçersiz tarih: " + value);
    }
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  };

  const post = async (method, body) => {
    const response = await fetch(
      "/IlkOgretim/OKL/IOK08001.aspx/" + method,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      }
    );

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    if (!json?.d) {
      throw new Error("Geçersiz e-Okul yanıtı.");
    }

    return json.d;
  };

  const date = isoToTR(attendance.date);

  if (
    attendance.records.some(
      (record) => record.status === "unknown"
    )
  ) {
    throw new Error(
      "Bilinmiyor durumundaki öğrenciler e-Okul'a otomatik gönderilemez."
    );
  }

  const response = await post("Listele", {
    donemKodu: app.donemKodu,
    subeKodu: attendance.classCode,
    tarih: date,
    kurumKoduFrontend: app.kurumKodu,
  });

  if (!response.Basarili) {
    throw new Error(
      response.Mesaj || "e-Okul yoklama listesi alınamadı."
    );
  }

  const list = Array.isArray(response.Liste)
    ? response.Liste
    : [];

  if (!list.length) {
    throw new Error("e-Okul bu sınıf/tarih için öğrenci listesi döndürmedi.");
  }

  const wanted = new Map(
    attendance.records.map((record) => [
      String(record.studentNo).trim(),
      record.status,
    ])
  );

  const locked = [];
  let changed = 0;

  for (const row of list) {
    const studentNo = String(row.OgrNo || "").trim();
    const target = wanted.get(studentNo);

    if (!target) continue;

    const current =
      row.ChkTamGun
        ? "full_day"
        : row.ChkYarimGun
          ? "half_day"
          : row.ChkGec
            ? "late"
            : "present";

    if (current === target) continue;

    if (row.IsLocked) {
      locked.push(studentNo);
      continue;
    }

    row.ChkTamGun = target === "full_day";
    row.ChkYarimGun = target === "half_day";
    row.ChkGec = target === "late";
    row.Degisti = true;
    changed++;
  }

  if (locked.length) {
    throw new Error(
      "e-Okul tarafından kilitli öğrenciler değiştirilemedi: " +
        locked.join(", ")
    );
  }

  if (changed === 0) {
    return {
      success: true,
      changed: 0,
      message: "e-Okul'daki kayıtlar zaten MEVCUT ile aynı.",
    };
  }

  const saveResponse = await post("Kaydet", {
    kayitlar: list,
    donemKodu: app.donemKodu,
    tarih: date,
    kurumKoduFrontend: app.kurumKodu,
  });

  if (!saveResponse.Basarili) {
    throw new Error(
      saveResponse.Mesaj || "e-Okul kayıt işlemi başarısız."
    );
  }

  return {
    success: true,
    changed,
    message: saveResponse.Mesaj || "Yoklama e-Okul'a kaydedildi.",
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !message ||
    message.type !== "MEVCUT_EOKUL_COMMAND"
  ) {
    return;
  }

  (async () => {
    try {
      if (!sender.tab?.id) {
        throw new Error("MEVCUT sekmesi bulunamadı.");
      }

      if (message.action === "CHECK_STATUS") {
        const status = await getBridgeStatus();
        sendResponse({
          ok: true,
          payload: status,
        });
        return;
      }

      if (
        message.action === "SYNC_STUDENTS"
      ) {
        const tab = await findEOkulTab("attendance");
        const payload = await runMain(tab.id, extractStudents);

        sendResponse({
          ok: true,
          payload,
        });
        return;
      }

      if (
        message.action === "SYNC_ACADEMIC"
      ) {
        const tab = await findEOkulTab("academic");
        const payload = await runMain(tab.id, extractAcademic);

        sendResponse({
          ok: true,
          payload,
        });
        return;
      }

      if (
        message.action === "SEND_ATTENDANCE"
      ) {
        const tab = await findEOkulTab("attendance");
        const result = await runMain(
          tab.id,
          sendAttendanceToEOkul,
          [message.payload?.attendance]
        );

        sendResponse({
          ok: true,
          payload: result,
        });
        return;
      }

      throw new Error("Bilinmeyen e-Okul komutu.");
    } catch (error) {
      sendResponse({
        ok: false,
        error: String(error?.message || error),
      });
    }
  })();

  return true;
});
