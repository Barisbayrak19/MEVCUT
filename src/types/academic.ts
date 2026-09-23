export interface TeacherAssignment {
  id: string;
  organizationId: string;
  classCode: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  teacherName: string;
  teacherUid?: string;
  teacherTcNo?: string;
  source: "e-okul" | "manual";
  importedAt?: string;
}

export interface ScheduleEntry {
  id: string;
  organizationId: string;
  dayOfWeek: number;
  period: number;
  classCode: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  teacherName: string;
  startTime?: string;
  endTime?: string;
  source: "e-okul" | "manual";
}

export type AttendanceReviewStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "needs_review";

export interface AttendanceRuleViolation {
  ruleId: string;
  severity: "info" | "warning" | "critical";
  studentNo: string;
  message: string;
}

export interface LessonAttendanceRecord {
  studentNo: string;
  status: "present" | "full_day" | "half_day" | "late" | "unknown";
}

export interface LessonAttendance {
  id: string;
  organizationId: string;
  date: string;
  classCode: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  teacherUid: string;
  teacherName: string;
  period: number;
  lessonKey: string;
  records: LessonAttendanceRecord[];
  reviewStatus: AttendanceReviewStatus;
  updatedBy: string;
  updatedAt?: unknown;
  ruleViolations?: AttendanceRuleViolation[];
}

export interface AttendanceAuditLog {
  id: string;
  organizationId: string;
  attendanceId: string;
  date: string;
  classCode: string;
  className: string;
  subjectName: string;
  teacherName: string;
  studentNo: string;
  previousStatus: string;
  newStatus: string;
  changedBy: string;
  changedAt?: unknown;
  action: "status_change" | "approved" | "needs_review";
}

export interface EOkulQueueItem {
  id: string;
  organizationId: string;
  attendanceId: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  lastError?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
