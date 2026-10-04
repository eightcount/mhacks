import { z } from "zod";

/** Require an explicit country code; never guess one from a local number. */
export const phoneNumberSchema = z.string().trim().max(50)
  .transform(value => value.replace(/[\s().-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Use a phone number with its country code, e.g. +12025550143."));
