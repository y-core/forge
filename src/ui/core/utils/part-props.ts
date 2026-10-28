import { cloneElement, Fragment, isValidElement } from "../../../render/jsx/element";
import type { ComponentFn, JSXElement, JSXNode } from "../../../render/jsx/types";

const PART_ALIASES = new WeakMap<ComponentFn, ComponentFn>();

/** Let `wrapper` receive the props a root fills into `part`. @internal */
export function aliasPart(wrapper: ComponentFn, part: ComponentFn): void {
  PART_ALIASES.set(wrapper, part);
}

function fillsFor(type: ComponentFn, fills: ReadonlyMap<ComponentFn, Record<string, unknown>>): Record<string, unknown> | undefined {
  return fills.get(type) ?? fills.get(PART_ALIASES.get(type) ?? type);
}

function undefinedOnly(element: JSXElement, fill: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fill).filter(([key]) => element.props[key] === undefined));
}

/** Fill each matching part in `children` with the root props it left undefined. @internal */
export function fillPartProps(children: JSXNode, fills: ReadonlyMap<ComponentFn, Record<string, unknown>>): JSXNode {
  if (Array.isArray(children)) return children.map((child: JSXNode) => fillPartProps(child, fills));
  if (!isValidElement(children)) return children;

  const fill = typeof children.type === "string" || children.type === Fragment ? {} : fillsFor(children.type, fills);
  if (!fill) return children;
  const nested = fillPartProps(children.props.children as JSXNode, fills);
  return cloneElement(children, { ...undefinedOnly(children, fill), children: nested });
}
