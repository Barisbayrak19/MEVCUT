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
import type { EOkulQueueItem, LessonAttendance } from "../types/academic";

function mapAttendance(id: string, data: Record<string, unknown>, organizationId: string): LessonAttendance {
  return {
    id,
    organizationId: String(data.organizationId || organizationId),
    date: String(data.date || ""),
    classCode: String(data.classCode || ""),
    className: String(data.className || ""),
    subjectCode: String(data.subjectCode || ""),
    subjectName: String(data.subjectName || ""),
    teacherUid: String(data.teacherUid || ""),
    teacherName: String(data.teacherName || ""),
    period: Number(data.period || 0),
    lessonKey: String(data.lessonKey || id),
    records: Array.isArray(data.records) ? data.records as LessonAttendance["records"] : [],
    reviewStatus: (data.reviewStatus || "submitted") as LessonAttendance["reviewStatus"],
    updatedBy: String(data.updatedBy || ""),
    updatedAt: data.updatedAt,
    ruleViolations: Array.isArray(data.ruleViolations)
      ? data.ruleViolations as LessonAttendance["ruleViolations"]
      : [],
  };
}

export async function getEOkulQueue(
  organizationId: string,
  status?: EOkulQueueItem["status"]
): Promise<EOkulQueueItem[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "eokulQueue"),
      where("organizationId", "==", organizationId)
    )
  );

  return snapshot.docs
    .map((item) => {
      const data = item.data();

      return {
        id: item.id,
        organizationId: String(data.organizationId || organizationId),
        attendanceId: String(data.attendanceId || ""),
        status: (data.status || "pending") as EOkulQueueItem["status"],
        attempts: Number(data.attempts || 0),
        lastError: data.lastError ? String(data.lastError) : undefined,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    })
    .filter((item) => !status || item.status === status)
    .sort((a, b) => a.id.localeCompare(b.id, "tr"));
}

export async function getLessonAttendanceById(
  organizationId: string,
  attendanceId: string
): Promise<LessonAttendance | null> {
  const snapshot = await getDocs(
    query(
      collection(db, "attendance"),
      where("organizationId", "==", organizationId)
    )
  );

  const record = snapshot.docs.find((item) => item.id === attendanceId);
  if (!record) return null;

  return mapAttendance(record.id, record.data(), organizationId);
}

export async function updateEOkulQueue(
  organizationId: string,
  queueId: string,
  status: EOkulQueueItem["status"],
  extra: Record<string, unknown> = {}
) {
  const ref = doc(db, "eokulQueue", queueId);

  await writeBatch(db)
    .set(
      ref,
      {
        organizationId,
        status,
        updatedAt: serverTimestamp(),
        ...extra,
      },
      { merge: true }
    )
    .commit();
}
