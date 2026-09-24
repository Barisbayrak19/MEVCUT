import type { LessonAttendanceRecord } from "../types/academic";
import type { DailySystemResult } from "../types/dailyAttendance";

export interface DailyRuleResult {
  result: DailySystemResult;
  explanation: string;
}

export function calculateDailyResult(
  records: LessonAttendanceRecord[]
): DailyRuleResult {
  const known = records.filter((item) => item.status !== "unknown");

  if (!records.length || !known.length) {
    return {
      result: "unknown",
      explanation: "Henüz değerlendirilebilir bir yoklama kaydı yok.",
    };
  }

  const hasPresent = known.some((item) => item.status === "present");
  const hasLate = known.some((item) => item.status === "late");
  const hasAbsent = known.some(
    (item) => item.status === "absent" || item.status === "full_day" || item.status === "half_day"
  );
  const hasUnknown = records.some((item) => item.status === "unknown");

  // Şartnamede Geç + Mevcut gibi çakışmaların önceliği henüz kesinleşmedi.
  // Bu durumda sistem sonucu bilinmiyor bırakılır ve yönetici kararı beklenir.
  if (hasPresent && hasLate) {
    return {
      result: "unknown",
      explanation:
        "Aynı gün içinde Mevcut ve Geç kayıtları birlikte bulundu. Öncelik kuralı kesinleşmediği için yönetici kararı gerekir.",
    };
  }

  if (hasPresent) {
    return {
      result: "half_day",
      explanation:
        "Öğrenci gün içindeki en az bir yoklamada Mevcut olarak kaydedildi.",
    };
  }

  if (hasLate && !hasPresent) {
    return {
      result: "late",
      explanation:
        "Öğrencinin gün içindeki kayıtlarında Geç durumu bulundu ve Mevcut kaydı bulunmadı.",
    };
  }

  if (!hasUnknown && known.length > 0 && known.every(
    (item) => item.status === "absent" || item.status === "full_day" || item.status === "half_day"
  )) {
    return {
      result: "full_day",
      explanation:
        "Öğrencinin gün içindeki tüm değerlendirilebilir kayıtları devamsızlık olarak işaretlendi.",
    };
  }

  if (hasAbsent && hasUnknown) {
    return {
      result: "unknown",
      explanation:
        "Devamsızlık kaydı bulunuyor ancak gün içinde bilinmeyen yoklama da var; yönetici incelemesi gerekir.",
    };
  }

  return {
    result: "unknown",
    explanation:
      "Kayıtların nihai günlük sonuca dönüştürülmesi için yönetici incelemesi gerekir.",
  };
}

export function hasIntermediateAbsence(
  recordsByPeriod: Array<{ period: number; status: LessonAttendanceRecord["status"] }>
) {
  const ordered = [...recordsByPeriod]
    .filter((item) => item.period > 0)
    .sort((a, b) => a.period - b.period);

  for (let i = 1; i < ordered.length; i += 1) {
    if (
      ordered[i - 1].status === "present" &&
      (ordered[i].status === "absent" || ordered[i].status === "full_day")
    ) {
      return true;
    }
    if (
      ordered[i - 1].status === "present" &&
      (ordered[i].status === "absent" || ordered[i].status === "half_day")
    ) {
      return true;
    }
    if (
      ordered[i - 1].status === "present" &&
      ordered[i].status === "unknown"
    ) {
      continue;
    }
    if (
      ordered[i - 1].status === "present" &&
      ordered[i].status === "late"
    ) {
      continue;
    }
  }

  return false;
}
