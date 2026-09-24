import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";
import type {
  AttendanceAuditLog,
  AttendanceReviewStatus,
  LessonAttendance,
  LessonAttendanceRecord,
  AttendanceRuleViolation,
} from "../types/academic";

export type LessonStatus = LessonAttendanceRecord["status"];

const safeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_");

export function lessonAttendanceId(
  organizationId: string,
  date: string,
  classCode: string,
  period: number,
  subjectCode: string,
  teacherUid: string
) {
  return safeId(
    organizationId +
    "__" +
    date +
    "__" +
    classCode +
    "__" +
    period +
    "__" +
    (subjectCode || "ders") +
    "__" +
    teacherUid
  );
}

export async function getLessonAttendances(
  organizationId: string,
  date?: string,
  teacherUid?: string
): Promise<LessonAttendance[]> {
  const constraints = [
    where("organizationId", "==", organizationId),
    ...(teacherUid ? [where("teacherUid", "==", teacherUid)] : []),
  ];

  const snapshot = await getDocs(
    query(collection(db, "attendance"), ...constraints)
  );

  return snapshot.docs
    .map((item) => {
      const data = item.data();

      return {
        id: item.id,
        organizationId: String(data.organizationId || organizationId),
        date: String(data.date || ""),
        classCode: String(data.classCode || ""),
        className: String(data.className || ""),
        subjectCode: String(data.subjectCode || ""),
        subjectName: String(data.subjectName || ""),
        teacherUid: String(data.teacherUid || ""),
        teacherName: String(data.teacherName || ""),
        period: Number(data.period || 0),
        lessonKey: String(data.lessonKey || item.id),
        records: Array.isArray(data.records) ? data.records : [],
        reviewStatus: (data.reviewStatus || "submitted") as AttendanceReviewStatus,
        updatedBy: String(data.updatedBy || ""),
        updatedAt: data.updatedAt,
        ruleViolations: Array.isArray(data.ruleViolations)
          ? data.ruleViolations as AttendanceRuleViolation[]
          : [],
      } satisfies LessonAttendance;
    })
    .filter((item) => !date || item.date === date)
    .sort((a, b) => {
      const aTime = Number((a.updatedAt as { seconds?: number } | undefined)?.seconds || 0);
      const bTime = Number((b.updatedAt as { seconds?: number } | undefined)?.seconds || 0);
      if (a.period === 0 && b.period === 0 && aTime !== bTime) {
        return aTime - bTime;
      }
      return (a.date + "_" + a.period + "_" + a.className).localeCompare(
        b.date + "_" + b.period + "_" + b.className,
        "tr"
      );
    });
}

export async function saveLessonAttendance(args: {
  organizationId: string;
  date: string;
  classCode: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  teacherUid: string;
  teacherName: string;
  period: number;
  records: LessonAttendanceRecord[];
  ruleViolations?: AttendanceRuleViolation[];
}) {
  // V1 manuel yoklamasında her "Gönder" işlemi ayrı bir ham yoklama olayıdır.
  // Bu sayede aynı sınıf için gün içinde birden fazla yoklama saklanabilir.
  const id =
    args.period === 0
      ? doc(collection(db, "attendance")).id
      : lessonAttendanceId(
          args.organizationId,
          args.date,
          args.classCode,
          args.period,
          args.subjectCode,
          args.teacherUid
        );

  const existing =
    args.period === 0
      ? undefined
      : (await getLessonAttendances(args.organizationId, args.date))
          .find((item) => item.id === id);

  if (existing?.reviewStatus === "approved") {
    throw new Error(
      "Bu yoklama yönetici tarafından onaylanmış. Değişiklik yapılamaz."
    );
  }

  const batch = writeBatch(db);

  batch.set(
    doc(db, "attendance", id),
    {
      organizationId: args.organizationId,
      date: args.date,
      classCode: args.classCode,
      className: args.className,
      subjectCode: args.subjectCode,
      subjectName: args.subjectName,
      teacherUid: args.teacherUid,
      teacherName: args.teacherName,
      period: args.period,
      lessonKey: id,
      records: args.records,
      reviewStatus: "submitted",
      ruleViolations: args.ruleViolations || [],
      updatedBy: args.teacherUid,
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );

  const oldMap = new Map(
    (existing?.records || []).map((item) => [
      item.studentNo,
      item.status,
    ])
  );

  for (const record of args.records) {
    const previous = oldMap.get(record.studentNo);

    if (previous && previous !== record.status) {
      const logId = safeId(
        id +
        "__" +
        record.studentNo +
        "__" +
        Date.now() +
        "__" +
        Math.random().toString(36).slice(2, 7)
      );

      batch.set(
        doc(db, "attendanceLogs", logId),
        {
          organizationId: args.organizationId,
          attendanceId: id,
          date: args.date,
          classCode: args.classCode,
          className: args.className,
          subjectName: args.subjectName,
          teacherName: args.teacherName,
          studentNo: record.studentNo,
          previousStatus: previous,
          newStatus: record.status,
          changedBy: args.teacherUid,
          changedAt: serverTimestamp(),
          action: "status_change",
        } satisfies Omit<AttendanceAuditLog, "id">
      );
    }
  }

  await batch.commit();
  return id;
}

export async function reviewLessonAttendance(
  organizationId: string,
  attendanceId: string,
  reviewerUid: string,
  status: "approved" | "needs_review"
) {
  const records = await getLessonAttendances(organizationId);
  const item = records.find((entry) => entry.id === attendanceId);

  if (!item) {
    throw new Error("Yoklama kaydı bulunamadı.");
  }

  const batch = writeBatch(db);

  batch.set(
    doc(db, "attendance", attendanceId),
    {
      reviewStatus: status,
      reviewedBy: reviewerUid,
      reviewedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    doc(
      db,
      "attendanceReviews",
      safeId(attendanceId + "__" + Date.now())
    ),
    {
      organizationId,
      attendanceId,
      status,
      reviewerUid,
      reviewedAt: serverTimestamp(),
    }
  );

  if (status === "needs_review") {
    batch.set(
      doc(
        db,
        "attendanceLogs",
        safeId(attendanceId + "__needs_review__" + Date.now())
      ),
      {
        organizationId,
        attendanceId,
        date: item.date,
        classCode: item.classCode,
        className: item.className,
        subjectName: item.subjectName,
        teacherName: item.teacherName,
        studentNo: "",
        previousStatus: item.reviewStatus,
        newStatus: "needs_review",
        changedBy: reviewerUid,
        changedAt: serverTimestamp(),
        action: "needs_review",
      } satisfies Omit<AttendanceAuditLog, "id">
    );
  }

  if (status === "approved") {
    batch.set(
      doc(
        db,
        "eokulQueue",
        safeId(attendanceId)
      ),
      {
        organizationId,
        attendanceId,
        status: "pending",
        attempts: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(
      doc(
        db,
        "attendanceLogs",
        safeId(attendanceId + "__approved__" + Date.now())
      ),
      {
        organizationId,
        attendanceId,
        date: item.date,
        classCode: item.classCode,
        className: item.className,
        subjectName: item.subjectName,
        teacherName: item.teacherName,
        studentNo: "",
        previousStatus: item.reviewStatus,
        newStatus: "approved",
        changedBy: reviewerUid,
        changedAt: serverTimestamp(),
        action: "approved",
      } satisfies Omit<AttendanceAuditLog, "id">
    );
  }

  await batch.commit();
}
