import type { Caterer } from "../types/domain.js";
import { DomainError } from "./errors.js";

/** Temporary actor-ID boundary until authentication is introduced. */
export function assertCatererOwnership(caterer: Caterer, actorUserId: string): void {
  if (caterer.ownerUserId !== actorUserId) {
    throw new DomainError("UNAUTHORIZED_CATERER");
  }
}
