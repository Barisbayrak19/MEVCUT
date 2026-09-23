import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";
import type { EOkulImportPayload } from "../types/school";

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

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
    const batch = writeBatch(db);
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
