export type DailySystemResult =
  | "present"
  | "half_day"
  | "full_day"
  | "late"
  | "unknown";

export type DailyApprovalStatus = "draft" | "approved";

export interface AdminOverride {
  result: DailySystemResult;
  reason: string;
  adminId: string;
  timestamp?: unknown;
}

export interface DailyAttendanceStudent {
  id: string;
  organizationId: string;
  date: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classCode: string;
  className: string;
  systemResult: DailySystemResult;
  finalResult: DailySystemResult;
  explanation: string;
  sourceAttendanceIds: string[];
  hasIntermediateAbsence: boolean;
  adminOverride?: AdminOverride;
  approvalStatus: DailyApprovalStatus;
  approvedBy?: string;
  approvedAt?: unknown;
}

export interface DailyReport {
  id: string;
  organizationId: string;
  date: string;
  status: DailyApprovalStatus;
  locked: boolean;
  approvedBy?: string;
  approvedAt?: unknown;
}
