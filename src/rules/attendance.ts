import type { LessonAttendanceRecord } from "../types/academic";

export type AttendanceRuleSeverity = "info" | "warning" | "critical";

export interface AttendanceRuleViolation {
  ruleId: string;
  severity: AttendanceRuleSeverity;
  studentNo: string;
  message: string;
}

export function evaluateAttendanceRules(args: {
  currentRecords: LessonAttendanceRecord[];
  previousRecords?: LessonAttendanceRecord[];
}): AttendanceRuleViolation[] {
  const previous = new Map(
    (args.previousRecords || []).map((item) => [
      item.studentNo,
      item.status,
    ])
  );

  const violations: AttendanceRuleViolation[] = [];

  for (const record of args.currentRecords) {
    const previousStatus = previous.get(record.studentNo);

    if (
      previousStatus === "present" &&
      record.status === "full_day"
    ) {
      violations.push({
        ruleId: "VAR_TO_YOK",
        severity: "critical",
        studentNo: record.studentNo,
        message:
          "Öğrenci bir önceki derste Var, bu derste Tam Gün olarak işaretlendi. Kontrol edilmesi önerilir.",
      });
    }

    if (
      previousStatus === "present" &&
      record.status === "half_day"
    ) {
      violations.push({
        ruleId: "VAR_TO_YARIM",
        severity: "warning",
        studentNo: record.studentNo,
        message:
          "Öğrenci bir önceki derste Var, bu derste Yarım Gün olarak işaretlendi.",
      });
    }

    if (record.status === "unknown") {
      violations.push({
        ruleId: "UNKNOWN_STATUS",
        severity: "warning",
        studentNo: record.studentNo,
        message:
          "Öğrencinin yoklama durumu Bilinmiyor olarak işaretlendi; yönetici incelemesi gerekir.",
      });
    }
  }

  return violations;
}
