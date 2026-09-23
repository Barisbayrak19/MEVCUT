function readMevcutAcademicData() {
  const select = document.querySelector("#ddlSinifiSubesi");
  const selected = select?.selectedOptions?.[0];

  if (!selected || selected.value === "-1") {
    throw new Error("Önce IOK09004 ekranında bir sınıf/şube seçin.");
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
      .map((td) =>
        String(td.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      );

    if (cells.length < 3) continue;
    if (!/\d{8,11}/.test(cells[0])) continue;

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
      item.classCode + "|" + item.subjectName + "|" + item.teacherName,
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

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type !== "MEVCUT_READ_ACADEMIC") return;

    try {
      sendResponse({
        ok: true,
        payload: readMevcutAcademicData(),
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || String(error),
      });
    }

    return true;
  }
);
