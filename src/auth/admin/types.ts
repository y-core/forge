import type { AdminUserOutcome } from "../types";
import type { AdminUserStore } from "../types";
import type { AuthStoreResult } from "../types";
import type { AuthUser } from "../types";
import type { AuthUserPage } from "../types";

/** @public */
export interface AdminUserServiceOptions {
  users: AdminUserStore;
}

/** The administrative surface, named per operation so a caller cannot pass the wrong boolean. @public */
export interface AdminUserService {
  list(page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthUser[]>>;
  search(query: string, page?: AuthUserPage): Promise<AuthStoreResult<readonly AuthUser[]>>;
  view(id: string): Promise<AuthStoreResult<AuthUser | null>>;
  /** Admins who could still sign in — what the last-admin controls and the first-admin claim read. */
  countAdmins(): Promise<AuthStoreResult<number>>;
  elevate(id: string, at: number): Promise<AuthStoreResult<AdminUserOutcome>>;
  demote(id: string, at: number): Promise<AuthStoreResult<AdminUserOutcome>>;
  deactivate(id: string, at: number): Promise<AuthStoreResult<AdminUserOutcome>>;
  reactivate(id: string, at: number): Promise<AuthStoreResult<AdminUserOutcome>>;
  remove(id: string): Promise<AuthStoreResult<AdminUserOutcome>>;
}
