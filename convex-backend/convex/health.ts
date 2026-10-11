import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { healthFields } from "./healthFields";
import { validateDay } from "./validation.mjs";

// Internal functions cannot be called by an unauthenticated Convex client.
// The native app uses the separately authenticated HTTP gateway.
export const upsert = internalMutation({
  args: healthFields,
  handler: async (ctx, args) => {
    validateDay(args);
    const existing = await ctx.db.query("healthDays")
      .withIndex("by_source_date", q => q.eq("source", args.source).eq("date", args.date))
      .unique();
    const record = { ...args, updatedAt: Date.now() };
    // Replace a complete day, so stale optional fields cannot survive resync.
    if (existing) {
      await ctx.db.replace(existing._id, record);
      return existing._id;
    }
    return await ctx.db.insert("healthDays", record);
  },
});

export const get = internalQuery({
  args: { source: healthFields.source, date: v.string() },
  handler: async (ctx, args) => ctx.db.query("healthDays")
    .withIndex("by_source_date", q => q.eq("source", args.source).eq("date", args.date))
    .unique(),
});

export const removeSynthetic = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("healthDays")
      .withIndex("by_source_date", q => q.eq("source", "synthetic").eq("date", args.date))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const recent = internalQuery({
  args: { source: healthFields.source, limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 90) {
      throw new Error("Invalid history limit");
    }
    return ctx.db.query("healthDays")
      .withIndex("by_source_date", q => q.eq("source", args.source))
      .order("desc").take(args.limit);
  },
});
