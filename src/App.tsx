import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "./context/AuthContext";
import { signInWithEmailAndPassword } from "./firebase/auth";
import {
  getClassStudents,
  getSchoolClasses,
  getAttendance,
  importEOkulData,
  type AttendanceStatus,
  type SchoolClass,
  type SchoolStudent,
} from "./firebase/school";
import {
  getSchedule,
  getTeacherAssignments,
  importAcademicData,
} from "./firebase/academic";
import {
  getLessonAttendances,
  reviewLessonAttendance,
  saveLessonAttendance,
} from "./firebase/attendance";
import type {
  AttendanceRuleViolation,
  LessonAttendance,
  LessonAttendanceRecord,
  ScheduleEntry,
  TeacherAssignment,
} from "./types/academic";
import { evaluateAttendanceRules } from "./rules/attendance";
import { getCurrentLesson } from "./utils/lesson";
import {
  getEOkulQueue,
  getLessonAttendanceById,
  updateEOkulQueue,
} from "./firebase/integration";
import type { EOkulImportPayload } from "./types/school";

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: "Var",
  full_day: "Tam Gün",
  half_day: "Yarım Gün",
  late: "Geç",
  unknown: "Bilinmiyor",
};

const lessonStatusLabels: Record<LessonAttendanceRecord["status"], string> = {
  present: "Var",
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
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [lessonRecords, setLessonRecords] = useState<LessonAttendance[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [selectionMode, setSelectionMode] = useState<"auto" | "manual">("auto");
  const [date, setDate] = useState(todayLocal());
  const [now, setNow] = useState(new Date());
  const [statuses, setStatuses] =
    useState<Record<string, LessonAttendanceRecord["status"]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ruleWarnings, setRuleWarnings] = useState<AttendanceRuleViolation[]>([]);

  const teacherName =
    profile?.role === "teacher" ? profile.displayName : undefined;

  const visibleClasses = useMemo(() => {
    if (profile?.role !== "teacher" || !assignments.length) {
      return classes;
    }

    const codes = new Set(assignments.map((item) => item.classCode));
    return classes.filter((item) => codes.has(item.code));
  }, [assignments, classes, profile?.role]);

  const selectedLesson =
    schedule.find((item) => item.id === selectedLessonId) || null;

  const currentLesson =
    date === todayLocal()
      ? getCurrentLesson(schedule, now)
      : null;

  const selectedClassName =
    visibleClasses.find((item) => item.code === selectedClass)?.name || "";

  const subjectOptions = assignments.filter(
    (item) => item.classCode === selectedClass
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!profile?.organizationId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const [classItems, assignmentItems] = await Promise.all([
          getSchoolClasses(profile.organizationId),
          getTeacherAssignments(
            profile.organizationId,
            teacherName
          ),
        ]);

        if (cancelled) return;

        setClasses(classItems);
        setAssignments(assignmentItems);

        const available =
          profile.role === "teacher" && assignmentItems.length
            ? classItems.filter((item) =>
                assignmentItems.some(
                  (assignment) =>
                    assignment.classCode === item.code
                )
              )
            : classItems;

        setSelectedClass(
          (current) =>
            current ||
            available[0]?.code ||
            classItems[0]?.code ||
            ""
        );
      } catch (err) {
        if (!cancelled) {
          setError((err as Error)?.message || String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [profile?.organizationId, profile?.role, teacherName]);

  useEffect(() => {
    if (!profile?.organizationId || !date) return;

    let cancelled = false;

    const day = new Date(date + "T12:00:00").getDay();
    const dayOfWeek = day === 0 ? 7 : day;

    getSchedule(
      profile.organizationId,
      dayOfWeek,
      teacherName
    )
      .then((items) => {
        if (cancelled) return;

        setSchedule(items);
        setSelectionMode("auto");

        const autoLesson =
          date === todayLocal()
            ? getCurrentLesson(items, new Date())
            : null;

        setSelectedLessonId(
          autoLesson?.id ||
            items[0]?.id ||
            ""
        );

        if (autoLesson) {
          setSelectedClass(autoLesson.classCode);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSchedule([]);
          setSelectedLessonId("");
          setError((err as Error)?.message || String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [date, profile?.organizationId, teacherName]);

  useEffect(() => {
    if (
      selectionMode !== "auto" ||
      date !== todayLocal() ||
      !schedule.length
    ) {
      return;
    }

    const current = getCurrentLesson(schedule, now);
    if (current) {
      setSelectedLessonId(current.id);
      setSelectedClass(current.classCode);
    }
  }, [date, now, schedule, selectionMode]);

  useEffect(() => {
    if (!profile?.organizationId || !selectedClass || !date) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      setMessage("");
      setRuleWarnings([]);

      try {
        const teacherUid =
          profile.role === "teacher" ? user?.uid : undefined;

        const [studentItems, lessonItems, legacy] =
          await Promise.all([
            getClassStudents(
              profile.organizationId,
              selectedClass
            ),
            getLessonAttendances(
              profile.organizationId,
              date,
              teacherUid
            ),
            getAttendance(
              profile.organizationId,
              selectedClass,
              date
            ),
          ]);

        if (cancelled) return;

        setStudents(studentItems);
        setLessonRecords(lessonItems);

        const existingLesson = lessonItems.find((item) => {
          if (selectedLesson) {
            return (
              item.classCode === selectedLesson.classCode &&
              item.period === selectedLesson.period &&
              item.subjectCode === selectedLesson.subjectCode &&
              item.teacherUid === user?.uid
            );
          }

          return (
            item.classCode === selectedClass &&
            item.period === 0 &&
            item.teacherUid === user?.uid
          );
        });

        const existing =
          existingLesson?.records?.length
            ? existingLesson.records
            : legacy;

        const next: Record<
          string,
          LessonAttendanceRecord["status"]
        > = {};

        studentItems.forEach((student) => {
          next[student.studentNo] = "present";
        });

        existing.forEach((record) => {
          next[record.studentNo] =
            record.status as LessonAttendanceRecord["status"];
        });

        setStatuses(next);
        setRuleWarnings(existingLesson?.ruleViolations || []);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error)?.message || String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    date,
    profile?.organizationId,
    profile?.role,
    selectedClass,
    selectedLessonId,
    user?.uid,
  ]);

  const setStatus = (
    studentNo: string,
    status: LessonAttendanceRecord["status"]
  ) => {
    setStatuses((current) => ({
      ...current,
      [studentNo]: status,
    }));
    setMessage("");
  };

  const markAllPresent = () => {
    const next: Record<
      string,
      LessonAttendanceRecord["status"]
    > = {};

    students.forEach((student) => {
      next[student.studentNo] = "present";
    });

    setStatuses(next);
    setRuleWarnings([]);
    setMessage("");
  };

  const save = async () => {
    if (!profile?.organizationId || !user?.uid) return;
    if (!selectedClass || !students.length) return;

    const assignment = subjectOptions[0] || null;

    const subjectCode =
      selectedLesson?.subjectCode ||
      assignment?.subjectCode ||
      "manual";

    const subjectName =
      selectedLesson?.subjectName ||
      assignment?.subjectName ||
      "Günlük Yoklama";

    const records = students.map((student) => ({
      studentNo: student.studentNo,
      status:
        statuses[student.studentNo] ||
        "unknown",
    }));

    const previousLesson =
      selectedLesson && selectedLesson.period > 0
        ? lessonRecords
            .filter(
              (item) =>
                item.classCode ===
                  (selectedLesson.classCode || selectedClass) &&
                item.teacherUid === user.uid &&
                item.period > 0 &&
                item.period < selectedLesson.period
            )
            .sort((a, b) => b.period - a.period)[0]
        : undefined;

    const violations = evaluateAttendanceRules({
      currentRecords: records,
      previousRecords: previousLesson?.records,
    });

    setRuleWarnings(violations);

    if (records.some((item) => item.status === "unknown")) {
      setError(
        "Bilinmiyor durumundaki öğrenciler kaydedilebilir ancak yönetici incelemesi gerekir."
      );
    } else if (!violations.length) {
      setError("");
    }

    setSaving(true);
    setMessage("");

    try {
      await saveLessonAttendance({
        organizationId: profile.organizationId,
        date,
        classCode: selectedLesson?.classCode || selectedClass,
        className:
          selectedLesson?.className ||
          selectedClassName,
        subjectCode,
        subjectName,
        teacherUid: user.uid,
        teacherName: profile.displayName,
        period: selectedLesson?.period || 0,
        records,
        ruleViolations: violations,
      });

      setLessonRecords((current) => [
        ...current.filter((item) =>
          item.id !== selectedLessonId
        ),
        {
          id: selectedLessonId || "local",
          organizationId: profile.organizationId,
          date,
          classCode: selectedLesson?.classCode || selectedClass,
          className:
            selectedLesson?.className ||
            selectedClassName,
          subjectCode,
          subjectName,
          teacherUid: user.uid,
          teacherName: profile.displayName,
          period: selectedLesson?.period || 0,
          lessonKey: selectedLessonId || "local",
          records,
          reviewStatus: "submitted",
          updatedBy: user.uid,
          ruleViolations: violations,
        },
      ]);

      setMessage(
        violations.length
          ? "Yoklama kaydedildi. Kural uyarıları yönetici incelemesinde görülebilir."
          : "Yoklama kaydedildi ve yönetici incelemesine gönderildi."
      );
    } catch (err) {
      setError((err as Error)?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const counts = students.reduce(
    (acc, student) => {
      const status =
        statuses[student.studentNo] || "unknown";
      acc[status] += 1;
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
    <section className="panel attendance-panel">
      <div className="panel-header attendance-header">
        <div>
          <h3>Yoklama</h3>
          <p>
            Ders programı aktarılmışsa mevcut ders otomatik seçilir.
            Program yoksa sınıfı ve dersi elle seçebilirsiniz.
          </p>
        </div>

        <div className="attendance-actions">
          <select
            value={selectedClass}
            onChange={(e) => {
              setSelectedClass(e.target.value);
              setSelectionMode("manual");
              setSelectedLessonId("");
            }}
            disabled={!visibleClasses.length}
          >
            {!visibleClasses.length && (
              <option value="">Sınıf bulunamadı</option>
            )}

            {visibleClasses.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectionMode("auto");
            }}
          />
        </div>
      </div>

      {schedule.length > 0 && (
        <div className="lesson-strip">
          {schedule.map((item) => {
            const isCurrent = currentLesson?.id === item.id;

            return (
              <button
                key={item.id}
                className={
                  selectedLessonId === item.id
                    ? "lesson-card active"
                    : "lesson-card"
                }
                onClick={() => {
                  setSelectionMode("manual");
                  setSelectedLessonId(item.id);
                  setSelectedClass(item.classCode);
                }}
              >
                <strong>
                  {item.period}. Ders
                  {isCurrent ? " · ŞU AN" : ""}
                </strong>
                <span>{item.className}</span>
                <small>{item.subjectName}</small>
                {item.startTime && (
                  <small>
                    {item.startTime}
                    {item.endTime
                      ? " - " + item.endTime
                      : ""}
                  </small>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!schedule.length && (
        <div className="info-box">
          <strong>Ders programı henüz aktarılmamış.</strong>
          <span>
            MEB program ekranı açıldığında program aktarımı burada
            otomatik ders seçimi için kullanılacak.
          </span>
        </div>
      )}

      <div className="attendance-toolbar">
        <div className="attendance-counts">
          <span>
            Toplam <strong>{students.length}</strong>
          </span>
          <span className="count-present">
            Var <strong>{counts.present}</strong>
          </span>
          <span className="count-late">
            Geç <strong>{counts.late}</strong>
          </span>
          <span className="count-half">
            Yarım Gün <strong>{counts.half_day}</strong>
          </span>
          <span className="count-full">
            Tam Gün <strong>{counts.full_day}</strong>
          </span>
          <span className="count-unknown">
            Bilinmiyor <strong>{counts.unknown}</strong>
          </span>
        </div>

        <button
          className="secondary"
          onClick={markAllPresent}
          disabled={!students.length}
        >
          Herkesi Var Yap
        </button>
      </div>

      {ruleWarnings.length > 0 && (
        <div className="rule-warning">
          <strong>{ruleWarnings.length} kural uyarısı</strong>
          <div>
            {ruleWarnings.slice(0, 6).map((warning, index) => (
              <div key={warning.ruleId + "-" + warning.studentNo + "-" + index}>
                Öğrenci {warning.studentNo}: {warning.message}
              </div>
            ))}
            {ruleWarnings.length > 6 && (
              <div>+ {ruleWarnings.length - 6} uyarı daha</div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="error-box attendance-error">
          {error}
        </div>
      )}

      {message && (
        <div className="success-box">
          {message}
        </div>
      )}

      <div className="student-table-wrap">
        <table className="student-table">
          <thead>
            <tr>
              <th>No</th>
              <th>Öğrenci</th>
              <th>Durum</th>
            </tr>
          </thead>

          <tbody>
            {students.map((student) => {
              const status =
                statuses[student.studentNo] || "unknown";

              return (
                <tr key={student.id}>
                  <td>{student.studentNo}</td>
                  <td>
                    <strong>{student.name}</strong>
                  </td>
                  <td>
                    <div className="status-buttons">
                      {(
                        Object.keys(
                          lessonStatusLabels
                        ) as LessonAttendanceRecord["status"][]
                      ).map((item) => (
                        <button
                          key={item}
                          className={
                            status === item
                              ? "attendance-status active " + item
                              : "attendance-status " + item
                          }
                          onClick={() =>
                            setStatus(
                              student.studentNo,
                              item
                            )
                          }
                        >
                          {lessonStatusLabels[item]}
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
          {students.length
            ? selectionMode === "auto" && currentLesson
              ? "Mevcut ders otomatik seçildi."
              : "Değişiklikleri kaydetmeye hazır."
            : "Önce bir sınıf seçin."}
        </span>

        <button
          className="primary"
          onClick={save}
          disabled={saving || !students.length}
        >
          {saving ? "Kaydediliyor..." : "Yoklamayı Kaydet"}
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
  const [records, setRecords] =
    useState<LessonAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (!profile?.organizationId) return;

    setLoading(true);

    try {
      const items = await getLessonAttendances(
        profile.organizationId,
        todayLocal()
      );

      setRecords(
        items.filter(
          (item) =>
            item.reviewStatus !== "approved"
        )
      );
    } catch (err) {
      setError(
        (err as Error)?.message ||
          String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.organizationId]);

  const review = async (
    item: LessonAttendance,
    status: "approved" | "needs_review"
  ) => {
    if (!profile?.organizationId || !user?.uid) return;

    setBusy(item.id);
    setError("");

    try {
      await reviewLessonAttendance(
        profile.organizationId,
        item.id,
        user.uid,
        status
      );

      await load();
    } catch (err) {
      setError(
        (err as Error)?.message ||
          String(err)
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Gün Sonu İnceleme</h3>
          <p>
            Bugünkü öğretmen yoklamalarını kontrol
            edin ve onaylayın.
          </p>
        </div>

        <span className="status-badge">
          {records.length} bekleyen
        </span>
      </div>

      {error && (
        <div className="error-box attendance-error">
          {error}
        </div>
      )}

      <div className="review-list">
        {loading && (
          <div className="empty-state compact">
            <strong>Kayıtlar yükleniyor...</strong>
          </div>
        )}

        {!loading && !records.length && (
          <div className="empty-state compact">
            <div className="empty-icon">✓</div>
            <strong>Bekleyen yoklama yok.</strong>
            <p>
              Bugünkü kayıtlar incelenmiş durumda.
            </p>
          </div>
        )}

        {records.map((item) => {
          const unknownCount =
            item.records.filter(
              (record) =>
                record.status === "unknown"
            ).length;

          return (
            <article
              className="review-card"
              key={item.id}
            >
              <div>
                <strong>
                  {item.className}
                </strong>
                <span>
                  {item.subjectName || "Günlük Yoklama"}
                  {item.period
                    ? " · " + item.period + ". ders"
                    : ""}
                </span>
                <small>
                  {item.teacherName} ·{" "}
                  {item.records.length} öğrenci
                  {unknownCount
                    ? " · " +
                      unknownCount +
                      " bilinmiyor"
                    : ""}
                </small>
              </div>

              <div className="review-actions">
                <button
                  className="secondary"
                  disabled={busy === item.id}
                  onClick={() =>
                    review(item, "needs_review")
                  }
                >
                  İnceleme İste
                </button>

                <button
                  className="primary dark-button"
                  disabled={busy === item.id}
                  onClick={() =>
                    review(item, "approved")
                  }
                >
                  Onayla
                </button>
              </div>
            </article>
          );
        })}
      </div>
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
              " ders-öğretmen eşleşmesi ve " +
              result.schedules +
              " program kaydı aktarıldı."
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

    window.addEventListener("MEVCUT_EOKUL_RESULT", handler);

    return () =>
      window.removeEventListener(
        "MEVCUT_EOKUL_RESULT",
        handler
      );
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
        <span className="status-badge">
          {busy ? "İşlem sürüyor" : "Hazır"}
        </span>
      </div>

      <div className="integration-actions">
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
            IOK09004 ekranında seçili sınıfın ders-öğretmen eşleşmesini alır.
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
      ? "e-Okul Aktarım"
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
      : [
          "Ana Sayfa",
          "Yoklama",
          "Geçmiş",
          "Dersler",
          "e-Okul Aktarım",
          "Ayarlar",
        ];

  let content;

  if (active === "Yoklama") {
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
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Ayarlar</h3>
            <p>
              Hesap ve okul ayarları.
            </p>
          </div>
        </div>

        <div className="empty-state compact">
          <strong>
            {profile.displayName}
          </strong>
          <p>
            {profile.email} ·{" "}
            {profile.role === "admin"
              ? "Yönetici"
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
    );
  } else {
    content = (
      <DashboardView
        onNavigate={setActive}
      />
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
