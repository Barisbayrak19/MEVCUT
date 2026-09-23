(() => {
  const isAcademicPage = () =>
    /https:\/\/(?:www\.)?e-okul\.meb\.gov\.tr\//i.test(location.href) &&
    /\/IlkOgretim\/OKL\/IOK09004\.aspx/i.test(location.href);

  if (!isAcademicPage()) return;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "MEVCUT'a Ders-Öğretmen Verisini Aktar";
  button.style.cssText =
    "position:fixed;right:18px;bottom:18px;z-index:2147483647;" +
    "padding:12px 16px;border:0;border-radius:10px;" +
    "background:#0f172a;color:#fff;font:700 13px system-ui;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer;";

  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Okunuyor...";

    try {
      const select = document.querySelector("#ddlSinifiSubesi");
      const selected = select?.selectedOptions?.[0];

      if (!selected || selected.value === "-1") {
        throw new Error("Önce bir sınıf/şube seçin.");
      }

      const table =
        document.querySelector("#Table5") ||
        document.querySelector("#dgListe");

      if (!table) {
        throw new Error("Ders öğretmeni listesi bulunamadı.");
      }

      const assignments = [];

      for (
        const row of [...table.querySelectorAll("tr")].slice(1)
      ) {
        const cells = [...row.querySelectorAll("td")]
          .map((td) =>
            String(td.textContent || "")
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
          className: String(
            selected.textContent || ""
          )
            .replace(/\s+/g, " ")
            .trim(),
          subjectCode:
            cells[2].toLocaleUpperCase("tr-TR"),
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

      const payload = {
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

      const encoded = btoa(
        unescape(
          encodeURIComponent(
            JSON.stringify(payload)
          )
        )
      );

      const target =
        new URL(
          "https://mevcut-33328.web.app/"
        );

      target.searchParams.set(
        "eokulImport",
        "1"
      );

      target.searchParams.set(
        "eokulAcademic",
        encoded
      );

      window.open(
        target.toString(),
        "_blank"
      );

      button.textContent =
        assignments.length +
        " eşleşme MEVCUT'a gönderildi";
    } catch (error) {
      button.disabled = false;
      button.textContent =
        "Hata: " +
        (error?.message || String(error));
    }
  });

  document.body.appendChild(button);
})();
