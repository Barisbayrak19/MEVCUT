import { useEffect, useState } from "react";
import { useAuth } from "./context/AuthContext";
import { importEOkulData } from "./firebase/school";
import type { EOkulImportPayload } from "./types/school";

const stats = [
  { label: "Bugünkü Yoklama", value: "0", icon: "✓" },
  { label: "Bekleyen", value: "0", icon: "◷" },
  { label: "İşlenen", value: "0", icon: "↗" },
  { label: "Hata", value: "0", icon: "!" },
];

type ImportPayload = EOkulImportPayload & {
  errors?: { className: string; message: string }[];
};

function EOkulTransferView() {
  const { profile, loading: authLoading, profileError } = useAuth();
  const [status, setStatus] = useState("Chrome eklentisi bekleniyor.");
  const [summary, setSummary] = useState<{ classes: number; students: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;

    const processPayload = async (payload: ImportPayload) => {
      if (!profile) {
        setStatus("Kullanıcı profili kullanılamıyor.");
        setError(profileError || "MEVCUT kullanıcı profili yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.");
        return;
      }
      if (!payload?.classes?.length && !payload?.students?.length) return;
      setError("");
      setStatus("e-Okul verileri Firestore'a aktarılıyor...");
      try {
        const result = await importEOkulData({
          organizationId: profile?.organizationId || payload.organizationId || "ilk-okul",
          periodCode: payload.periodCode,
          institutionCode: payload.institutionCode,
          importedAt: payload.importedAt,
          classes: payload.classes || [],
          students: payload.students || [],
        });
        if (cancelled) return;
        setSummary({ classes: result.classCount, students: result.studentCount });
        setStatus("Aktarım tamamlandı.");
        if (payload.errors?.length) {
          setError(payload.errors.map(x => x.className + ": " + x.message).join("\n"));
        }
        sessionStorage.removeItem("mevcut-eokul-import");
      } catch (err) {
        if (cancelled) return;
        setStatus("Aktarım başarısız.");
        const e = err as { code?: string; name?: string; message?: string };
        setError(
          [e?.code, e?.name, e?.message || String(err)]
            .filter(Boolean)
            .join(" — ")
        );
      }
    };

    const fromStorage = sessionStorage.getItem("mevcut-eokul-import");
    if (fromStorage) {
      try {
        void processPayload(JSON.parse(fromStorage) as ImportPayload);
      } catch {
        sessionStorage.removeItem("mevcut-eokul-import");
        setStatus("Aktarım verisi okunamadı.");
        setError("MEVCUT'a gönderilen e-Okul verisi geçersiz.");
      }
    }

    const handler = (event: Event) => {
      const payload = (event as CustomEvent<ImportPayload>).detail;
      if (payload) void processPayload(payload);
    };
    window.addEventListener("mevcut-eokul-import", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("mevcut-eokul-import", handler);
    };
  }, [authLoading, profile?.organizationId, profileError]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div><h3>e-Okul Veri Aktarımı</h3><p>Sınıf ve öğrenci listesini e-Okul'dan MEVCUT'a al.</p></div>
        <span className="status-badge">{status}</span>
      </div>
      <div className="empty-state">
        <div className="empty-icon">↕</div>
        <strong>{summary ? "Aktarım tamamlandı" : "Chrome eklentisi ile veri al"}</strong>
        <p>{summary ? "e-Okul verileri Firestore'a kaydedildi." : "e-Okul'da Öğrenci Günlük Devamsızlık Girişi sayfasını açın, ardından MEVCUT e-Okul Veri Aktarımı eklentisinden aktarımı başlatın."}</p>
        {summary && <div className="import-summary"><strong>{summary.classes}</strong> sınıf · <strong>{summary.students}</strong> öğrenci aktarıldı.</div>}
        {error && <pre className="import-error">{error}</pre>}
      </div>
    </section>
  );
}

export default function App() {
  const [active, setActive] = useState(() =>
    new URLSearchParams(window.location.search).get("eokulImport") === "1"
      ? "e-Okul Aktarım"
      : "Ana Sayfa"
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">M</div><div><strong>MEVCUT</strong><span>Yoklama Sistemi</span></div></div>
        <nav>{["Ana Sayfa", "Yoklama", "Geçmiş", "e-Okul Aktarım", "Ayarlar"].map((item) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}>{item}</button>)}</nav>
        <div className="sidebar-footer">MVP 0.3</div>
      </aside>
      <main className="main">
        <header className="topbar"><div><p className="eyebrow">DİJİTAL YOKLAMA</p><h1>{active}</h1></div><div className="user-chip">Yönetici</div></header>
        {active === "e-Okul Aktarım" ? <EOkulTransferView /> : <>
          <section className="welcome-card"><div><p className="eyebrow">MEVCUT</p><h2>Yoklamayı tek yerden yönet.</h2><p>Öğretmen yoklamayı girer, okul yönetimi takip eder, e-Okul'a aktarım köprü üzerinden yapılır.</p></div><button className="primary" onClick={() => setActive("Yoklama")}>Yoklamaya Başla →</button></section>
          <section className="stats-grid">{stats.map((stat) => <div className="stat-card" key={stat.label}><div className="stat-icon">{stat.icon}</div><div><span>{stat.label}</span><strong>{stat.value}</strong></div></div>)}</section>
          <section className="panel"><div className="panel-header"><div><h3>Bugünkü işlemler</h3><p>Henüz kayıt bulunmuyor.</p></div><span className="status-badge">Hazır</span></div><div className="empty-state"><div className="empty-icon">✓</div><strong>İlk yoklamanı oluştur</strong><p>MEVCUT'un ilk çalışan modülü burada başlayacak.</p><button className="secondary" onClick={() => setActive("Yoklama")}>Yoklama ekranını aç</button></div></section>
        </>}
      </main>
    </div>
  );
}