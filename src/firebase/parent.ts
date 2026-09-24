import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "./config";
import { getDailyAttendance } from "./dailyAttendance";
import type { DailyAttendanceStudent } from "../types/dailyAttendance";
import type { SchoolStudent } from "./school";

export interface ParentNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  createdAt?: unknown;
  read: boolean;
}

export async function getParentChildren(
  organizationId: string,
  parentUid: string
): Promise<SchoolStudent[]> {
  const relationships = await getDocs(
    query(
      collection(db, "parentStudents"),
      where("organizationId", "==", organizationId),
      where("parentUid", "==", parentUid),
      where("active", "==", true)
    )
  );

  const studentIds = relationships.docs.map((item) => String(item.data().studentId || ""));
  if (!studentIds.length) return [];

  const students = await getDocs(
    query(collection(db, "students"), where("organizationId", "==", organizationId))
  );

  return students.docs
    .filter((item) => studentIds.includes(item.id))
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        studentNo: String(data.studentNo || ""),
        name: String(data.name || ""),
        tcNo: "",
        classCode: String(data.classCode || ""),
        className: String(data.className || ""),
      };
    });
}

export async function getParentDailyAttendance(
  organizationId: string,
  studentId: string,
  date: string
): Promise<DailyAttendanceStudent[]> {
  return getDailyAttendance(organizationId, date, undefined, studentId);
}

export async function getParentNotifications(
  organizationId: string,
  parentUid: string
): Promise<ParentNotification[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "notifications"),
      where("organizationId", "==", organizationId),
      where("recipientUid", "==", parentUid)
    )
  );

  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      title: String(data.title || ""),
      message: String(data.message || ""),
      type: String(data.type || "info"),
      createdAt: data.createdAt,
      read: data.read === true,
    };
  });
}
