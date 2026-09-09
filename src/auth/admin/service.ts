import type { AdminUserOutcome, AdminUserStore, AuthStoreResult, AuthUser, AuthUserPage } from "../types";

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

const LAST_ADMIN_REFUSALS: readonly AdminUserOutcome[] = ["last-admin-deactivate", "last-admin-delete", "last-admin-demote"];

/** Whether an outcome is the last-admin guard refusing, whichever write asked. @public */
export function isLastAdminRefusal(outcome: AdminUserOutcome): boolean {
  return LAST_ADMIN_REFUSALS.includes(outcome);
}

// No count-then-decide step in this layer, deliberately: two concurrent demotions each reading "two
// admins remain" is how a deployment ends with none, and the store's guarded write has no such read.
/** Builds the administrative service over the store a sign-in path is not given. @public */
export function createAdminUserService(options: AdminUserServiceOptions): AdminUserService {
  return {
    list: (page) => options.users.list(page),
    search: (query, page) => options.users.search(query, page),
    view: (id) => options.users.findById(id),
    countAdmins: () => options.users.countAdmins(),
    elevate: (id, at) => options.users.setAdmin(id, true, at),
    demote: (id, at) => options.users.setAdmin(id, false, at),
    deactivate: (id, at) => options.users.setDeactivated(id, true, at),
    reactivate: (id, at) => options.users.setDeactivated(id, false, at),
    remove: (id) => options.users.remove(id),
  };
}
