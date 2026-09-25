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
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState(1);
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
  const [detailClass, setDetailClass] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [report, setReport] = useState<Awaited<ReturnType<typeof getDailyReport>>>(null);
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!profile?.organizationId) return;
    setLoading(true);
    setError("");

    try {
      const classItems = await getSchoolClasses(profile.organizationId);
      const [studentItems, lessonItems, dailyItems, reportItem, settings] =
        await Promise.all([
          Promise.all(
            classItems.map((item) =>
              getClassStudents(profile.organizationId, item.code)
            )
          ).then((groups) => groups.flat()),
          getLessonAttendances(profile.organizationId, date),
          getDailyAttendance(profile.organizationId, date),
          getDailyReport(profile.organizationId, date),
          getSchoolSettings(profile.organizationId),
        ]);

      setClasses(classItems);
      setStudents(Array.isArray(studentItems) ? studentItems : []);
      setLessons(lessonItems);
      setDaily(dailyItems);
      setReport(reportItem);
      setSchoolSettings(settings);
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
      const allStudents = await Promise.all(
        classItems.map((item) =>
          getClassStudents(profile.organizationId, item.code)
        )
      ).then((groups) => groups.flat());
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
    if (
      !window.confirm(
        "Gün sonu raporu onaylanacak, kilitlenecek ve onaylanan sonuçlar e-Okul aktarım kuyruğuna alınacak. Devam edilsin mi?"
      )
    ) return;

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

  const expectedPeriods =
    schoolSettings?.lessonCount ||
    lessons.reduce((max, lesson) => Math.max(max, lesson.period || 0), 0);

  const classSummaries = useMemo(() => {
    return classes
      .map((item) => {
        const classStudents = students.filter(
          (student) => student.classCode === item.code
        );
        const classLessons = lessons.filter(
          (lesson) => lesson.classCode === item.code
        );
        const submittedPeriods = new Set(
          classLessons.map((lesson) => lesson.period).filter(Boolean)
        ).size;
        const classDaily = daily.filter(
          (student) => student.classCode === item.code
        );
        const problemCount =
          classDaily.filter(
            (student) =>
              student.hasIntermediateAbsence ||
              student.systemResult === "unknown"
          ).length +
          (expectedPeriods > 0
            ? Math.max(expectedPeriods - submittedPeriods, 0)
            : 0);

        let state: "ready" | "missing" | "review" | "empty" = "ready";
        if (submittedPeriods === 0) state = "empty";
        else if (problemCount > 0 && classDaily.some((student) => student.hasIntermediateAbsence)) {
          state = "review";
        } else if (submittedPeriods < expectedPeriods) {
          state = "missing";
        } else if (problemCount > 0) {
          state = "review";
        }

        return {
          ...item,
          studentCount: classStudents.length,
          submittedPeriods,
          problemCount,
          state,
        };
      })
      .filter((item) =>
        normalize(item.name).includes(normalize(search))
      );
  }, [classes, students, lessons, daily, expectedPeriods, search]);

  const totalExpected = classes.length * expectedPeriods;
  const submittedPairs = classes.reduce((sum, item) => {
    const periods = new Set(
      lessons
        .filter((lesson) => lesson.classCode === item.code)
        .map((lesson) => lesson.period)
        .filter(Boolean)
    ).size;
    return sum + Math.min(periods, expectedPeriods);
  }, 0);
  const completionPercent =
    totalExpected > 0
      ? Math.round((submittedPairs / totalExpected) * 100)
      : 0;

  const presentCount = daily.filter((item) => item.finalResult === "present").length;
  const halfDayCount = daily.filter((item) => item.finalResult === "half_day").length;
  const fullDayCount = daily.filter((item) => item.finalResult === "full_day").length;
  const lateCount = daily.filter((item) => item.finalResult === "late").length;
  const reviewCount = daily.filter(
    (item) => item.hasIntermediateAbsence || item.systemResult === "unknown"
  ).length;

  const visibleClasses = selectedClass
    ? classSummaries.filter((item) => item.code === selectedClass)
    : classSummaries;

  const detailStudents = students.filter(
    (student) => student.classCode === detailClass
  );
  const detailLessons = lessons
    .filter((lesson) => lesson.classCode === detailClass)
    .sort((a, b) => a.period - b.period);
  const detailDaily = daily.filter(
    (item) => item.classCode === detailClass
  );
  const detailPeriods = Array.from(
    new Set(detailLessons.map((lesson) => lesson.period).filter(Boolean))
  ).sort((a, b) => a - b);
  const detailLessonByPeriod = new Map(
    detailLessons.map((lesson) => [lesson.period, lesson])
  );

  const statusShort = (status?: LessonAttendanceRecord["status"]) =>
    ({
      present: "Var",
      absent: "Yok",
      full_day: "Tam",
      half_day: "½",
      late: "Geç",
      unknown: "—",
    }[status || "unknown"]);

  const statusTitle = (status?: LessonAttendanceRecord["status"]) =>
    ({
      present: "Var",
      absent: "Yok",
      full_day: "Tam Gün",
      half_day: "Yarım Gün",
      late: "Geç",
      unknown: "Bilinmiyor",
    }[status || "unknown"]);

  const getStudentLessonStatus = (
    studentNo: string,
    period: number
  ) => {
    const lesson = detailLessonByPeriod.get(period);
    return lesson?.records.find(
      (record) => record.studentNo === studentNo
    )?.status;
  };

  const selectClass = (code: string) => {
    setSelectedClass(code);
    setDetailClass(code);
  };

  return (
    <section className="eod-page">
      <div className="eod-commandbar">
        <div className="eod-command-copy">
          <p className="eod-eyebrow">YÖNETİCİ ÇALIŞMA ALANI</p>
          <p className="eod-subtitle">
            {formatDate(date)} · Gün içindeki yoklamaları kontrol edin, gerekli düzeltmeleri yapın ve gün sonunu onaylayın.
          </p>
        </div>

        <div className="eod-header-actions">
          <button
            className="eod-btn ghost"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            ↻ <span>Yenile</span>
          </button>
          <button
            className="eod-btn blue"
            onClick={() => void calculate()}
            disabled={busy}
          >
            {busy ? "Hesaplanıyor..." : "⚙ Gün Sonunu Oluştur / Güncelle"}
          </button>
          <button
            className="eod-btn green"
            onClick={() => void approve()}
            disabled={busy || !daily.length || Boolean(report?.locked)}
          >
            ✓ Onayla ve e-Okula Aktar
          </button>
        </div>
      </div>

      <div className="eod-datebar">
        <label>
          <span>Tarih</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          <span>Sınıf</span>
          <select
            value={selectedClass}
            onChange={(e) => {
              setSelectedClass(e.target.value);
              setDetailClass(e.target.value);
            }}
          >
            <option value="">Tüm Sınıflar</option>
            {classes.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="eod-lock-state">
          <span className={report?.locked ? "dot locked" : "dot"} />
          {report?.locked ? "Gün sonu kilitli" : report?.status === "approved" ? "Onaylı" : "Taslak / İnceleme"}
        </div>
      </div>

      {error && <div className="error-box eod-error">{error}</div>}

      <div className="eod-kpis">
        <div className="eod-kpi blue">
          <div className="eod-kpi-icon">▦</div>
          <div><strong>{classes.length}</strong><span>Toplam Sınıf</span><small>{classSummaries.filter((item) => item.state !== "empty").length} işlendi</small></div>
          <div className="eod-progress"><i style={{ width: (classes.length ? Math.round((classSummaries.filter((item) => item.state !== "empty").length / classes.length) * 100) : 0) + "%" }} /></div>
        </div>
        <div className="eod-kpi teal">
          <div className="eod-kpi-icon">●</div>
          <div><strong>{students.length}</strong><span>Toplam Öğrenci</span><small>{presentCount} mevcut</small></div>
          <div className="eod-progress"><i style={{ width: (students.length ? Math.min(100, Math.round((presentCount / students.length) * 100)) : 0) + "%" }} /></div>
        </div>
        <div className="eod-kpi indigo">
          <div className="eod-kpi-icon">◷</div>
          <div><strong>%{completionPercent}</strong><span>Yoklama Tamamlanma</span><small>{submittedPairs} / {totalExpected || "—"} ders</small></div>
          <div className="eod-progress"><i style={{ width: completionPercent + "%" }} /></div>
        </div>
        <div className="eod-mini-kpi green"><strong>{presentCount}</strong><span>Mevcut</span></div>
        <div className="eod-mini-kpi amber"><strong>{halfDayCount}</strong><span>Yarım Gün</span></div>
        <div className="eod-mini-kpi red"><strong>{fullDayCount}</strong><span>Tam Gün</span></div>
        <div className="eod-mini-kpi purple"><strong>{lateCount}</strong><span>Geç</span></div>
        <div className="eod-mini-kpi gray"><strong>{reviewCount}</strong><span>İncelenecek</span></div>
      </div>

      <section className="eod-card eod-classes-card">
          <div className="eod-card-header">
            <div>
              <h3>Sınıflar</h3>
              <p>Bir sınıfa tıklayın; o sınıftaki öğrencilerin ders ders yoklama durumunu açın.</p>
            </div>
            <div className="eod-legend">
              <span><i className="ready" /> Hazır</span>
              <span><i className="missing" /> Eksik</span>
              <span><i className="review" /> İnceleme</span>
              <span><i className="empty" /> Başlanmadı</span>
            </div>
          </div>

          <div className="eod-class-tools">
            <div className="eod-search">
              <span>⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sınıf ara..."
              />
            </div>
            <select
              value={selectedClass}
              onChange={(e) => selectClass(e.target.value)}
            >
              <option value="">Tümü</option>
              {classes.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
            {selectedClass && (
              <button
                className="eod-btn ghost small"
                onClick={() => { setSelectedClass(""); setDetailClass(""); }}
              >
                Tüm sınıfları göster
              </button>
            )}
          </div>

          <div className="eod-class-list">
            <div className="eod-class-list-head">
              <span>Sınıf</span>
              <span>Öğrenci</span>
              <span>Yoklama</span>
              <span>Sorun</span>
              <span>Durum</span>
              <span></span>
            </div>

            {visibleClasses.map((item) => (
              <button
                key={item.code}
                className={"eod-class-row " + item.state + (detailClass === item.code ? " selected" : "")}
                onClick={() => selectClass(item.code)}
              >
                <span className="eod-class-name">
                  <strong>{item.name}</strong>
                </span>
                <span>{item.studentCount}</span>
                <span>
                  <b>{item.submittedPeriods}</b> / {expectedPeriods || "—"} ders
                </span>
                <span className={item.problemCount ? "problem-count" : "zero-count"}>
                  {item.problemCount || 0}
                </span>
                <span>
                  <em className={"eod-state " + item.state}>
                    {item.state === "ready"
                      ? "✓ Hazır"
                      : item.state === "missing"
                        ? "● Eksik"
                        : item.state === "review"
                          ? "! İncele"
                          : "○ Başlanmadı"}
                  </em>
                </span>
                <span className="eod-class-arrow">›</span>
              </button>
            ))}

            {!visibleClasses.length && !loading && (
              <div className="eod-empty-inline">Aramanızla eşleşen sınıf bulunamadı.</div>
            )}
          </div>
        </section>

      {detailClass && (
        <section className="eod-card eod-detail-card">
          <div className="eod-detail-header">
            <div>
              <p className="eod-eyebrow">SINIF DETAYI</p>
              <h3>
                {classes.find((item) => item.code === detailClass)?.name || detailClass}
              </h3>
              <p>{detailStudents.length} öğrenci · {detailLessons.length ? detailPeriods.length + " ders yoklaması" : "Henüz ders yoklaması yok"}</p>
            </div>
            <div className="eod-detail-actions">
              <button className="eod-btn ghost small" onClick={() => { setSelectedClass(""); setDetailClass(""); }}>← Sınıflara Dön</button>
              <button className="eod-btn blue small" onClick={() => void calculate()} disabled={busy}>Gün Sonunu Güncelle</button>
            </div>
          </div>

          {detailStudents.length > 0 ? (
            <div className="eod-detail-table-wrap">
              <table className="eod-detail-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Öğrenci</th>
                    {detailPeriods.map((period) => {
                      const lesson = detailLessonByPeriod.get(period);
                      return (
                        <th key={period}>
                          <span>{period}. Ders</span>
                          <small>{lesson?.subjectName || "Ders"}</small>
                        </th>
                      );
                    })}
                    <th>Sistem</th>
                    <th>Nihai</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {detailStudents.map((student, index) => {
                    const item = detailDaily.find(
                      (dailyItem) => dailyItem.studentNo === student.studentNo
                    );
                    return (
                      <tr key={student.id}>
                        <td className="eod-index">{index + 1}</td>
                        <td className="eod-student">
                          <strong>{student.name}</strong>
                          <small>{student.studentNo}</small>
                          {item?.hasIntermediateAbsence && <em>🚨 Ara ders</em>}
                        </td>
                        {detailPeriods.map((period) => {
                          const status = getStudentLessonStatus(student.studentNo, period);
                          return (
                            <td key={period} className="eod-status-cell">
                              <span className={"eod-status-pill status-" + (status || "unknown")} title={statusTitle(status)}>
                                {statusShort(status)}
                              </span>
                            </td>
                          );
                        })}
                        <td>
                          <span className="eod-result system">{item ? dailyResultLabel(item.systemResult) : "—"}</span>
                        </td>
                        <td>
                          <span className="eod-result final">{item ? dailyResultLabel(item.finalResult) : "—"}</span>
                        </td>
                        <td>
                          {!report?.locked && item ? (
                            <div className="eod-row-actions">
                              <input
                                value={reason[item.id] || ""}
                                onChange={(e) =>
                                  setReason((current) => ({
                                    ...current,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                placeholder="Gerekçe"
                              />
                              <div>
                                <button className="present" onClick={() => void override(item, "present")} disabled={busy}>Var</button>
                                <button className="absent" onClick={() => void override(item, "full_day")} disabled={busy}>Yok</button>
                                <button className="late" onClick={() => void override(item, "late")} disabled={busy}>Geç</button>
                              </div>
                            </div>
                          ) : (
                            <span className="eod-locked">🔒 Kilitli</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="eod-detail-empty">
              Bu sınıf için öğrenci verisi bulunamadı.
            </div>
          )}

          <div className="eod-detail-legend">
            <span><b className="status-present">Var</b></span>
            <span><b className="status-absent">Yok</b></span>
            <span><b className="status-late">Geç</b></span>
            <span><b className="status-unknown">—</b> Bilgi yok</span>
            <span>🚨 Ara ders devamsızlığı</span>
          </div>
        </section>
      )}

      {!detailClass && !loading && (
        <div className="eod-bottom-note">
          <span>
            {classes.length} sınıf · {students.length} öğrenci · {lessons.length} ders yoklaması
          </span>
          <span>
            {report?.locked ? "🔒 Gün sonu kilitli" : "Kontrol bittikten sonra gün sonunu onaylayıp e-Okul aktarımını başlatabilirsiniz."}
          </span>
        </div>
      )}

      {detailClass && (
        <div className="eod-approval-bar">
          <div>
            <strong>{report?.locked ? "Gün sonu kilitli" : "Son kontrol tamamlandı mı?"}</strong>
            <span>Onay, nihai sonuçları kilitler ve onaylanan kayıtları e-Okul aktarım kuyruğuna gönderir.</span>
          </div>
          <button
            className="eod-btn green"
            onClick={() => void approve()}
            disabled={busy || !daily.length || Boolean(report?.locked)}
          >
            ✓ Onayla ve e-Okula Aktar
          </button>
        </div>
      )}
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
  const [lessonCount, setLessonCount] = useState(8);
  const [dayStartTime, setDayStartTime] = useState("08:30");
  const [lessonDurationMinutes, setLessonDurationMinutes] = useState(40);
  const [breakDurationMinutes, setBreakDurationMinutes] = useState(10);
  const [lunchEnabled, setLunchEnabled] = useState(true);
  const [lunchDurationMinutes, setLunchDurationMinutes] = useState(45);
  const [lunchAfterPeriod, setLunchAfterPeriod] = useState(4);
  const [lessonTimes, setLessonTimes] =
    useState<SchoolSettings["lessonTimes"]>([]);
  const [source, setSource] =
    useState<SchoolSettings["source"]>("manual");
  const [settingsTab, setSettingsTab] =
    useState<"general" | "lessons" | "classes" | "other">("lessons");
  const [schoolClasses, setSchoolClasses] = useState<SchoolClass[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const addMinutes = (time: string, minutes: number) => {
    const [hours, mins] = time.split(":").map(Number);
    const total = hours * 60 + mins + minutes;
    const normalized = ((total % 1440) + 1440) % 1440;
    return (
      String(Math.floor(normalized / 60)).padStart(2, "0") +
      ":" +
      String(normalized % 60).padStart(2, "0")
    );
  };

  const buildLessonTimes = (
    options?: Partial<{
      lessonCount: number;
      dayStartTime: string;
      lessonDurationMinutes: number;
      breakDurationMinutes: number;
      lunchEnabled: boolean;
      lunchDurationMinutes: number;
      lunchAfterPeriod: number;
    }>
  ): SchoolSettings["lessonTimes"] => {
    const nextLessonCount = options?.lessonCount ?? lessonCount;
    const nextDayStartTime = options?.dayStartTime ?? dayStartTime;
    const nextLessonDuration = options?.lessonDurationMinutes ?? lessonDurationMinutes;
    const nextBreakDuration = options?.breakDurationMinutes ?? breakDurationMinutes;
    const nextLunchEnabled = options?.lunchEnabled ?? lunchEnabled;
    const nextLunchDuration = options?.lunchDurationMinutes ?? lunchDurationMinutes;
    const nextLunchAfterPeriod = options?.lunchAfterPeriod ?? lunchAfterPeriod;

    const generated: SchoolSettings["lessonTimes"] = [];
    let cursor = nextDayStartTime;

    for (let period = 1; period <= nextLessonCount; period += 1) {
      const startTime = cursor;
      const endTime = addMinutes(startTime, nextLessonDuration);
      generated.push({ period, startTime, endTime });

      if (period < nextLessonCount) {
        const pause =
          nextLunchEnabled && period === nextLunchAfterPeriod
            ? nextLunchDuration
            : nextBreakDuration;
        cursor = addMinutes(endTime, pause);
      }
    }

    return generated;
  };

  const generateLessonTimes = () => {
    setLessonTimes(buildLessonTimes());
    setMessage("Ders saatleri otomatik oluşturuldu.");
    setError("");
  };

  const load = async () => {
    if (!profile?.organizationId) return;
    setLoading(true);
    setError("");

    try {
      const settings = await getSchoolSettings(profile.organizationId);

      if (settings) {
        setLessonCount(settings.lessonCount || 8);
        setDayStartTime(
          settings.dayStartTime ||
            settings.lessonTimes[0]?.startTime ||
            "08:30"
        );
        setLessonDurationMinutes(
          settings.lessonDurationMinutes || 40
        );
        setBreakDurationMinutes(
          settings.breakDurationMinutes ?? 10
        );
        setLunchEnabled(settings.lunchEnabled !== false);
        setLunchDurationMinutes(
          settings.lunchDurationMinutes ?? 45
        );
        setLunchAfterPeriod(
          settings.lunchAfterPeriod || 4
        );
        setLessonTimes(settings.lessonTimes || []);
        setSource(settings.source || "manual");
      } else {
        setLessonTimes([]);
      }
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.organizationId]);

  useEffect(() => {
    if (settingsTab !== "classes" || !profile?.organizationId) return;
    setClassesLoading(true);
    getSchoolClasses(profile.organizationId)
      .then(setSchoolClasses)
      .catch((err) => setError((err as Error)?.message || String(err)))
      .finally(() => setClassesLoading(false));
  }, [settingsTab, profile?.organizationId]);

  const changeCount = (value: number) => {
    const nextCount = Math.max(1, Math.min(20, value || 1));
    setLessonCount(nextCount);
    setLunchAfterPeriod((current) =>
      Math.min(current, Math.max(nextCount - 1, 1))
    );
  };

  const save = async () => {
    if (!profile?.organizationId || !user?.uid || !lessonCount) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const timesToSave = buildLessonTimes();
      setLessonTimes(timesToSave);

      await saveSchoolSettings({
        organizationId: profile.organizationId,
        lessonCount,
        dayStartTime,
        lessonDurationMinutes,
        breakDurationMinutes,
        lunchEnabled,
        lunchDurationMinutes,
        lunchAfterPeriod: lunchEnabled ? lunchAfterPeriod : 0,
        lessonTimes: timesToSave,
        updatedBy: user.uid,
        source: "manual",
      });

      setSource("manual");
      setMessage("Okul ders saati ayarları kaydedildi.");
      await load();
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = () => {
    const times = buildLessonTimes();
    setLessonTimes(times);
    setMessage("Tablo yeni ayarlara göre güncellendi.");
    setError("");
  };

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <div>
          <span className="eyebrow">AYARLAR</span>
          <h2>Okul Bilgileri</h2>
          <p>
            Okulunuza ait temel bilgileri ve ders saati düzenini yönetin.
          </p>
        </div>

        <span className="settings-source">
          <span className="settings-source-dot" />
          {source === "e-okul" ? "e-Okul'dan alındı" : "Manuel ayar"}
        </span>
      </div>

      <div className="settings-tabs" aria-label="Okul ayarları">
        <button type="button" className={settingsTab === "general" ? "active" : ""} onClick={() => setSettingsTab("general")}>Genel Bilgiler</button>
        <button type="button" className={settingsTab === "lessons" ? "active" : ""} onClick={() => setSettingsTab("lessons")}><span>◷</span> Ders Saati Ayarları</button>
        <button type="button" className={settingsTab === "classes" ? "active" : ""} onClick={() => setSettingsTab("classes")}>Sınıflar</button>
        <button type="button" className={settingsTab === "other" ? "active" : ""} onClick={() => setSettingsTab("other")}>⚙ Diğer Ayarlar</button>
      </div>

      {loading && (
        <div className="settings-message info-box">
          <span>Okul ayarları yükleniyor...</span>
        </div>
      )}

      {error && <div className="settings-message error-box">{error}</div>}
      {message && (
        <div className="settings-message success-box">{message}</div>
      )}

      {!loading && settingsTab === "general" && (
        <div className="settings-info-grid">
          <section className="settings-card">
            <div className="settings-card-header"><div className="settings-card-icon">⌂</div><div><h3>Okul ve Hesap Bilgileri</h3><p>MEVCUT'ta kullanılan kurum ve yönetici bilgileri.</p></div></div>
            <div className="settings-detail-list">
              <div><span>Organizasyon</span><strong>{profile?.organizationId || "—"}</strong></div>
              <div><span>Kullanıcı</span><strong>{profile?.displayName || user?.email || "—"}</strong></div>
              <div><span>Rol</span><strong>{profile?.role === "admin" ? "Yönetici" : profile?.role || "—"}</strong></div>
              <div><span>Ders sayısı</span><strong>{lessonCount} ders</strong></div>
            </div>
          </section>
          <section className="settings-card">
            <div className="settings-card-header"><div className="settings-card-icon">✓</div><div><h3>Gün Sonu Akışı</h3><p>Yoklama verisinin sistemde izlediği süreç.</p></div></div>
            <div className="settings-flow"><span>Öğretmen yoklaması</span><b>→</b><span>Gün sonu</span><b>→</b><span>Yönetici onayı</span><b>→</b><span>e-Okul</span></div>
          </section>
        </div>
      )}

      {!loading && settingsTab === "classes" && (
        <section className="settings-card settings-classes-card">
          <div className="settings-card-header"><div className="settings-card-icon">▦</div><div><h3>Sınıflar</h3><p>Sistemde tanımlı sınıf ve şubeler.</p></div><span className="preview-count">{schoolClasses.length} sınıf</span></div>
          {classesLoading ? <div className="settings-empty">Sınıflar yükleniyor...</div> : !schoolClasses.length ? <div className="settings-empty">Henüz sınıf bulunmuyor. Entegrasyon Merkezi'nden e-Okul verilerini aktarabilirsiniz.</div> : <div className="class-settings-grid">{schoolClasses.map((item) => <div className="class-setting-item" key={item.code}><strong>{item.name}</strong><span>{item.code}</span></div>)}</div>}
        </section>
      )}

      {!loading && settingsTab === "other" && (
        <div className="settings-info-grid">
          <section className="settings-card">
            <div className="settings-card-header"><div className="settings-card-icon">⚙</div><div><h3>Sistem Ayarları</h3><p>V1'de sabit çalışan sistem davranışları.</p></div></div>
            <div className="settings-detail-list">
              <div><span>Gün sonu onayı</span><strong>Yönetici zorunlu</strong></div>
              <div><span>e-Okul aktarımı</span><strong>Onay sonrası</strong></div>
              <div><span>Öğretmen sınıf seçimi</span><strong>Manuel</strong></div>
              <div><span>Ders programı otomasyonu</span><strong>V1'de pasif</strong></div>
            </div>
          </section>
          <section className="settings-card">
            <div className="settings-card-header"><div className="settings-card-icon">🔔</div><div><h3>Bildirimler</h3><p>Veli bildirimleri mevcut bildirim altyapısından yönetilir.</p></div></div>
            <div className="settings-help"><strong>ℹ</strong><span>Burada henüz değiştirilebilir bir seçenek yok; sahte ayar eklemedim.</span></div>
          </section>
        </div>
      )}

      {!loading && settingsTab === "lessons" && (
        <div className="settings-layout">
          <section className="settings-card settings-form-card">
            <div className="settings-card-header">
              <div className="settings-card-icon">◷</div>
              <div>
                <h3>Ders Saati Ayarları</h3>
                <p>
                  Ders düzenini belirleyin, saat tablosu otomatik oluşsun.
                </p>
              </div>
              <button
                type="button"
                className="settings-eokul-button"
                disabled
                title="e-Okul ders saati entegrasyonu sonraki sürümde"
              >
                ↓ e-Okul'dan Al
              </button>
            </div>

            <div className="settings-help">
              <strong>ℹ Otomatik hesaplama</strong>
              <span>
                Bu ayarlarla okulunuzun tüm ders saatleri otomatik
                hesaplanır. Ayarları değiştirdiğinizde tabloyu yeniden
                oluşturabilirsiniz.
              </span>
            </div>

            <div className="settings-form-grid">
              <label className="settings-field">
                <span>1. Ders Başlangıç Saati</span>
                <div className="settings-input-wrap">
                  <span>◷</span>
                  <input
                    type="time"
                    value={dayStartTime}
                    onChange={(e) => setDayStartTime(e.target.value)}
                  />
                </div>
              </label>

              <label className="settings-field">
                <span>Ders Sayısı</span>
                <div className="settings-input-wrap">
                  <span>▥</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={lessonCount}
                    onChange={(e) =>
                      changeCount(Number(e.target.value))
                    }
                  />
                </div>
              </label>

              <label className="settings-field">
                <span>Ders Süresi <em>(dakika)</em></span>
                <div className="settings-input-wrap">
                  <span>◷</span>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={lessonDurationMinutes}
                    onChange={(e) =>
                      setLessonDurationMinutes(Number(e.target.value))
                    }
                  />
                </div>
              </label>

              <label className="settings-field">
                <span>Teneffüs Süresi <em>(dakika)</em></span>
                <div className="settings-input-wrap">
                  <span>☕</span>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={breakDurationMinutes}
                    onChange={(e) =>
                      setBreakDurationMinutes(Number(e.target.value))
                    }
                  />
                </div>
              </label>
            </div>

            <div
              className={
                lunchEnabled
                  ? "lunch-settings enabled"
                  : "lunch-settings"
              }
            >
              <div className="lunch-header">
                <div>
                  <strong>Öğle Arası</strong>
                  <span>Öğle arası uygulanacak mı?</span>
                </div>

                <label className="switch">
                  <input
                    type="checkbox"
                    checked={lunchEnabled}
                    onChange={(e) => setLunchEnabled(e.target.checked)}
                  />
                  <span className="switch-track" />
                  <b>{lunchEnabled ? "Uygulanacak" : "Yok"}</b>
                </label>
              </div>

              {lunchEnabled ? (
                <div className="lunch-grid">
                  <label className="settings-field">
                    <span>Öğle Arası Hangi Dersten Sonra?</span>
                    <div className="settings-input-wrap">
                      <span>▥</span>
                      <select
                        value={lunchAfterPeriod}
                        onChange={(e) =>
                          setLunchAfterPeriod(Number(e.target.value))
                        }
                      >
                        {Array.from(
                          { length: Math.max(lessonCount - 1, 1) },
                          (_, index) => index + 1
                        ).map((period) => (
                          <option key={period} value={period}>
                            {period}. dersten sonra
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>

                  <label className="settings-field">
                    <span>Öğle Arası Süresi <em>(dakika)</em></span>
                    <div className="settings-input-wrap">
                      <span>🍴</span>
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={lunchDurationMinutes}
                        onChange={(e) =>
                          setLunchDurationMinutes(Number(e.target.value))
                        }
                      />
                    </div>
                  </label>
                </div>
              ) : (
                <div className="lunch-disabled-note">
                  Öğle arası kapalı. Tüm ders aralarında yalnızca teneffüs
                  süresi kullanılacak.
                </div>
              )}
            </div>

            <div className="settings-actions">
              <button
                type="button"
                className="secondary settings-reset"
                onClick={() => {
                  setDayStartTime("08:30");
                  setLessonCount(8);
                  setLessonDurationMinutes(40);
                  setBreakDurationMinutes(10);
                  setLunchEnabled(true);
                  setLunchDurationMinutes(45);
                  setLunchAfterPeriod(4);
                  setLessonTimes(
                    buildLessonTimes({
                      dayStartTime: "08:30",
                      lessonCount: 8,
                      lessonDurationMinutes: 40,
                      breakDurationMinutes: 10,
                      lunchEnabled: true,
                      lunchDurationMinutes: 45,
                      lunchAfterPeriod: 4,
                    })
                  );
                  setMessage("Varsayılan değerler yüklendi.");
                }}
              >
                ↻ Varsayılanları Yükle
              </button>

              <button
                type="button"
                className="primary settings-generate"
                onClick={regenerate}
              >
                ▣ Ders Saatlerini Oluştur
              </button>
            </div>
          </section>

          <section className="settings-card settings-preview-card">
            <div className="settings-card-header preview-header">
              <div className="settings-card-icon">▣</div>
              <div>
                <h3>Oluşacak Ders Programı</h3>
                <p>
                  Ayarlarınıza göre hesaplanan ders ve teneffüs saatleri.
                </p>
              </div>
              <span className="preview-count">
                {lessonCount} Ders
                {lunchEnabled ? " · 1 Öğle Arası" : ""}
              </span>
            </div>

            <div className="schedule-table-wrap">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tür</th>
                    <th>Başlangıç</th>
                    <th>Bitiş</th>
                    <th>Süre</th>
                  </tr>
                </thead>
                <tbody>
                  {lessonTimes.length ? (
                    lessonTimes.flatMap((item) => {
                      const rows = [
                        <tr key={"lesson-" + item.period}>
                          <td>{item.period}</td>
                          <td>
                            <span className="schedule-type lesson">
                              ▫ {item.period}. Ders
                            </span>
                          </td>
                          <td>{item.startTime}</td>
                          <td>{item.endTime}</td>
                          <td>{lessonDurationMinutes} dk</td>
                        </tr>,
                      ];

                      if (item.period < lessonCount) {
                        const isLunch =
                          lunchEnabled &&
                          item.period === lunchAfterPeriod;
                        rows.push(
                          <tr
                            key={"pause-" + item.period}
                            className={isLunch ? "lunch-row" : ""}
                          >
                            <td>—</td>
                            <td>
                              <span
                                className={
                                  isLunch
                                    ? "schedule-type lunch"
                                    : "schedule-type break"
                                }
                              >
                                {isLunch ? "🍴 Öğle Arası" : "☕ Teneffüs"}
                              </span>
                            </td>
                            <td>{item.endTime}</td>
                            <td>
                              {addMinutes(
                                item.endTime,
                                isLunch
                                  ? lunchDurationMinutes
                                  : breakDurationMinutes
                              )}
                            </td>
                            <td>
                              {isLunch
                                ? lunchDurationMinutes
                                : breakDurationMinutes}{" "}
                              dk
                            </td>
                          </tr>
                        );
                      }

                      return rows;
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="schedule-empty">
                        Ders saatlerini oluşturmak için soldaki ayarları
                        doldurun.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="preview-footer">
              <span>
                Öğle arası kapalıysa tabloda öğle arası satırı oluşturulmaz.
              </span>
              <button
                type="button"
                className="secondary"
                onClick={regenerate}
              >
                ✎ Tabloyu Yenile
              </button>
            </div>

            <div className="settings-save-bar">
              <span>
                {source === "e-okul"
                  ? "e-Okul kaynaklı saatler yüklendi."
                  : "Değişiklikleri kaydettiğinizde yoklama ekranına uygulanır."}
              </span>
              <button
                type="button"
                className="primary"
                onClick={save}
                disabled={saving || !lessonCount}
              >
                {saving ? "Kaydediliyor..." : "Okul Bilgilerini Kaydet"}
              </button>
            </div>
          </section>
        </div>
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
