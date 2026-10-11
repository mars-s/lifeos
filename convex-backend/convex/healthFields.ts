import { v } from "convex/values";

const sample = v.object({ t: v.string(), v: v.number() });
const stage = v.object({
  type: v.union(v.literal("AWAKE"), v.literal("LIGHT"), v.literal("DEEP"), v.literal("REM")),
  startTime: v.string(),
  endTime: v.string(),
});

// Adapted from Pulse. Efficiency is not a provider's proprietary sleep score.
export const healthFields = {
  source: v.union(v.literal("google-health"), v.literal("synthetic")),
  date: v.string(),
  timeZone: v.string(),
  restingHeartRate: v.optional(v.number()),
  hrv: v.optional(v.number()),
  spo2: v.optional(v.number()),
  sleepEfficiency: v.optional(v.number()),
  sleepMinutes: v.optional(v.number()),
  steps: v.optional(v.number()),
  activeMinutes: v.optional(v.number()),
  respiratoryRate: v.optional(v.number()),
  skinTempDeviation: v.optional(v.number()),
  hrvSeries: v.optional(v.array(sample)),
  spo2Series: v.optional(v.array(sample)),
  heartRateSeries: v.optional(v.array(sample)),
  sleepSessions: v.optional(v.array(v.object({
    label: v.string(),
    startTime: v.string(),
    endTime: v.string(),
    minutesAsleep: v.optional(v.number()),
    minutesInPeriod: v.optional(v.number()),
    stages: v.array(stage),
  }))),
};
