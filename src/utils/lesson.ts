import type { ScheduleEntry } from "../types/academic";

function parseClock(value?: string) {
  if (!value) return null;

  const match = value.trim().match(/^(\\d{1,2}):(\\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function getCurrentLesson(
  schedule: ScheduleEntry[],
  now = new Date()
): ScheduleEntry | null {
  const current = minutesOfDay(now);

  return (
    schedule.find((item) => {
      const start = parseClock(item.startTime);
      const end = parseClock(item.endTime);

      return (
        start !== null &&
        end !== null &&
        current >= start &&
        current < end
      );
    }) || null
  );
}
