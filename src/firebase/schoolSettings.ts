import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./config";
import type { SchoolSettings } from "../types/schoolSettings";

const settingsId = (organizationId: string) =>
  organizationId.replace(/[^a-zA-Z0-9_-]/g, "_");

export async function getSchoolSettings(
  organizationId: string
): Promise<SchoolSettings | null> {
  const snapshot = await getDoc(
    doc(db, "schoolSettings", settingsId(organizationId))
  );

  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const lessonTimes = Array.isArray(data.lessonTimes)
    ? data.lessonTimes.map((item: Record<string, unknown>, index: number) => ({
        period: Number(item.period || index + 1),
        startTime: String(item.startTime || ""),
        endTime: String(item.endTime || ""),
      }))
    : [];

  return {
    organizationId: String(data.organizationId || organizationId),
    lessonCount: Number(data.lessonCount || lessonTimes.length || 0),
    lessonTimes,
    source: data.source === "e-okul" ? "e-okul" : "manual",
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedAt: data.updatedAt,
  };
}

export async function saveSchoolSettings(args: {
  organizationId: string;
  lessonCount: number;
  lessonTimes: SchoolSettings["lessonTimes"];
  updatedBy: string;
  source?: SchoolSettings["source"];
}) {
  const lessonCount = Math.max(1, Math.min(20, Math.trunc(args.lessonCount)));
  const lessonTimes = args.lessonTimes
    .slice(0, lessonCount)
    .map((item, index) => ({
      period: index + 1,
      startTime: item.startTime || "",
      endTime: item.endTime || "",
    }));

  await setDoc(
    doc(db, "schoolSettings", settingsId(args.organizationId)),
    {
      organizationId: args.organizationId,
      lessonCount,
      lessonTimes,
      source: args.source || "manual",
      updatedBy: args.updatedBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
