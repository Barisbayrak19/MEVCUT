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
    dayStartTime: String(data.dayStartTime || lessonTimes[0]?.startTime || "08:30"),
    lessonDurationMinutes: Number(data.lessonDurationMinutes || 40),
    breakDurationMinutes: Number(data.breakDurationMinutes ?? 10),
    lunchEnabled: data.lunchEnabled !== false,
    lunchDurationMinutes: Number(data.lunchDurationMinutes ?? 45),
    lunchAfterPeriod: Number(data.lunchAfterPeriod || 4),
    lessonTimes,
    source: data.source === "e-okul" ? "e-okul" : "manual",
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedAt: data.updatedAt,
  };
}

export async function saveSchoolSettings(args: {
  organizationId: string;
  lessonCount: number;
  dayStartTime: string;
  lessonDurationMinutes: number;
  breakDurationMinutes: number;
  lunchEnabled: boolean;
  lunchDurationMinutes: number;
  lunchAfterPeriod: number;
  lessonTimes?: SchoolSettings["lessonTimes"];
  updatedBy: string;
  source?: SchoolSettings["source"];
}) {
  const lessonCount = Math.max(1, Math.min(20, Math.trunc(args.lessonCount)));
  const lessonDurationMinutes = Math.max(1, Math.min(180, Math.trunc(args.lessonDurationMinutes)));
  const breakDurationMinutes = Math.max(0, Math.min(120, Math.trunc(args.breakDurationMinutes)));
  const lunchDurationMinutes = Math.max(0, Math.min(180, Math.trunc(args.lunchDurationMinutes)));
  const lunchAfterPeriod = Math.max(0, Math.min(Math.max(lessonCount - 1, 0), Math.trunc(args.lunchAfterPeriod)));

  await setDoc(
    doc(db, "schoolSettings", settingsId(args.organizationId)),
    {
      organizationId: args.organizationId,
      lessonCount,
      dayStartTime: args.dayStartTime || "08:30",
      lessonDurationMinutes,
      breakDurationMinutes,
      lunchEnabled,
      lunchDurationMinutes,
      lunchAfterPeriod,
      lessonTimes: args.lessonTimes || [],
      source: args.source || "manual",
      updatedBy: args.updatedBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
