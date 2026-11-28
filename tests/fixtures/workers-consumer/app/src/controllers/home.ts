// Planted: a controller importing another controller (APP_ARCHITECTURE.md §2b).
import { accountPage } from "./account";

export const homePage = (): string => accountPage();
