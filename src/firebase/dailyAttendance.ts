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
import type { LessonAttendance, LessonAttendanceRecord } from "../types/academic";
import type {
  AdminOverride,
  DailyAttendanceStudent,
  DailyReport,
  DailySystemResult,
} from "../types/dailyAttendance";
import { calculateDailyResult, hasIntermediateAbsence } from "../rules/dailyAttendance";
import type { SchoolStudent } from "./school";

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

const dailyId = (organizationId: string, date: string, studentNo: string) =>
  safeId(organizationId + "__" + date + "__" + studentNo);

const reportId = (organizationId: string, date: string) =>
  safeId(organizationId + "__" + date);

export async function getDailyAttendance(
  organizationId: string,
  date: string,
  classCode?: string,
  studentId?: string
): Promise<DailyAttendanceStudent[]> {
  const constraints = [
    where("organizationId", "==", organizationId),
    where("date", "==", date),
    ...(classCode ? [where("classCode", "==", classCode)] : []),
    ...(studentId ? [where("studentId", "==", studentId)] : []),
  ];

  const snapshot = await getDocs(
    query(collection(db, "dailyAttendance"), ...constraints)
  );

  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      organizationId: String(data.organizationId || organizationId),
      date: String(data.date || date),
      studentId: String(data.studentId || ""),
      studentNo: String(data.studentNo || ""),
      studentName: String(data.studentName || ""),
      classCode: String(data.classCode || ""),
      className: String(data.className || ""),
      systemResult: (data.systemResult || "unknown") as DailySystemResult,
      finalResult: (data.finalResult || data.systemResult || "unknown") as DailySystemResult,
      explanation: String(data.explanation || ""),
      sourceAttendanceIds: Array.isArray(data.sourceAttendanceIds)
        ? data.sourceAttendanceIds.map(String)
        : [],
      hasIntermediateAbsence: data.hasIntermediateAbsence === true,
      adminOverride: data.adminOverride as AdminOverride | undefined,
      approvalStatus: (data.approvalStatus === "approved" ? "approved" : "draft") as "approved" | "draft",
      approvedBy: data.approvedBy ? String(data.approvedBy) : undefined,
      approvedAt: data.approvedAt,
    };
  }).sort((a, b) => a.studentName.localeCompare(b.studentName, "tr"));
}

export async function getDailyReport(
  organizationId: string,
  date: string
): Promise<DailyReport | null> {
  const snapshot = await getDocs(
    query(
      collection(db, "dailyReports"),
      where("organizationId", "==", organizationId),
      where("date", "==", date)
    )
  );

  const item = snapshot.docs[0];
  if (!item) return null;
  const data = item.data();

  return {
    id: item.id,
    organizationId: String(data.organizationId || organizationId),
    date: String(data.date || date),
    status: data.status === "approved" ? "approved" : "draft",
    locked: data.locked === true,
    approvedBy: data.approvedBy ? String(data.approvedBy) : undefined,
    approvedAt: data.approvedAt,
  };
}

export async function calculateAndSaveDailyAttendance(args: {
  organizationId: string;
  date: string;
  students: SchoolStudent[];
  lessonAttendances: LessonAttendance[];
}) {
  const byStudent = new Map<string, LessonAttendance[]>();

  for (const lesson of args.lessonAttendances) {
    for (const record of lesson.records) {
      const list = byStudent.get(record.studentNo) || [];
      list.push(lesson);
      byStudent.set(record.studentNo, list);
    }
  }

  const existing = await getDailyAttendance(args.organizationId, args.date);
  const existingMap = new Map(existing.map((item) => [item.studentNo, item]));

  const writes = args.students.map((student) => {
    const lessons = byStudent.get(student.studentNo) || [];
    const records: LessonAttendanceRecord[] = [];

    for (const lesson of lessons) {
      const record = lesson.records.find(
        (item) => item.studentNo === student.studentNo
      );
      if (record) records.push(record);
    }

    const result = calculateDailyResult(records);
    const ordered = lessons.map((lesson) => ({
      period: lesson.period,
      status:
        lesson.records.find((item) => item.studentNo === student.studentNo)?.status ||
        "unknown",
    }));

    const previous = existingMap.get(student.studentNo);
    return {
      id: previous?.id || dailyId(args.organizationId, args.date, student.studentNo),
      data: {
        organizationId: args.organizationId,
        date: args.date,
        studentId: student.id,
        studentNo: student.studentNo,
        studentName: student.name,
        classCode: student.classCode,
        className: student.className,
        systemResult: result.result,
        finalResult: previous?.adminOverride?.result || result.result,
        explanation: result.explanation,
        sourceAttendanceIds: lessons.map((item) => item.id),
        hasIntermediateAbsence: hasIntermediateAbsence(ordered),
        ...(previous?.adminOverride
          ? { adminOverride: previous.adminOverride }
          : {}),
        approvalStatus: previous?.approvalStatus || "draft",
        updatedAt: serverTimestamp(),
      },
    };
  });

  const report = await getDailyReport(args.organizationId, args.date);
  if (report?.locked) {
    throw new Error("Gün sonu raporu kilitli. Önce yetkili düzeltme işlemi gerekir.");
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    for (const item of writes.slice(i, i + 400)) {
      batch.set(doc(db, "dailyAttendance", item.id), item.data, { merge: true });
    }
    await batch.commit();
  }

  const reportRef = doc(db, "dailyReports", reportId(args.organizationId, args.date));
  await writeBatch(db).set(reportRef, {
    organizationId: args.organizationId,
    date: args.date,
    status: "draft",
    locked: false,
    updatedAt: serverTimestamp(),
  }, { merge: true }).commit();

  return writes.length;
}

export async function overrideDailyAttendance(args: {
  organizationId: string;
  dailyAttendanceId: string;
  adminId: string;
  result: DailySystemResult;
  reason: string;
}) {
  const items = await getDocs(
    query(
      collection(db, "dailyAttendance"),
      where("organizationId", "==", args.organizationId)
    )
  );
  const item = items.docs.find((entry) => entry.id === args.dailyAttendanceId);
  if (!item) throw new Error("Günlük öğrenci kaydı bulunamadı.");

  const data = item.data();
  if (data.approvalStatus === "approved") {
    throw new Error("Günlük kayıt onaylandı ve kilitlendi.");
  }

  const previous = String(data.finalResult || data.systemResult || "unknown");
  const batch = writeBatch(db);

  batch.set(item.ref, {
    adminOverride: {
      result: args.result,
      reason: args.reason,
      adminId: args.adminId,
      timestamp: serverTimestamp(),
    },
    finalResult: args.result,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(doc(db, "attendanceLogs", safeId(
    args.dailyAttendanceId + "__admin__" + Date.now()
  )), {
    organizationId: args.organizationId,
    attendanceId: args.dailyAttendanceId,
    date: String(data.date || ""),
    classCode: String(data.classCode || ""),
    className: String(data.className || ""),
    subjectName: "Gün Sonu Yönetici Düzeltmesi",
    teacherName: "",
    studentNo: String(data.studentNo || ""),
    previousStatus: previous,
    newStatus: args.result,
    changedBy: args.adminId,
    changedAt: serverTimestamp(),
    action: "admin_override",
    reason: args.reason,
  });

  await batch.commit();
}

export async function approveDailyReport(
  organizationId: string,
  date: string,
  adminId: string
) {
  const report = await getDailyReport(organizationId, date);
  if (report?.locked) throw new Error("Gün zaten kilitli.");

  const items = await getDailyAttendance(organizationId, date);
  if (!items.length) throw new Error("Onaylanacak günlük öğrenci kaydı bulunamadı.");

  const unresolved = items.filter((item) => item.finalResult === "unknown");
  if (unresolved.length) {
    throw new Error(
      unresolved.length +
        " öğrencinin günlük sonucu Bilinmiyor. Yönetici kararı verilmeden gün onaylanamaz."
    );
  }

  for (let i = 0; i < items.length; i += 200) {
    const batch = writeBatch(db);
    for (const item of items.slice(i, i + 200)) {
      batch.set(
        doc(db, "dailyAttendance", item.id),
        {
          approvalStatus: "approved",
          approvedBy: adminId,
          approvedAt: serverTimestamp(),
        },
        { merge: true }
      );
      batch.set(
        doc(db, "eokulQueue", item.id),
        {
          id: item.id,
          organizationId,
          attendanceId: item.id,
          dailyAttendanceId: item.id,
          date,
          classCode: item.classCode,
          status: "pending",
          attempts: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  await writeBatch(db).set(
    doc(db, "dailyReports", reportId(organizationId, date)),
    {
      organizationId,
      date,
      status: "approved",
      locked: true,
      approvedBy: adminId,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).commit();
}
