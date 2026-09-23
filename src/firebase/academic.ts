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
import type { ScheduleEntry, TeacherAssignment } from "../types/academic";

const normalize = (value: string) =>
  value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");

const safeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_");

export async function getTeacherAssignments(
  organizationId: string,
  teacherName?: string
): Promise<TeacherAssignment[]> {
  const constraints = [
    where("organizationId", "==", organizationId),
    ...(teacherName
      ? [where("teacherName", "==", teacherName)]
      : []),
  ];

  const snapshot = await getDocs(
    query(collection(db, "teacherAssignments"), ...constraints)
  );

  const wanted = teacherName ? normalize(teacherName) : "";

  return snapshot.docs
    .map((item) => {
      const data = item.data();

      return {
        id: item.id,
        organizationId: String(data.organizationId || organizationId),
        classCode: String(data.classCode || ""),
        className: String(data.className || ""),
        subjectCode: String(data.subjectCode || ""),
        subjectName: String(data.subjectName || ""),
        teacherName: String(data.teacherName || ""),
        teacherUid: data.teacherUid ? String(data.teacherUid) : undefined,
        teacherTcNo: data.teacherTcNo ? String(data.teacherTcNo) : undefined,
        source: data.source === "manual" ? "manual" : "e-okul",
      } satisfies TeacherAssignment;
    })
    .filter(
      (item) =>
        item.subjectName &&
        item.subjectName !== "T.C. Kimlik No" &&
        item.teacherName &&
        (!wanted || normalize(item.teacherName) === wanted)
    )
    .sort((a, b) =>
      (a.className + a.subjectName).localeCompare(
        b.className + b.subjectName,
        "tr"
      )
    );
}

export async function getSchedule(
  organizationId: string,
  dayOfWeek?: number,
  teacherName?: string
): Promise<ScheduleEntry[]> {
  const constraints = [
    where("organizationId", "==", organizationId),
    ...(teacherName
      ? [where("teacherName", "==", teacherName)]
      : []),
  ];

  const snapshot = await getDocs(
    query(collection(db, "schedules"), ...constraints)
  );

  const wanted = teacherName ? normalize(teacherName) : "";

  return snapshot.docs
    .map((item) => {
      const data = item.data();

      return {
        id: item.id,
        organizationId: String(data.organizationId || organizationId),
        dayOfWeek: Number(data.dayOfWeek || 0),
        period: Number(data.period || 0),
        classCode: String(data.classCode || ""),
        className: String(data.className || ""),
        subjectCode: String(data.subjectCode || ""),
        subjectName: String(data.subjectName || ""),
        teacherName: String(data.teacherName || ""),
        startTime: data.startTime ? String(data.startTime) : undefined,
        endTime: data.endTime ? String(data.endTime) : undefined,
        source: data.source === "manual" ? "manual" : "e-okul",
      } satisfies ScheduleEntry;
    })
    .filter((item) => !dayOfWeek || item.dayOfWeek === dayOfWeek)
    .filter((item) => !wanted || normalize(item.teacherName) === wanted)
    .sort((a, b) => a.period - b.period);
}

export async function importAcademicData(payload: {
  organizationId: string;
  assignments: Omit<TeacherAssignment, "id" | "organizationId">[];
  schedules?: Omit<ScheduleEntry, "id" | "organizationId">[];
}) {
  const cleanAssignments = cleanPayload.assignments.filter(
    (item) =>
      item.classCode &&
      item.className &&
      item.teacherName &&
      item.subjectName &&
      item.subjectName !== "T.C. Kimlik No"
  );

  const cleanPayload = {
    ...payload,
    assignments: cleanAssignments,
  };

  const usersSnapshot = await getDocs(collection(db, "users"));
  const teachers = usersSnapshot.docs
    .map((item) => ({
      uid: item.id,
      displayName: String(item.data().displayName || ""),
      role: String(item.data().role || ""),
      active: item.data().active === true,
      organizationId: String(item.data().organizationId || ""),
    }))
    .filter(
      (item) =>
        item.organizationId === cleanPayload.organizationId &&
        item.role === "teacher" &&
        item.active
    );

  const normalizeName = (value: string) =>
    value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");

  const resolveTeacherUid = (teacherName: string) =>
    teachers.find(
      (teacher) =>
        normalizeName(teacher.displayName) ===
        normalizeName(teacherName)
    )?.uid;

  const accessMap = new Map<
    string,
    { teacherUid: string; classCode: string; subjectCodes: Set<string> }
  >();

  const existingSnapshot = await getDocs(
    query(
      collection(db, "teacherAssignments"),
      where("organizationId", "==", cleanPayload.organizationId)
    )
  );

  const touchedClasses = new Set(
    cleanPayload.assignments.map((item) => item.classCode)
  );

  const batch = writeBatch(db);

  for (const existing of existingSnapshot.docs) {
    const data = existing.data();

    if (
      touchedClasses.has(String(data.classCode || "")) &&
      data.source !== "manual"
    ) {
      batch.delete(existing.ref);
    }
  }

  for (const item of cleanPayload.assignments) {
    const teacherUid =
      item.teacherUid || resolveTeacherUid(item.teacherName);

    const id = safeId(
      cleanPayload.organizationId +
      "_" +
      item.classCode +
      "_" +
      item.subjectCode +
      "_" +
      item.teacherName
    );

    batch.set(
      doc(db, "teacherAssignments", id),
      {
        organizationId: cleanPayload.organizationId,
        ...item,
        ...(teacherUid ? { teacherUid } : {}),
        importedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (teacherUid) {
      const key = teacherUid + "__" + item.classCode;
      const entry =
        accessMap.get(key) || {
          teacherUid,
          classCode: item.classCode,
          subjectCodes: new Set<string>(),
        };
      entry.subjectCodes.add(item.subjectCode);
      accessMap.set(key, entry);
    }
  }

  for (const access of accessMap.values()) {
    batch.set(
      doc(
        db,
        "teacherAssignmentAccess",
        access.teacherUid + "__" + access.classCode
      ),
      {
        organizationId: cleanPayload.organizationId,
        teacherUid: access.teacherUid,
        classCode: access.classCode,
        subjectCodes: [...access.subjectCodes],
        active: true,
        importedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  for (const item of cleanPayload.schedules || []) {
    const id = safeId(
      cleanPayload.organizationId +
      "_" +
      item.dayOfWeek +
      "_" +
      item.period +
      "_" +
      item.classCode +
      "_" +
      item.teacherName
    );

    batch.set(
      doc(db, "schedules", id),
      {
        organizationId: cleanPayload.organizationId,
        ...item,
        importedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();

  return {
    assignments: cleanPayload.assignments.length,
    schedules: cleanPayload.schedules?.length || 0,
    linkedTeachers: [...accessMap.values()].length,
  };
}
