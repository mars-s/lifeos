import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { healthFields } from "./healthFields";

export default defineSchema({
  healthDays: defineTable({
    ...healthFields,
    updatedAt: v.number(),
  }).index("by_source_date", ["source", "date"]),
});
