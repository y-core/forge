import { defineRules } from "../../define";

export default defineRules([
  {
    id: "app-architecture-controller-imports-controller",
    statement: "A controller never imports another controller.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "app-architecture-service-imports-ui",
    statement: "A service never imports a controller or a view.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "app-architecture-view-imports-service",
    statement: "A view never imports a service or a controller, because every value it renders was resolved before it was called.",
    detectors: [{ kind: "lint", key: "eslint/no-restricted-imports" }],
  },
  {
    id: "app-architecture-dev-policy-module",
    statement: "Express a development environment's weaker policy as a module the build selects, never as a runtime flag or a second entry.",
    detectors: [{ kind: "step", label: "validate-dev-boundary" }],
  },
]);
