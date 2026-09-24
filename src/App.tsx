import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "./context/AuthContext";
import { signInWithEmailAndPassword } from "./firebase/auth";
import {
  getClassStudents,
  getSchoolClasses,
  importEOkulData,
  type SchoolClass,
  type SchoolStudent,
} from "./firebase/school";
import {
  getTeacherAssignments,
  importAcademicData,
} from "./firebase/academic";
import {
  getLessonAttendances,
  saveLessonAttendance,
} from "./firebase/attendance";
import type {
  AttendanceRuleViolation,
  LessonAttendance,
  LessonAttendanceRecord,
  TeacherAssignment,
} from "./types/academic";
import { evaluateAttendanceRules } from "./rules/attendance";
import {
  getEOkulQueue,
  getLessonAttendanceById,
  updateEOkulQueue,
} from "./firebase/integration";
import {
  approveDailyReport,
  calculateAndSaveDailyAttendance,
  getDailyAttendance,
  getDailyReport,
  overrideDailyAttendance,
} from "./firebase/dailyAttendance";
import {
  getParentChildren,
  getParentDailyAttendance,
  getParentNotifications,
} from "./firebase/parent";
import type {
  DailyAttendanceStudent,
  DailySystemResult,
} from "./types/dailyAttendance";
import { getSchoolSettings, saveSchoolSettings } from "./firebase/schoolSettings";
import type { SchoolSettings } from "./types/schoolSettings";

type AttendanceStatus = LessonAttendanceRecord["status"];
import type { EOkulImportPayload } from "./types/school";

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: "Var",
  absent: "Yok",
  full_day: "Tam Gün",
  half_day: "Yarım Gün",
  late: "Geç",
  unknown: "Bilinmiyor",
};

const lessonStatusLabels: Record<LessonAttendanceRecord["status"], string> = {
  present: "Var",
  absent: "Yok",
  full_day: "Tam Gün",
  half_day: "Yarım Gün",
  late: "Geç",
  unknown: "Bilinmiyor",
};

type ImportPayload = EOkulImportPayload & {
  mode?: "students" | "academic";
  errors?: { className: string; message: string }[];
};

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value + "T00:00:00"));
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

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
      await signInWithEmailAndPassword(
        email.trim(),
        password
      );
    } catch (err) {
      const e = err as {
        code?: string;
        message?: string;
      };

      setError(
        e?.code === "auth/invalid-credential"
          ? "E-posta veya şifre hatalı."
          : e?.message || "Giriş yapılamadı."
      );
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
        <p>Yönetici, öğretmen veya veli hesabınızla giriş yapın.</p>

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

        {error && <div className="error-box">{error}</div>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
      </form>
    </div>
  );
}

function AttendanceView() {
  const { user, profile } = useAuth();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [records, setRecords] = useState<LessonAttendance[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [statuses, setStatuses] =
    useState<Record<string, LessonAttendanceRecord["status"]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (!profile?.organizationId || !user?.uid) return;
    setLoading(true);
    setError("");

    try {
      const [classItems, studentItems, attendanceItems, settings] =
        await Promise.all([
          getSchoolClasses(profile.organizationId),
          selectedClass
            ? getClassStudents(profile.organizationId, selectedClass)
            : Promise.resolve([]),
          getLessonAttendances(
            profile.organizationId,
            date,
            profile.role === "teacher" ? user.uid : undefined
          ),
          getSchoolSettings(profile.organizationId),
        ]);

      setClasses(classItems);
      setSchoolSettings(settings);
      if (settings?.lessonCount && selectedPeriod > settings.lessonCount) {
        setSelectedPeriod(1);
      }
      const activeClass = selectedClass || classItems[0]?.code || "";
      if (!selectedClass && activeClass) {
        setSelectedClass(activeClass);
      }

      const activeStudents = selectedClass
        ? studentItems
        : activeClass
          ? await getClassStudents(profile.organizationId, activeClass)
          : [];

      setStudents(activeStudents);
      setRecords(attendanceItems);

      const classRecords = attendanceItems.filter(
        (item) => item.classCode === activeClass
      );
      const selectedRecord = classRecords.find(
        (item) => item.period === selectedPeriod
      );
      const latest =
        selectedRecord ||
        classRecords
          .filter((item) => item.period > 0 && item.period < selectedPeriod)
          .sort((a, b) => b.period - a.period)[0];

      const next: Record<string, LessonAttendanceRecord["status"]> = {};
      activeStudents.forEach((student) => {
        next[student.studentNo] = "present";
      });

      latest?.records.forEach((record) => {
        next[record.studentNo] = record.status;
      });

      setStatuses(next);
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.organizationId, profile?.role, user?.uid, selectedClass, date, selectedPeriod]);

  const setStatus = (
    studentNo: string,
    status: LessonAttendanceRecord["status"]
  ) => {
    const previous = records
      .filter(
        (item) =>
          item.classCode === selectedClass &&
          item.period > 0 &&
          item.period < selectedPeriod
      )
      .sort((a, b) => b.period - a.period)[0]
      ?.records.find((item) => item.studentNo === studentNo);

    setStatuses((current) => ({ ...current, [studentNo]: status }));

    if (previous?.status === "present" && status === "absent") {
      setMessage(
        "⚠️ Öğrenci önceki yoklamada Mevcut. Bu işlem ara ders devamsızlığı uyarısı oluşturacaktır."
      );
    } else {
      setMessage("");
    }
  };

  const save = async () => {
    if (!profile?.organizationId || !user?.uid || !selectedClass) return;

    const className =
      classes.find((item) => item.code === selectedClass)?.name || "";

    const previous = records
      .filter(
        (item) =>
          item.classCode === selectedClass &&
          item.period > 0 &&
          item.period < selectedPeriod
      )
      .sort((a, b) => b.period - a.period)[0];

    const previousMap = new Map(
      (previous?.records || []).map((item) => [item.studentNo, item.status])
    );

    const rows = students.map((student) => ({
      studentNo: student.studentNo,
      status: statuses[student.studentNo] || "unknown",
    }));

    const intermediateWarnings = rows.filter(
      (row) =>
        previousMap.get(row.studentNo) === "present" &&
        row.status === "absent"
    );

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await saveLessonAttendance({
        organizationId: profile.organizationId,
        date,
        classCode: selectedClass,
        className,
        subjectCode: "period-" + selectedPeriod,
        subjectName: selectedPeriod + ". Ders",
        teacherUid: user.uid,
        teacherName: profile.displayName,
        period: selectedPeriod,
        records: rows,
        ruleViolations: intermediateWarnings.map((row) => ({
          ruleId: "ARA_DERS_DEVAMSIZLIGI",
          severity: "critical",
          studentNo: row.studentNo,
          message:
            "Öğrenci önceki yoklamada Mevcut, bu yoklamada Yok olarak işaretlendi.",
        })),
      });

      setMessage(
        intermediateWarnings.length
          ? "Yoklama kaydedildi. Ara ders devamsızlığı uyarıları yöneticiye iletildi."
          : "Yoklama kaydedildi ve yönetici incelemesine gönderildi."
      );
      await load();
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const counts = students.reduce(
    (acc, student) => {
      const status = statuses[student.studentNo] || "unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <section className="panel attendance-panel">
      <div className="panel-header attendance-header">
        <div>
          <h3>Yoklama</h3>
          <p>Sınıfı manuel seçin. V1 ders programına bağımlı değildir.</p>
        </div>

        <div className="attendance-actions">
          <select
            value={String(selectedPeriod)}
            onChange={(e) => setSelectedPeriod(Number(e.target.value))}
            disabled={!schoolSettings?.lessonCount}
            aria-label="Ders saati"
          >
            {schoolSettings?.lessonCount ? (
              Array.from({ length: schoolSettings.lessonCount }, (_, index) => {
                const period = index + 1;
                const slot = schoolSettings.lessonTimes.find((item) => item.period === period);
                const time = slot?.startTime && slot?.endTime
                  ? " · " + slot.startTime + "-" + slot.endTime
                  : "";
                return (
                  <option key={period} value={period}>
                    {period}. Ders{time}
                  </option>
                );
              })
            ) : (
              <option value="">Ders saatleri tanımlı değil</option>
            )}
          </select>

          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            disabled={!classes.length}
          >
            {!classes.length && <option value="">Sınıf bulunamadı</option>}
            {classes.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      {!schoolSettings?.lessonCount && (
        <div className="error-box">
          Ders sayısı ve ders saatleri henüz tanımlı değil. Önce Ayarlar → Okul Bilgileri bölümünden ders saatlerini kaydedin.
        </div>
      )}

      <div className="info-box">
        <strong>Manuel sınıf seçimi</strong>
        <span>
          Nöbet, ders değişikliği veya başka bir öğretmenin yerine girme gibi
          durumlarda öğretmen farklı bir sınıf seçebilir.
        </span>
      </div>

      <div className="attendance-toolbar">
        <div className="attendance-counts">
          <span>Toplam <strong>{students.length}</strong></span>
          <span className="count-present">Var <strong>{counts.present || 0}</strong></span>
          <span className="count-late">Geç <strong>{counts.late || 0}</strong></span>
          <span className="count-full">Yok <strong>{counts.absent || 0}</strong></span>
          <span className="count-unknown">Bilinmiyor <strong>{counts.unknown || 0}</strong></span>
        </div>

        <button
          className="secondary"
          onClick={() =>
            setStatuses(Object.fromEntries(
              students.map((student) => [student.studentNo, "present"])
            ))
          }
          disabled={!students.length}
        >
          Herkesi Var Yap
        </button>
      </div>

      {error && <div className="error-box attendance-error">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      <div className="student-table-wrap">
        <table className="student-table">
          <thead>
            <tr><th>No</th><th>Öğrenci</th><th>Durum</th></tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const status = statuses[student.studentNo] || "unknown";
              const options: Array<[LessonAttendanceRecord["status"], string]> = [
                ["present", "Var"],
                ["absent", "Yok"],
                ["late", "Geç"],
                ["unknown", "Bilinmiyor"],
              ];

              return (
                <tr key={student.id}>
                  <td>{student.studentNo}</td>
                  <td><strong>{student.name}</strong></td>
                  <td>
                    <div className="status-buttons">
                      {options.map(([item, label]) => (
                        <button
                          key={item}
                          className={
                            status === item
                              ? "attendance-status active " + item
                              : "attendance-status " + item
                          }
                          onClick={() => setStatus(student.studentNo, item)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}

            {!students.length && !loading && (
              <tr>
                <td colSpan={3} className="table-empty">
                  Bu sınıfta öğrenci bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="attendance-footer">
        <span>
          {loading
            ? "Veriler yükleniyor..."
            : "Gönderildiğinde kayıt yönetici incelemesine düşer."}
        </span>
        <button
          className="primary"
          onClick={save}
          disabled={saving || !students.length || !schoolSettings?.lessonCount}
        >
          {saving ? "Gönderiliyor..." : "Yoklamayı Gönder"}
        </button>
      </div>
    </section>
  );
}

function DashboardView({
  onNavigate,
}: {
  onNavigate: (value: string) => void;
}) {
  const { profile } = useAuth();
  const [records, setRecords] =
    useState<LessonAttendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.organizationId) return;

    getLessonAttendances(
      profile.organizationId,
      undefined,
      profile.role === "teacher" ? profile.uid : undefined
    ).then((items) => setRecords(items))
      .finally(() => setLoading(false));
  }, [profile?.organizationId]);

  const today = todayLocal();

  const todayRecords = records.filter(
    (item) => item.date === today
  );

  const submitted = todayRecords.filter(
    (item) =>
      item.reviewStatus === "submitted"
  ).length;

  const approved = todayRecords.filter(
    (item) =>
      item.reviewStatus === "approved"
  ).length;

  const needsReview = todayRecords.filter(
    (item) =>
      item.reviewStatus === "needs_review" ||
      item.records.some(
        (record) => record.status === "unknown"
      ) ||
      Boolean(item.ruleViolations?.length)
  ).length;

  const unknown = todayRecords.reduce(
    (sum, item) =>
      sum +
      item.records.filter(
        (record) => record.status === "unknown"
      ).length,
    0
  );

  return (
    <>
      <section className="welcome-card">
        <div>
          <p className="eyebrow">MEVCUT</p>
          <h2>Yoklamayı tek yerden yönet.</h2>
          <p>
            Öğretmen yoklamayı girer, okul yönetimi
            inceler ve onaylanan kayıtlar e-Okul
            aktarım kuyruğuna hazırlanır.
          </p>
        </div>

        <button
          className="primary"
          onClick={() => onNavigate("Yoklama")}
        >
          Yoklamaya Başla →
        </button>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">✓</div>
          <div>
            <span>Bugünkü Yoklama</span>
            <strong>{loading ? "…" : todayRecords.length}</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">◷</div>
          <div>
            <span>Bekleyen</span>
            <strong>{loading ? "…" : submitted}</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">↗</div>
          <div>
            <span>Onaylanan</span>
            <strong>{loading ? "…" : approved}</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">!</div>
          <div>
            <span>İnceleme</span>
            <strong>{loading ? "…" : needsReview}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Bugünkü durum</h3>
            <p>
              {formatDate(today)} · {unknown} öğrenci
              bilinmiyor durumda.
            </p>
          </div>

          <span className="status-badge">
            {todayRecords.length} kayıt
          </span>
        </div>

        <div className="empty-state compact">
          <div className="empty-icon">✓</div>
          <strong>
            {todayRecords.length
              ? "Bugünkü yoklamalar sisteme alındı."
              : "Bugün henüz yoklama kaydı yok."}
          </strong>
          <p>
            Yönetici onayı gereken kayıtları Gün Sonu
            ekranından inceleyebilirsiniz.
          </p>

          <button
            className="secondary"
            onClick={() =>
              onNavigate(
                profile?.role === "admin"
                  ? "Gün Sonu"
                  : "Yoklama"
              )
            }
          >
            {profile?.role === "admin"
              ? "Gün Sonu ekranını aç"
              : "Yoklama ekranını aç"}
          </button>
        </div>
      </section>
    </>
  );
}

function ReviewView() {
  const { profile, user } = useAuth();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [lessons, setLessons] = useState<LessonAttendance[]>([]);
  const [daily, setDaily] = useState<DailyAttendanceStudent[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [report, setReport] = useState<Awaited<ReturnType<typeof getDailyReport>>>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = async () => {
    if (!profile?.organizationId) return;
    setLoading(true);
    setError("");

    try {
      const classItems = await getSchoolClasses(profile.organizationId);
      const [studentGroups, lessonItems, dailyItems, reportItem] =
        await Promise.all([
          selectedClass
            ? getClassStudents(profile.organizationId, selectedClass)
            : Promise.all(
                classItems.map((item) =>
                  getClassStudents(profile.organizationId, item.code)
                )
              ).then((groups) => groups.flat()),
          getLessonAttendances(profile.organizationId, date),
          getDailyAttendance(
            profile.organizationId,
            date,
            selectedClass || undefined
          ),
          getDailyReport(profile.organizationId, date),
        ]);

      setClasses(classItems);
      const studentItems = Array.isArray(studentGroups)
        ? studentGroups
        : [];
      setStudents(studentItems);
      setLessons(lessonItems);
      setDaily(dailyItems);
      setReport(reportItem);
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.organizationId, selectedClass, date]);

  const calculate = async () => {
    if (!profile?.organizationId) return;
    setBusy(true);
    setError("");

    try {
      const classItems = await getSchoolClasses(profile.organizationId);
      const allStudents = selectedClass
        ? await getClassStudents(profile.organizationId, selectedClass)
        : (
            await Promise.all(
              classItems.map((item) =>
                getClassStudents(profile.organizationId, item.code)
              )
            )
          ).flat();
      const allLessons = await getLessonAttendances(
        profile.organizationId,
        date
      );

      await calculateAndSaveDailyAttendance({
        organizationId: profile.organizationId,
        date,
        students: allStudents,
        lessonAttendances: allLessons,
      });

      await load();
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const override = async (
    item: DailyAttendanceStudent,
    result: DailySystemResult
  ) => {
    if (!profile?.organizationId || !user?.uid) return;
    const explanation =
      reason[item.id]?.trim() || "Yönetici tarafından manuel düzeltildi.";

    setBusy(true);
    setError("");

    try {
      await overrideDailyAttendance({
        organizationId: profile.organizationId,
        dailyAttendanceId: item.id,
        adminId: user.uid,
        result,
        reason: explanation,
      });
      await load();
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!profile?.organizationId || !user?.uid) return;
    if (!window.confirm(
      "Gün sonu raporu onaylanacak, kilitlenecek ve onaylanan sonuçlar e-Okul aktarım kuyruğuna alınacak. Devam edilsin mi?"
    )) return;

    setBusy(true);
    setError("");

    try {
      await approveDailyReport(profile.organizationId, date, user.uid);
      await load();
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const visibleDaily = daily.filter(
    (item) => !selectedClass || item.classCode === selectedClass
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Gün Sonu Yönetim Merkezi</h3>
          <p>
            Tüm sınıf ve öğrencileri, öğretmen yoklamalarını ve sistem sonuçlarını
            kontrol edin. Yönetici nihai kararı verir.
          </p>
        </div>
        <span className="status-badge">
          {report?.locked ? "KİLİTLİ" : report?.status === "approved" ? "ONAYLI" : "TASLAK"}
        </span>
      </div>

      <div className="attendance-actions">
        <select
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
        >
          <option value="">Tüm Sınıflar</option>
          {classes.map((item) => (
            <option key={item.code} value={item.code}>{item.name}</option>
          ))}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="secondary" onClick={calculate} disabled={busy}>
          {busy ? "Hesaplanıyor..." : "Gün Sonunu Hesapla"}
        </button>
        <button
          className="primary"
          onClick={approve}
          disabled={busy || !daily.length || Boolean(report?.locked)}
        >
          Gün Sonunu Onayla ve Kilitle
        </button>
      </div>

      {error && <div className="error-box attendance-error">{error}</div>}

      {!loading && !visibleDaily.length && (
        <div className="empty-state compact">
          <strong>Henüz günlük sonuç oluşturulmadı.</strong>
          <p>Önce öğretmen yoklamalarının gelmesini bekleyin ve “Gün Sonunu Hesapla” düğmesine basın.</p>
        </div>
      )}

      <div className="review-list">
        {visibleDaily.map((item) => {
          const raw = lessons.filter((lesson) => lesson.records.some(
            (record) => record.studentNo === item.studentNo
          ));

          return (
            <article className="review-card" key={item.id}>
              <div>
                <strong>{item.studentName}</strong>
                <span>{item.className} · No: {item.studentNo}</span>
                <small>
                  Sistem: <b>{dailyResultLabel(item.systemResult)}</b>
                  {" · "}
                  Nihai: <b>{dailyResultLabel(item.finalResult)}</b>
                  {" · "}
                  {raw.length} öğretmen yoklaması
                </small>
                <small>
                  Ham kayıtlar:{" "}
                  {raw.length
                    ? raw.map((lesson) => {
                        const record = lesson.records.find(
                          (entry) => entry.studentNo === item.studentNo
                        );
                        return (
                          (lesson.teacherName || "Öğretmen") +
                          ": " +
                          (record?.status || "unknown")
                        );
                      }).join(" · ")
                    : "Henüz yoklama yok"}
                </small>
                <small>{item.explanation}</small>
                {item.hasIntermediateAbsence && (
                  <small className="error-box">🚨 Ara Ders Devamsızlığı Tespit Edildi</small>
                )}
                {item.adminOverride && (
                  <small>
                    Yönetici düzeltmesi: {item.adminOverride.reason}
                  </small>
                )}
              </div>

              {!report?.locked && (
                <div className="review-actions">
                  <input
                    placeholder="Düzeltme gerekçesi"
                    value={reason[item.id] || ""}
                    onChange={(e) =>
                      setReason((current) => ({
                        ...current,
                        [item.id]: e.target.value,
                      }))
                    }
                  />
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void override(item, "present")}
                  >
                    Mevcut
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void override(item, "full_day")}
                  >
                    Tam Gün
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void override(item, "half_day")}
                  >
                    Yarım Gün
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void override(item, "late")}
                  >
                    Geç
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function dailyResultLabel(value: DailySystemResult) {
  return {
    present: "Mevcut",
    half_day: "Yarım Gün",
    full_day: "Tam Gün",
    late: "Geç",
    unknown: "Bilinmiyor",
  }[value];
}

function ParentView() {
  const { profile, user } = useAuth();
  const [children, setChildren] = useState<SchoolStudent[]>([]);
  const [selectedChild, setSelectedChild] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [daily, setDaily] = useState<DailyAttendanceStudent[]>([]);
  const [notifications, setNotifications] = useState<
    Awaited<ReturnType<typeof getParentNotifications>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile?.organizationId || !user?.uid) return;

    const load = async () => {
      setLoading(true);
      try {
        const [childItems, notificationItems] = await Promise.all([
          getParentChildren(profile.organizationId, user.uid),
          getParentNotifications(profile.organizationId, user.uid),
        ]);
        setChildren(childItems);
        setSelectedChild((current) => current || childItems[0]?.id || "");
        setNotifications(notificationItems);
      } catch (err) {
        setError((err as Error)?.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [profile?.organizationId, user?.uid]);

  useEffect(() => {
    if (!profile?.organizationId || !selectedChild) return;
    getParentDailyAttendance(
      profile.organizationId,
      selectedChild,
      date
    ).then(setDaily).catch((err) => setError((err as Error)?.message || String(err)));
  }, [profile?.organizationId, selectedChild, date]);

  if (loading) {
    return <section className="panel"><strong>Veli verileri yükleniyor...</strong></section>;
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Veli Merkezi</h3>
          <p>Çocuğunuzun doğrulanmış günlük yoklama durumlarını görüntüleyin.</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {!children.length && (
        <div className="empty-state compact">
          <strong>Henüz öğrenci eşleştirmesi yapılmamış.</strong>
        </div>
      )}

      {children.length > 0 && (
        <>
          <div className="attendance-actions">
            <select
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
            >
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name} · {child.className}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="review-list">
            {daily.map((item) => (
              <article className="review-card" key={item.id}>
                <div>
                  <strong>{item.studentName}</strong>
                  <span>{item.className} · {formatDate(item.date)}</span>
                  <small>Günlük sonuç: <b>{dailyResultLabel(item.finalResult)}</b></small>
                </div>
              </article>
            ))}
            {!daily.length && (
              <div className="empty-state compact">
                <strong>Bugün için onaylanmış günlük sonuç yok.</strong>
              </div>
            )}
          </div>

          <h4>Bildirimler</h4>
          <div className="review-list">
            {notifications.map((notification) => (
              <article className="review-card" key={notification.id}>
                <div>
                  <strong>{notification.title}</strong>
                  <span>{notification.message}</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function HistoryView() {
  const { profile } = useAuth();
  const [records, setRecords] =
    useState<LessonAttendance[]>([]);
  const [date, setDate] = useState(todayLocal());
  const [classFilter, setClassFilter] =
    useState("");

  useEffect(() => {
    if (!profile?.organizationId) return;

    getLessonAttendances(
      profile.organizationId,
      date,
      profile.role === "teacher" ? profile.uid : undefined
    ).then(setRecords);
  }, [date, profile?.organizationId]);

  const classes = Array.from(
    new Map(
      records.map((item) => [
        item.classCode,
        item.className,
      ])
    ).entries()
  );

  const visible = records.filter(
    (item) =>
      !classFilter ||
      item.classCode === classFilter
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Geçmiş</h3>
          <p>
            Yoklama kayıtlarını tarih ve sınıfa göre
            inceleyin.
          </p>
        </div>

        <div className="attendance-actions">
          <input
            type="date"
            value={date}
            onChange={(e) =>
              setDate(e.target.value)
            }
          />

          <select
            value={classFilter}
            onChange={(e) =>
              setClassFilter(e.target.value)
            }
          >
            <option value="">Tüm sınıflar</option>
            {classes.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="history-list">
        {!visible.length && (
          <div className="empty-state compact">
            <strong>Kayıt bulunamadı.</strong>
            <p>
              Seçilen tarih için yoklama kaydı yok.
            </p>
          </div>
        )}

        {visible.map((item) => {
          const counts = item.records.reduce(
            (acc, record) => {
              acc[record.status] += 1;
              return acc;
            },
            {
              present: 0,
              full_day: 0,
              half_day: 0,
              late: 0,
              unknown: 0,
            } as Record<
              LessonAttendanceRecord["status"],
              number
            >
          );

          return (
            <article
              className="history-card"
              key={item.id}
            >
              <div>
                <strong>{item.className}</strong>
                <span>
                  {item.subjectName ||
                    "Günlük Yoklama"}
                  {item.period
                    ? " · " + item.period + ". ders"
                    : ""}
                </span>
                <small>
                  {item.teacherName ||
                    "Öğretmen belirtilmemiş"}
                </small>
              </div>

              <div className="history-counts">
                <span className="count-present">
                  Var {counts.present}
                </span>
                <span className="count-full">
                  Tam {counts.full_day}
                </span>
                <span className="count-half">
                  Yarım {counts.half_day}
                </span>
                <span className="count-late">
                  Geç {counts.late}
                </span>
                <span className="count-unknown">
                  Bilinmiyor {counts.unknown}
                </span>
              </div>

              <span className="status-badge">
                {item.ruleViolations?.length
                  ? String(item.ruleViolations.length) + " kural uyarısı"
                  : item.reviewStatus === "approved"
                  ? "Onaylandı"
                  : item.reviewStatus ===
                    "needs_review"
                  ? "İnceleme"
                  : "Bekliyor"}
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function IntegrationCenterView() {
  const { profile, loading: authLoading, profileError } = useAuth();
  const [queue, setQueue] = useState<
    Array<{
      id: string;
      attendanceId: string;
      status: "pending" | "processing" | "completed" | "failed";
      attempts: number;
      lastError?: string;
      attendance?: LessonAttendance | null;
    }>
  >([]);
  const [status, setStatus] = useState("Hazır.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState<{
    extensionVersion?: string;
    eOkulTabs?: number;
    attendanceTabs?: number;
    academicTabs?: number;
  }>({});

  const loadQueue = async () => {
    if (!profile?.organizationId || profile.role !== "admin") return;

    const items = await getEOkulQueue(profile.organizationId);
    const enriched = await Promise.all(
      items
        .filter((item) =>
          item.status === "pending" ||
          item.status === "processing" ||
          item.status === "failed"
        )
        .map(async (item) => ({
          ...item,
          attendance: await getLessonAttendanceById(
            profile.organizationId,
            item.attendanceId
          ),
        }))
    );

    setQueue(enriched);
  };

  useEffect(() => {
    if (authLoading || !profile?.organizationId) return;

    if (profile.role !== "admin") {
      setStatus(
        "Bu alan yalnızca yöneticinin e-Okul işlemleri için kullanılır."
      );
      return;
    }

    void loadQueue();

    const extensionReadyHandler = () => {
      setExtensionReady(true);
      setStatus("Chrome e-Okul köprüsü hazır.");

      window.postMessage(
        {
          source: "MEVCUT",
          type: "MEVCUT_EOKUL_COMMAND",
          action: "CHECK_STATUS",
        },
        window.location.origin
      );
    };

    const handler = async (event: Event) => {
      const detail =
        (event as CustomEvent).detail as
          | {
              requestId?: string;
              action?: string;
              ok?: boolean;
              error?: string;
              payload?: ImportPayload;
            }
          | undefined;

      if (!detail) return;

      setBusy(false);

      if (
        detail.ok &&
        detail.action === "CHECK_STATUS" &&
        detail.payload
      ) {
        const payload = detail.payload as {
          extensionVersion?: string;
          eOkulTabs?: Array<unknown>;
          attendanceTabs?: number;
          academicTabs?: number;
        };

        setExtensionStatus({
          extensionVersion: payload.extensionVersion,
          eOkulTabs: payload.eOkulTabs?.length || 0,
          attendanceTabs: payload.attendanceTabs || 0,
          academicTabs: payload.academicTabs || 0,
        });

        if (
          payload.attendanceTabs ||
          payload.academicTabs
        ) {
          setStatus(
            "Köprü hazır · e-Okul sekmesi algılandı."
          );
        } else {
          setStatus(
            "Köprü hazır · e-Okul sekmesi henüz açık değil."
          );
        }

        return;
      }

      if (!detail.ok) {
        setError(detail.error || "e-Okul işlemi başarısız.");
        setStatus("İşlem başarısız.");

        if (detail.action === "SEND_ATTENDANCE" && detail.requestId) {
          const queueItem = queue.find(
            (item) => item.id === detail.requestId
          );

          if (queueItem) {
            await updateEOkulQueue(
              profile.organizationId,
              queueItem.id,
              "failed",
              {
                attempts: queueItem.attempts + 1,
                lastError:
                  detail.error ||
                  "e-Okul işlemi başarısız.",
              }
            );

            await loadQueue();
          }
        }

        return;
      }

      try {
        if (detail.action === "SYNC_STUDENTS" && detail.payload) {
          const result = await importEOkulData({
            organizationId: profile.organizationId,
            periodCode: detail.payload.periodCode,
            institutionCode: detail.payload.institutionCode,
            importedAt: detail.payload.importedAt,
            classes: detail.payload.classes || [],
            students: detail.payload.students || [],
          });

          setStatus(
            result.classCount +
              " sınıf ve " +
              result.studentCount +
              " öğrenci MEVCUT'a aktarıldı."
          );

          if (detail.payload.errors?.length) {
            setError(
              detail.payload.errors
                .map((item) => item.className + ": " + item.message)
                .join("\n")
            );
          } else {
            setError("");
          }
        }

        if (detail.action === "SYNC_ACADEMIC" && detail.payload) {
          const result = await importAcademicData({
            organizationId: profile.organizationId,
            assignments: detail.payload.assignments || [],
            schedules: detail.payload.schedules || [],
          });

          setStatus(
            result.assignments +
              " ders-öğretmen eşleşmesi" +
              " (" +
              (detail.payload.classes?.length || 0) +
              " sınıf/şube) aktarıldı."
          );
          setError("");
        }

        if (detail.action === "SEND_ATTENDANCE") {
          const queueItem = queue.find(
            (item) => item.id === detail.requestId
          );

          if (queueItem) {
            await updateEOkulQueue(
              profile.organizationId,
              queueItem.id,
              "completed",
              {
                attempts: queueItem.attempts + 1,
                lastError: "",
              }
            );
            await loadQueue();
          }

          setStatus("Yoklama e-Okul'a başarıyla gönderildi.");
          setError("");
        }
      } catch (err) {
        setError((err as Error)?.message || String(err));
        setStatus("MEVCUT tarafındaki aktarım başarısız.");
      }
    };

    window.addEventListener(
      "MEVCUT_EOKUL_EXTENSION_READY",
      extensionReadyHandler
    );
    window.addEventListener("MEVCUT_EOKUL_RESULT", handler);

    const pingBridge = () => {
      window.postMessage(
        {
          source: "MEVCUT",
          type: "MEVCUT_EOKUL_BRIDGE_PING",
        },
        window.location.origin
      );
    };

    pingBridge();
    const bridgeTimer = window.setInterval(
      pingBridge,
      1000
    );

    return () => {
      window.clearInterval(bridgeTimer);
      window.removeEventListener(
        "MEVCUT_EOKUL_EXTENSION_READY",
        extensionReadyHandler
      );
      window.removeEventListener(
        "MEVCUT_EOKUL_RESULT",
        handler
      );
    };
  }, [
    authLoading,
    profile?.organizationId,
    profile?.role,
    profileError,
    queue,
  ]);

  const sendCommand = (
    action: string,
    payload: Record<string, unknown> = {},
    requestId?: string
  ) => {
    setBusy(true);
    setError("");
    setStatus("e-Okul işlemi başlatılıyor...");

    if (!extensionReady) {
      setBusy(false);
      setError(
        "MEVCUT e-Okul köprüsü bulunamadı. Chrome eklentisinin yüklü ve etkin olduğundan emin olun."
      );
      return;
    }

    window.postMessage(
      {
        source: "MEVCUT",
        type: "MEVCUT_EOKUL_COMMAND",
        action,
        requestId,
        payload,
      },
      window.location.origin
    );
  };

  const sendQueueItem = async (item: (typeof queue)[number]) => {
    if (!item.attendance || !profile?.organizationId) return;

    const unknown = item.attendance.records.some(
      (record) => record.status === "unknown"
    );

    if (unknown) {
      setError(
        item.attendance.className +
          " kaydında Bilinmiyor öğrenciler bulunduğu için e-Okul'a gönderilemez."
      );
      return;
    }

    await updateEOkulQueue(
      profile.organizationId,
      item.id,
      "processing",
      {
        attempts: item.attempts + 1,
        lastError: "",
      }
    );

    await loadQueue();

    sendCommand(
      "SEND_ATTENDANCE",
      {
        queueId: item.id,
        attendance: item.attendance,
      },
      item.id
    );
  };

  const pending = queue.filter((item) => item.status === "pending");
  const failed = queue.filter((item) => item.status === "failed");

  if (profile?.role !== "admin") {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Entegrasyon Merkezi</h3>
            <p>{status}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel integration-panel">
      <div className="panel-header">
        <div>
          <h3>Entegrasyon Merkezi</h3>
          <p>
            e-Okul işlemlerini MEVCUT içinden başlatın.
            Chrome eklentisi arka planda köprü olarak çalışır.
          </p>
        </div>
        <span
          className={
            extensionReady
              ? "status-badge extension-status ready"
              : "status-badge extension-status"
          }
        >
          {extensionReady
            ? "e-Okul köprüsü hazır"
            : "e-Okul köprüsü bekleniyor"}
        </span>
      </div>

      <div className="integration-summary">
        <span>
          Bridge <strong>{extensionStatus.extensionVersion || "?"}</strong>
        </span>
        <span>
          e-Okul sekmesi <strong>{extensionStatus.eOkulTabs ?? 0}</strong>
        </span>
        <span>
          Yoklama ekranı <strong>{extensionStatus.attendanceTabs ?? 0}</strong>
        </span>
        <span>
          Ders-öğretmen <strong>{extensionStatus.academicTabs ?? 0}</strong>
        </span>
      </div>

      <div className="integration-actions">
        <article className="integration-card">
          <strong>Bağlantı Testi</strong>
          <p>
            MEVCUT → Chrome Bridge → e-Okul zincirini kontrol eder.
          </p>
          <button
            className="secondary"
            disabled={busy || !extensionReady}
            onClick={() => sendCommand("CHECK_STATUS")}
          >
            Bağlantıyı Test Et
          </button>
        </article>

        <article className="integration-card">
          <strong>Sınıf + Öğrenci Senkronizasyonu</strong>
          <p>
            Açık e-Okul yoklama ekranından sınıf ve öğrenci verilerini alır.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => sendCommand("SYNC_STUDENTS")}
          >
            e-Okul'dan Verileri Al
          </button>
        </article>

        <article className="integration-card">
          <strong>Ders + Öğretmen Senkronizasyonu</strong>
          <p>
            IOK09004 ekranındaki tüm sınıf/şube seçimlerini sırayla açar ve ders-öğretmen bilgilerini toplar.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => sendCommand("SYNC_ACADEMIC")}
          >
            Akademik Veriyi Al
          </button>
        </article>
      </div>

      <div className="integration-summary">
        <span>
          Bekleyen <strong>{pending.length}</strong>
        </span>
        <span>
          Hatalı <strong>{failed.length}</strong>
        </span>
      </div>

      {status && <div className="success-box">{status}</div>}
      {error && (
        <pre className="import-error">
          {error}
        </pre>
      )}

      <div className="queue-list">
        <div className="panel-header compact-header">
          <div>
            <h4>e-Okul Gönderim Kuyruğu</h4>
            <p>Yönetici onayından geçen yoklamalar burada görünür.</p>
          </div>
          <button
            className="secondary"
            onClick={() => void loadQueue()}
            disabled={busy}
          >
            Yenile
          </button>
        </div>

        {!queue.length && (
          <div className="empty-state compact">
            <strong>Gönderilecek kayıt yok.</strong>
            <p>
              Onaylanan yoklamalar otomatik olarak bu kuyruğa düşer.
            </p>
          </div>
        )}

        {queue.map((item) => (
          <article className="queue-card" key={item.id}>
            <div>
              <strong>
                {(item.attendance?.className || "Sınıf") +
                  " · " +
                  (item.attendance?.subjectName || "Ders")}
              </strong>
              <span>
                {item.attendance?.period
                  ? String(item.attendance.period) + ". ders · "
                  : ""}
                {item.attendance?.date || ""}
              </span>
              <small>
                {item.status + " · " + item.attempts + " deneme"}
              </small>
            </div>

            <button
              className="primary"
              disabled={
                busy ||
                item.status === "processing" ||
                !item.attendance
              }
              onClick={() => void sendQueueItem(item)}
            >
              {item.status === "processing"
                ? "Gönderiliyor..."
                : "e-Okul'a Gönder"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AcademicView() {
  const { profile } = useAuth();
  const [assignments, setAssignments] =
    useState<TeacherAssignment[]>([]);
  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    if (!profile?.organizationId) return;

    getTeacherAssignments(
      profile.organizationId,
      profile.role === "teacher"
        ? profile.displayName
        : undefined
    )
      .then(setAssignments)
      .finally(() => setLoading(false));
  }, [
    profile?.displayName,
    profile?.organizationId,
    profile?.role,
  ]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Ders ve Öğretmenler</h3>
          <p>
            e-Okul'dan aktarılan ders-öğretmen
            ilişkileri.
          </p>
        </div>

        <span className="status-badge">
          {assignments.length} eşleşme
        </span>
      </div>

      <div className="history-list">
        {loading && (
          <div className="empty-state compact">
            <strong>Veriler yükleniyor...</strong>
          </div>
        )}

        {!loading && !assignments.length && (
          <div className="empty-state compact">
            <strong>
              Henüz ders-öğretmen verisi yok.
            </strong>
            <p>
              e-Okul IOK09004 ekranından seçili sınıfı
              aktarın.
            </p>
          </div>
        )}

        {assignments.map((item) => (
          <article
            className="history-card"
            key={item.id}
          >
            <div>
              <strong>{item.className}</strong>
              <span>{item.subjectName}</span>
              <small>{item.teacherName}</small>
            </div>

            <span className="status-badge">
              {item.source}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}


function SchoolSettingsView() {
  const { profile, user } = useAuth();
  const [lessonCount, setLessonCount] = useState(0);
  const [lessonTimes, setLessonTimes] = useState<SchoolSettings["lessonTimes"]>([]);
  const [source, setSource] = useState<SchoolSettings["source"]>("manual");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (!profile?.organizationId) return;
    setLoading(true);
    setError("");
    try {
      const settings = await getSchoolSettings(profile.organizationId);
      const count = settings?.lessonCount || 0;
      setLessonCount(count);
      setSource(settings?.source || "manual");
      setLessonTimes(
        Array.from({ length: count }, (_, index) => {
          const period = index + 1;
          return settings?.lessonTimes.find((item) => item.period === period) || {
            period,
            startTime: "",
            endTime: "",
          };
        })
      );
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.organizationId]);

  const changeCount = (value: number) => {
    const nextCount = Math.max(1, Math.min(20, value || 1));
    setLessonCount(nextCount);
    setLessonTimes((current) =>
      Array.from({ length: nextCount }, (_, index) => {
        const period = index + 1;
        return current.find((item) => item.period === period) || {
          period,
          startTime: "",
          endTime: "",
        };
      })
    );
  };

  const updateTime = (
    period: number,
    field: "startTime" | "endTime",
    value: string
  ) => {
    setLessonTimes((current) =>
      current.map((item) =>
        item.period === period ? { ...item, [field]: value } : item
      )
    );
  };

  const save = async () => {
    if (!profile?.organizationId || !user?.uid || !lessonCount) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveSchoolSettings({
        organizationId: profile.organizationId,
        lessonCount,
        lessonTimes,
        updatedBy: user.uid,
        source: "manual",
      });
      setSource("manual");
      setMessage("Okul ders saatleri kaydedildi.");
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Okul Bilgileri</h3>
          <p>
            Gün içindeki yoklamaların hangi ders saatine ait olduğunu burada tanımlayın.
          </p>
        </div>
        <span className="status-badge">
          {source === "e-okul" ? "e-Okul'dan alındı" : "Manuel"}
        </span>
      </div>

      {loading && <div className="info-box"><span>Okul ayarları yükleniyor...</span></div>}
      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      {!loading && (
        <>
          <div className="form-grid">
            <label>
              Ders sayısı
              <input
                type="number"
                min={1}
                max={20}
                value={lessonCount || ""}
                onChange={(e) => changeCount(Number(e.target.value))}
                placeholder="Örn. 8"
              />
            </label>
          </div>

          <div className="history-list">
            {lessonTimes.map((item) => (
              <article className="history-card" key={item.period}>
                <div>
                  <strong>{item.period}. Ders</strong>
                  <small>Ders başlangıç ve bitiş saati</small>
                </div>
                <div className="attendance-actions">
                  <input
                    type="time"
                    value={item.startTime}
                    onChange={(e) =>
                      updateTime(item.period, "startTime", e.target.value)
                    }
                  />
                  <span>—</span>
                  <input
                    type="time"
                    value={item.endTime}
                    onChange={(e) =>
                      updateTime(item.period, "endTime", e.target.value)
                    }
                  />
                </div>
              </article>
            ))}
          </div>

          <div className="attendance-footer">
            <span>
              e-Okul entegrasyonu geldiğinde bu bilgiler otomatik senkronize edilebilir.
            </span>
            <button className="primary" onClick={save} disabled={saving || !lessonCount}>
              {saving ? "Kaydediliyor..." : "Okul Bilgilerini Kaydet"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function App() {
  const {
    user,
    profile,
    loading,
    profileError,
    logout,
  } = useAuth();

  const initialPage =
    new URLSearchParams(
      window.location.search
    ).get("eokulImport") === "1"
      ? "Entegrasyon"
      : "Ana Sayfa";

  const [active, setActive] =
    useState(initialPage);

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
          <p>
            {profileError ||
              "Kullanıcı profili bulunamadı."}
          </p>
        </div>
      </div>
    );
  }

  const navigation =
    profile.role === "admin"
      ? [
          "Ana Sayfa",
          "Yoklama",
          "Gün Sonu",
          "Geçmiş",
          "Dersler",
          "Entegrasyon",
          "Ayarlar",
        ]
      : profile.role === "parent"
        ? ["Ana Sayfa", "Veli Merkezi", "Ayarlar"]
        : [
            "Ana Sayfa",
            "Yoklama",
            "Geçmiş",
            "Entegrasyon",
            "Ayarlar",
          ];

  let content;

  if (active === "Veli Merkezi") {
    content = <ParentView />;
  } else if (active === "Yoklama") {
    content = <AttendanceView />;
  } else if (active === "Gün Sonu") {
    content = <ReviewView />;
  } else if (active === "Geçmiş") {
    content = <HistoryView />;
  } else if (active === "Dersler") {
    content = <AcademicView />;
  } else if (active === "Entegrasyon") {
    content = <IntegrationCenterView />;
  } else if (active === "Ayarlar") {
    content = (
      <>
        {profile.role === "admin" && <SchoolSettingsView />}
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Hesap</h3>
              <p>Oturum ve kullanıcı bilgileri.</p>
            </div>
          </div>

          <div className="empty-state compact">
            <strong>{profile.displayName}</strong>
            <p>
              {profile.email} ·{" "}
              {profile.role === "admin"
                ? "Yönetici"
                : profile.role === "parent"
                  ? "Veli"
                  : "Öğretmen"}
            </p>

            <button
              className="secondary"
              onClick={() => void logout()}
            >
              Çıkış Yap
            </button>
          </div>
        </section>
      </>
    );
  } else {
    content =
      profile.role === "parent" ? (
        <ParentView />
      ) : (
        <DashboardView onNavigate={setActive} />
      );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MEVCUT</strong>
            <span>Yoklama Sistemi</span>
          </div>
        </div>

        <nav>
          {navigation.map((item) => (
            <button
              key={item}
              className={
                active === item
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => setActive(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          MVP 0.4
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              DİJİTAL YOKLAMA
            </p>
            <h1>{active}</h1>
          </div>

          <div className="top-actions">
            <div className="user-chip">
              {profile.role === "admin"
                ? "Yönetici"
                : profile.role === "parent"
                  ? "Veli"
                  : "Öğretmen"}
            </div>

            <button
              className="logout"
              onClick={() => void logout()}
            >
              Çıkış
            </button>
          </div>
        </header>

        {content}
      </main>
    </div>
  );
}
