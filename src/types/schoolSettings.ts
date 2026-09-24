export interface LessonTime {
  period: number;
  startTime: string;
  endTime: string;
}

export interface SchoolSettings {
  organizationId: string;
  lessonCount: number;
  dayStartTime: string;
  lessonDurationMinutes: number;
  breakDurationMinutes: number;
  lunchEnabled: boolean;
  lunchDurationMinutes: number;
  lunchAfterPeriod: number;
  lessonTimes: LessonTime[];
  source: "manual" | "e-okul";
  updatedBy?: string;
  updatedAt?: unknown;
}
