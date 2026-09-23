import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "./context/AuthContext";
import { signInWithEmailAndPassword } from "./firebase/auth";
import {
  getAttendance,
  getClassStudents,
  getSchoolClasses,
  saveAttendance,
  type AttendanceStatus,
  type SchoolClass,
  type SchoolStudent,
} from "./firebase/school";
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

function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(email.trim(), password);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setError(e?.code === "auth/invalid-credential"
        ? "E-posta veya şifre hatalı."
        : e?.message || "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">M</div>
        <p className="eyebrow">DİJİTAL YOKLAMA</p>
        <h1>MEVCUT</h1>
        <p>Yönetici veya öğretmen hesabınızla giriş yapın.</p>
        <input
          type="email"
          placeholder="E-posta"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <div className="import-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
      </form>
    </div>
  );
}


const attendanceLabels: Record<AttendanceStatus, string> = {
  present: "Var",
  full_day: "Tam Gün",
  half_day: "Yarım Gün",
  late: "Geç",
};

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function AttendanceView() {
  const { user, profile } = useAuth();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile?.organizationId) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    getSchoolClasses(profile.organizationId)
      .then((items) => {
        if (cancelled) return;
        setClasses(items);
        setSelectedClass((current) => current || items[0]?.code || "");
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error)?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [profile?.organizationId]);

  useEffect(() => {
    if (!profile?.organizationId || !selectedClass || !date) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      setMessage("");
      try {
        const [studentItems, attendance] = await Promise.all([
          getClassStudents(profile.organizationId, selectedClass),
          getAttendance(profile.organizationId, selectedClass, date),
        ]);
        if (cancelled) return;

        setStudents(studentItems);
        const next: Record<string, AttendanceStatus> = {};
        studentItems.forEach((student) => { next[student.studentNo] = "present"; });
        attendance.forEach((record) => { next[record.studentNo] = record.status; });
        setStatuses(next);
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [profile?.organizationId, selectedClass, date]);

  const setStatus = (studentNo: string, status: AttendanceStatus) => {
    setStatuses((current) => ({ ...current, [studentNo]: status }));
    setMessage("");
  };

  const markAllPresent = () => {
    const next: Record<string, AttendanceStatus> = {};
    students.forEach((student) => { next[student.studentNo] = "present"; });
    setStatuses(next);
    setMessage("");
  };

  const save = async () => {
    if (!profile?.organizationId || !user?.uid || !selectedClass) return;
    const classItem = classes.find((item) => item.code === selectedClass);
    if (!classItem) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const records = students.map((student) => ({
        studentNo: student.studentNo,
        status: statuses[student.studentNo] || "present",
      }));
      await saveAttendance(
        profile.organizationId,
        selectedClass,
        classItem.name,
        date,
        records,
        user.uid
      );
      setMessage("Yoklama başarıyla kaydedildi.");
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const counts = students.reduce(
    (acc, student) => {
      const status = statuses[student.studentNo] || "present";
      acc[status] += 1;
      return acc;
    },
    { present: 0, full_day: 0, half_day: 0, late: 0 } as Record<AttendanceStatus, number>
  );

  if (loading && !students.length && !classes.length) {
    return <section className="panel"><div className="empty-state"><div className="empty-icon">↻</div><strong>Sınıflar yükleniyor...</strong></div></section>;
  }

  return (
    <section className="panel attendance-panel">
      <div className="panel-header attendance-header">
        <div>
          <h3>Günlük Yoklama</h3>
          <p>Sınıfı seç, öğrencilerin durumunu işaretle ve kaydet.</p>
        </div>
        <div className="attendance-actions">
          <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} disabled={!classes.length}>
            {!classes.length && <option value="">Sınıf bulunamadı</option>}
            {classes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="attendance-toolbar">
        <div className="attendance-counts">
          <span>Toplam <strong>{students.length}</strong></span>
          <span className="count-present">Var <strong>{counts.present}</strong></span>
          <span className="count-late">Geç <strong>{counts.late}</strong></span>
          <span className="count-half">Yarım Gün <strong>{counts.half_day}</strong></span>
          <span className="count-full">Tam Gün <strong>{counts.full_day}</strong></span>
        </div>
        <button className="secondary" onClick={markAllPresent} disabled={!students.length}>Herkesi Var Yap</button>
      </div>

      {error && <div className="error-box attendance-error">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      <div className="student-table-wrap">
        <table className="student-table">
          <thead><tr><th>No</th><th>Öğrenci</th><th>Durum</th></tr></thead>
          <tbody>
            {students.map((student) => {
              const status = statuses[student.studentNo] || "present";
              return (
                <tr key={student.id}>
                  <td>{student.studentNo}</td>
                  <td><strong>{student.name}</strong></td>
                  <td>
                    <div className="status-buttons">
                      {(Object.keys(attendanceLabels) as AttendanceStatus[]).map((item) => (
                        <button
                          key={item}
                          className={status === item ? `attendance-status active ${item}` : `attendance-status ${item}`}
                          onClick={() => setStatus(student.studentNo, item)}
                        >
                          {attendanceLabels[item]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!students.length && !loading && (
              <tr><td colSpan={3} className="table-empty">Bu sınıfta öğrenci bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="attendance-footer">
        <span>{message || (students.length ? "Değişiklikleri kaydetmeye hazır." : "Önce bir sınıf seçin.")}</span>
        <button className="primary" onClick={save} disabled={saving || !students.length}>
          {saving ? "Kaydediliyor..." : "Yoklamayı Kaydet"}
        </button>
      </div>
    </section>
  );
}

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
  const { user, profile, loading, profileError } = useAuth();
  const [active, setActive] = useState(() =>
    new URLSearchParams(window.location.search).get("eokulImport") === "1"
      ? "e-Okul Aktarım"
      : "Ana Sayfa"
  );

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">M</div>
          <h1>MEVCUT</h1>
          <p>Oturum kontrol ediliyor...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  if (!profile) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">M</div>
          <h1>MEVCUT</h1>
          <p>{profileError || "Kullanıcı profili bulunamadı."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">M</div><div><strong>MEVCUT</strong><span>Yoklama Sistemi</span></div></div>
        <nav>{["Ana Sayfa", "Yoklama", "Geçmiş", "e-Okul Aktarım", "Ayarlar"].map((item) => <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}>{item}</button>)}</nav>
        <div className="sidebar-footer">MVP 0.3</div>
      </aside>
      <main className="main">
        <header className="topbar"><div><p className="eyebrow">DİJİTAL YOKLAMA</p><h1>{active}</h1></div><div className="user-chip">{profile.role === "admin" ? "Yönetici" : "Öğretmen"}</div></header>
        {active === "Yoklama" ? <AttendanceView /> : active === "e-Okul Aktarım" ? <EOkulTransferView /> : <>
          <section className="welcome-card"><div><p className="eyebrow">MEVCUT</p><h2>Yoklamayı tek yerden yönet.</h2><p>Öğretmen yoklamayı girer, okul yönetimi takip eder, e-Okul'a aktarım köprü üzerinden yapılır.</p></div><button className="primary" onClick={() => setActive("Yoklama")}>Yoklamaya Başla →</button></section>
          <section className="stats-grid">{stats.map((stat) => <div className="stat-card" key={stat.label}><div className="stat-icon">{stat.icon}</div><div><span>{stat.label}</span><strong>{stat.value}</strong></div></div>)}</section>
          <section className="panel"><div className="panel-header"><div><h3>Bugünkü işlemler</h3><p>Henüz kayıt bulunmuyor.</p></div><span className="status-badge">Hazır</span></div><div className="empty-state"><div className="empty-icon">✓</div><strong>İlk yoklamanı oluştur</strong><p>MEVCUT'un ilk çalışan modülü burada başlayacak.</p><button className="secondary" onClick={() => setActive("Yoklama")}>Yoklama ekranını aç</button></div></section>
        </>}
      </main>
    </div>
  );
}