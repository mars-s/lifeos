export function validateDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      !Number.isFinite(Date.parse(day.date + "T00:00:00Z")) ||
      new Date(day.date + "T00:00:00Z").toISOString().slice(0, 10) !== day.date) {
    throw new Error("Invalid civil date");
  }
  new Intl.DateTimeFormat("en", { timeZone: day.timeZone }).format();
  for (const value of Object.values(day)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Non-finite metric");
    }
  }
  for (const name of ["steps", "activeMinutes", "sleepMinutes", "hrv", "restingHeartRate", "respiratoryRate"]) {
    if (day[name] !== undefined && day[name] < 0) throw new Error("Negative metric");
  }
  for (const name of ["spo2", "sleepEfficiency"]) {
    if (day[name] !== undefined && (day[name] < 0 || day[name] > 100)) {
      throw new Error("Invalid percentage");
    }
  }
  for (const name of ["hrvSeries", "spo2Series", "heartRateSeries"]) {
    for (const sample of day[name] ?? []) {
      if (!Number.isFinite(sample.v) || !Number.isFinite(Date.parse(sample.t))) {
        throw new Error("Invalid sample");
      }
    }
  }
  for (const session of day.sleepSessions ?? []) {
    const start = Date.parse(session.startTime), end = Date.parse(session.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("Invalid sleep interval");
    }
    for (const stage of session.stages) {
      const a = Date.parse(stage.startTime), b = Date.parse(stage.endTime);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < start || b > end || b <= a) {
        throw new Error("Invalid stage interval");
      }
    }
  }
}
