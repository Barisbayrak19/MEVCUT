import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  query,
} from "firebase/firestore";
import { db } from "./config";
import type { EOkulImportPayload } from "../types/school";

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

export type AttendanceStatus = "present" | "full_day" | "half_day" | "late";

export interface SchoolClass {
  code: string;
  name: string;
}

export interface SchoolStudent {
  id: string;
  studentNo: string;
  name: string;
  tcNo: string;
  classCode: string;
  className: string;
}

export interface AttendanceRecord {
  studentNo: string;
  status: AttendanceStatus;
}

export interface AttendanceDocument {
  organizationId: string;
  classCode: string;
  className: string;
  date: string;
  records: AttendanceRecord[];
  updatedBy: string;
}

export async function importEOkulData(payload: EOkulImportPayload) {
  const now = serverTimestamp();

  for (const items of chunk(payload.classes, 450)) {
    const batch = writeBatch(db);
    for (const item of items) {
      const id = item.code;
      batch.set(doc(collection(db, "classes"), id), {
        organizationId: payload.organizationId,
        code: item.code,
        name: item.name,
        source: "e-okul",
        periodCode: payload.periodCode,
        institutionCode: payload.institutionCode,
        importedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    await batch.commit();
  }

  for (const items of chunk(payload.students, 450)) {
    const batch = (await import("firebase/firestore")).writeBatch(db);
    for (const item of items) {
      const id = `${payload.organizationId}_${item.studentNo}`;
      batch.set(doc(collection(db, "students"), id), {
        organizationId: payload.organizationId,
        studentNo: item.studentNo,
        name: item.name,
        tcNo: item.tcNo,
        classCode: item.classCode,
        className: item.className,
        source: "e-okul",
        periodCode: payload.periodCode,
        institutionCode: payload.institutionCode,
        importedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    await batch.commit();
  }

  return {
    classCount: payload.classes.length,
    studentCount: payload.students.length,
  };
}

export async function getSchoolClasses(organizationId: string): Promise<SchoolClass[]> {
  const snapshot = await getDocs(
    query(collection(db, "classes"), where("organizationId", "==", organizationId))
  );

  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return { code: String(data.code || item.id), name: String(data.name || "") };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function getClassStudents(
  organizationId: string,
  classCode: string
): Promise<SchoolStudent[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "students"),
      where("organizationId", "==", organizationId),
      where("classCode", "==", classCode)
    )
  );

  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        studentNo: String(data.studentNo || ""),
        name: String(data.name || ""),
        tcNo: String(data.tcNo || ""),
        classCode: String(data.classCode || ""),
        className: String(data.className || ""),
      };
    })
    .sort((a, b) => {
      const an = Number(a.studentNo);
      const bn = Number(b.studentNo);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.name.localeCompare(b.name, "tr");
    });
}

const attendanceDocId = (organizationId: string, classCode: string, date: string) =>
  `${organizationId}__${classCode}__${date}`.replace(/[^a-zA-Z0-9_-]/g, "_");

export async function getAttendance(
  organizationId: string,
  classCode: string,
  date: string
): Promise<AttendanceRecord[]> {
  const snapshot = await getDoc(
    doc(db, "attendance", attendanceDocId(organizationId, classCode, date))
  );
  if (!snapshot.exists()) return [];
  return (snapshot.data().records || []) as AttendanceRecord[];
}

export async function saveAttendance(
  organizationId: string,
  classCode: string,
  className: string,
  date: string,
  records: AttendanceRecord[],
  updatedBy: string
) {
  await setDoc(
    doc(db, "attendance", attendanceDocId(organizationId, classCode, date)),
    {
      organizationId,
      classCode,
      className,
      date,
      records,
      updatedBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
