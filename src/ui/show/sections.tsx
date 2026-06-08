/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */

import { dependentSelect, inlineValidation, liveSearch, paginatedTableLink } from "../../html/htmx/htmx-patterns";
import type { FC } from "../../jsx/types";
import { Button } from "../core/button";
import { Field } from "../core/field-layout";
import type { ForgeIcon } from "../core/icon";
import { Input } from "../core/input";
import { FlashOob } from "../server/flash";
import type { DependentData, PaginateData, PreviewData, SearchData, ShowcasePaths, ToastData, ValidateData } from "./route";

// ─── Stable swap-target ids ─────────────────────────────────────────────────
/** @public */ export const SHOW_SEARCH_ID = "show-search-results";
/** @public */ export const SHOW_VALIDATE_ID = "show-validate-field";
/** @public */ export const SHOW_PAGINATE_ID = "show-paginate-table";
/** @public */ export const SHOW_DEPENDENT_ID = "show-dependent-select";
/** @public */ export const SHOW_PREVIEW_ID = "show-preview-button";

// ─── Demo corpus ─────────────────────────────────────────────────────────────

const SEARCH_CORPUS = [
  "Alert",
  "Avatar",
  "Badge",
  "Button",
  "Card",
  "Field",
  "Form",
  "Icon",
  "Input",
  "Label",
  "Popover",
  "Progress",
  "Select",
  "Separator",
  "Skeleton",
  "Spinner",
  "Textarea",
  "Toast",
];

const TABLE_ROWS = [
  { id: 1, name: "Alert", category: "Feedback" },
  { id: 2, name: "Avatar", category: "Display" },
  { id: 3, name: "Badge", category: "Display" },
  { id: 4, name: "Button", category: "Action" },
  { id: 5, name: "Card", category: "Layout" },
  { id: 6, name: "Field", category: "Form" },
  { id: 7, name: "Form", category: "Form" },
  { id: 8, name: "Icon", category: "Display" },
  { id: 9, name: "Input", category: "Form" },
  { id: 10, name: "Label", category: "Form" },
  { id: 11, name: "Popover", category: "Overlay" },
  { id: 12, name: "Progress", category: "Feedback" },
  { id: 13, name: "Select", category: "Form" },
  { id: 14, name: "Separator", category: "Layout" },
  { id: 15, name: "Skeleton", category: "Feedback" },
  { id: 16, name: "Spinner", category: "Feedback" },
  { id: 17, name: "Textarea", category: "Form" },
  { id: 18, name: "Toast", category: "Feedback" },
];

const PAGE_SIZE = 6;
const TOTAL_PAGES = Math.ceil(TABLE_ROWS.length / PAGE_SIZE);

const CATEGORY_ITEMS: Record<string, string[]> = {
  fruit: ["Apple", "Banana", "Cherry", "Mango", "Papaya"],
  vegetable: ["Broccoli", "Carrot", "Celery", "Kale", "Spinach"],
  grain: ["Barley", "Millet", "Oats", "Quinoa", "Wheat"],
};

// ─── Fragment views ───────────────────────────────────────────────────────────

/** Live button preview from variant + size query params. @public */
export const PreviewFragment: FC<{ data: PreviewData; icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({
  data,
  icon: _icon,
}) => {
  const variant = (["primary", "secondary", "ghost"].includes(data.variant) ? data.variant : "primary") as "primary" | "secondary" | "ghost";
  const size = (["sm", "md", "lg"].includes(data.size) ? data.size : "md") as "sm" | "md" | "lg";
  return (
    <div id={SHOW_PREVIEW_ID} class='flex items-center justify-center rounded-xl border border-border bg-muted p-8'>
      <Button variant={variant} size={size}>
        Preview
      </Button>
    </div>
  );
};

/** Inline email validation field fragment. @public */
export const ValidateFragment: FC<{ data: ValidateData }> = ({ data }) => {
  const isValid = data.email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
  const showError = data.email.length > 0 && !isValid;
  return (
    <Field id={SHOW_VALIDATE_ID} name='email' invalid={showError}>
      <Field.Label name='email'>Email</Field.Label>
      <Input type='email' name='email' placeholder='you@example.com' value={data.email} field={{ name: "email", invalid: showError }} />
      {showError ? <Field.Error name='email'>Please enter a valid email address.</Field.Error> : null}
      {isValid ? (
        <Field.Description name='email' class='text-emerald-600'>
          Looks good!
        </Field.Description>
      ) : null}
    </Field>
  );
};

/** Filtered component search results list. @public */
export const SearchFragment: FC<{ data: SearchData }> = ({ data }) => {
  const q = data.q.toLowerCase().trim();
  const results = q ? SEARCH_CORPUS.filter((name) => name.toLowerCase().includes(q)) : SEARCH_CORPUS;
  return (
    <ul id={SHOW_SEARCH_ID} class='grid grid-cols-2 gap-2 sm:grid-cols-3'>
      {results.length === 0 ? (
        <li class='col-span-3 py-4 text-center text-sm text-muted-foreground'>No components match.</li>
      ) : (
        results.map((name) => (
          <li key={name} class='rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground'>
            {name}
          </li>
        ))
      )}
    </ul>
  );
};

/** Paginated table fragment with next/prev links. @public */
export const PaginateFragment: FC<{ data: PaginateData }> = ({ data }) => {
  const { page, paths } = data;
  const safePage = Math.min(Math.max(1, page), TOTAL_PAGES);
  const rows = TABLE_ROWS.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasPrev = safePage > 1;
  const hasNext = safePage < TOTAL_PAGES;

  const paginateAttrs = (p: number) => paginatedTableLink({ get: paths.paginate, target: `#${SHOW_PAGINATE_ID}`, page: p });

  return (
    <div id={SHOW_PAGINATE_ID}>
      <table class='w-full border-collapse text-sm'>
        <thead>
          <tr class='border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            <th class='py-2 pl-4 pr-4'>#</th>
            <th class='py-2 pr-4'>Component</th>
            <th class='py-2 pr-4'>Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} class='border-b border-border hover:bg-accent'>
              <td class='py-2 pl-4 pr-4 font-mono text-xs text-muted-foreground'>{row.id}</td>
              <td class='py-2 pr-4 font-medium text-foreground'>{row.name}</td>
              <td class='py-2 pr-4 text-muted-foreground'>{row.category}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class='flex items-center justify-between border-t border-border px-4 py-3'>
        <span class='text-xs text-muted-foreground'>
          Page {safePage} of {TOTAL_PAGES}
        </span>
        <div class='flex gap-2'>
          {hasPrev ? (
            <Button variant='secondary' size='sm' {...paginateAttrs(safePage - 1)}>
              Previous
            </Button>
          ) : null}
          {hasNext ? (
            <Button variant='secondary' size='sm' {...paginateAttrs(safePage + 1)}>
              Next
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/** Repopulated select fragment for the chosen category. @public */
export const DependentFragment: FC<{ data: DependentData; icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({
  data,
  icon: Icon,
}) => {
  const items = CATEGORY_ITEMS[data.category] ?? CATEGORY_ITEMS.fruit ?? [];
  return (
    <div id={SHOW_DEPENDENT_ID} class='flex flex-col gap-1.5'>
      <label class='text-sm font-medium text-foreground' for='dependent-item'>
        Item
      </label>
      <div class='relative w-full'>
        <select
          id='dependent-item'
          name='item'
          class='w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20'>
          {items.map((item) => (
            <option key={item} value={item.toLowerCase()}>
              {item}
            </option>
          ))}
        </select>
        <span aria-hidden='true' class='pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground'>
          <Icon
            name='chevron-down'
            width={16}
            height={16}
            stroke='currentColor'
            stroke-width={1.5}
            stroke-linecap='round'
            stroke-linejoin='round'
          />
        </span>
      </div>
    </div>
  );
};

/** OOB flash toast fragment. @public */
export const ToastFragment: FC<{ data: ToastData }> = ({ data }) => {
  const validTypes = ["success", "info", "warning", "error"] as const;
  type FlashType = (typeof validTypes)[number];
  const type: FlashType = (validTypes.includes(data.type as FlashType) ? data.type : "success") as FlashType;
  const messages: { type: FlashType; text: string; title: string }[] = [
    { type, title: type.charAt(0).toUpperCase() + type.slice(1), text: `This is a ${type} toast notification.` },
  ];
  return <FlashOob messages={messages} />;
};

// ─── Demo section wrappers ────────────────────────────────────────────────────

interface SectionProps {
  id: string;
  title: string;
  description: string;
  children: unknown;
}

const Section: FC<SectionProps> = ({ id, title, description, children }) => (
  <section id={id} class='scroll-mt-24 space-y-4 rounded-2xl border border-border bg-card p-6'>
    <div>
      <h2 class='text-lg font-semibold text-foreground'>{title}</h2>
      <p class='mt-1 text-sm text-muted-foreground'>{description}</p>
    </div>
    {children}
  </section>
);

/** Preview demo: choose variant + size, see a live Button. @public */
export const PreviewSection: FC<{ paths: ShowcasePaths; icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({
  paths,
  icon: Icon,
}) => (
  <Section id='demo-preview' title='Live Preview' description='Choose variant and size — the button updates live via HTMX GET.'>
    <form class='flex flex-wrap items-end gap-3' hx-get={paths.preview} hx-target={`#${SHOW_PREVIEW_ID}`} hx-swap='outerHTML' hx-trigger='change'>
      <div class='flex flex-col gap-1.5'>
        <label class='text-sm font-medium text-foreground' for='preview-variant'>
          Variant
        </label>
        <div class='relative'>
          <select
            id='preview-variant'
            name='variant'
            class='appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20'>
            <option value='primary'>primary</option>
            <option value='secondary'>secondary</option>
            <option value='ghost'>ghost</option>
          </select>
          <span aria-hidden='true' class='pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground'>
            <Icon
              name='chevron-down'
              width={16}
              height={16}
              stroke='currentColor'
              stroke-width={1.5}
              stroke-linecap='round'
              stroke-linejoin='round'
            />
          </span>
        </div>
      </div>
      <div class='flex flex-col gap-1.5'>
        <label class='text-sm font-medium text-foreground' for='preview-size'>
          Size
        </label>
        <div class='relative'>
          <select
            id='preview-size'
            name='size'
            class='appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20'>
            <option value='sm'>sm</option>
            <option value='md' selected>
              md
            </option>
            <option value='lg'>lg</option>
          </select>
          <span aria-hidden='true' class='pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground'>
            <Icon
              name='chevron-down'
              width={16}
              height={16}
              stroke='currentColor'
              stroke-width={1.5}
              stroke-linecap='round'
              stroke-linejoin='round'
            />
          </span>
        </div>
      </div>
    </form>
    <PreviewFragment data={{ variant: "primary", size: "md" }} icon={Icon} />
  </Section>
);

/** Validate demo: inline email validation. @public */
export const ValidateSection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <Section
    id='demo-validate'
    title='Inline Validation'
    description='Type an email — validation runs on blur via HTMX GET, swapping only the field.'>
    <div {...inlineValidation({ get: paths.validate, target: `#${SHOW_VALIDATE_ID}`, trigger: "change delay:200ms, blur" })} class='max-w-sm'>
      <ValidateFragment data={{ email: "" }} />
    </div>
    <p class='text-xs text-muted-foreground'>
      Uses <code>inlineValidation()</code> from <code>@y-core/forge/html/htmx</code>.
    </p>
  </Section>
);

/** Search demo: live-filtered component list. @public */
export const SearchSection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <Section id='demo-search' title='Live Search' description='Filter components by name — results update as you type via HTMX GET.'>
    <div class='space-y-4'>
      <input
        type='search'
        name='q'
        placeholder='Search components…'
        class='w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20'
        {...liveSearch({ get: paths.search, target: `#${SHOW_SEARCH_ID}` })}
      />
      <SearchFragment data={{ q: "" }} />
    </div>
    <p class='text-xs text-muted-foreground'>
      Uses <code>liveSearch()</code> with 300 ms debounce.
    </p>
  </Section>
);

/** Paginate demo: table with next/prev navigation. @public */
export const PaginateSection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <Section id='demo-paginate' title='Paginated Table' description='Navigate pages — the table body swaps via HTMX GET.'>
    <div class='overflow-x-auto rounded-xl border border-border'>
      <PaginateFragment data={{ page: 1, paths }} />
    </div>
    <p class='text-xs text-muted-foreground'>
      Uses <code>paginatedTableLink()</code> helper on each page button.
    </p>
  </Section>
);

/** Dependent select demo: category drives items. @public */
export const DependentSection: FC<{ paths: ShowcasePaths; icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({
  paths,
  icon: Icon,
}) => (
  <Section id='demo-dependent' title='Dependent Select' description='Choose a food category — the items select repopulates via HTMX GET.'>
    <div class='flex flex-wrap gap-6 max-w-sm'>
      <div class='flex flex-col gap-1.5 flex-1 min-w-32'>
        <label class='text-sm font-medium text-foreground' for='dependent-category'>
          Category
        </label>
        <div class='relative'>
          <select
            id='dependent-category'
            name='category'
            class='w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20'
            {...dependentSelect({ get: paths.dependent, target: `#${SHOW_DEPENDENT_ID}` })}>
            <option value='fruit'>Fruit</option>
            <option value='vegetable'>Vegetable</option>
            <option value='grain'>Grain</option>
          </select>
          <span aria-hidden='true' class='pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground'>
            <Icon
              name='chevron-down'
              width={16}
              height={16}
              stroke='currentColor'
              stroke-width={1.5}
              stroke-linecap='round'
              stroke-linejoin='round'
            />
          </span>
        </div>
      </div>
      <div class='flex-1 min-w-32'>
        <DependentFragment data={{ category: "fruit" }} icon={Icon} />
      </div>
    </div>
    <p class='text-xs text-muted-foreground'>
      Uses <code>dependentSelect()</code> helper.
    </p>
  </Section>
);

/** Toast demo: trigger OOB flash toasts. @public */
export const ToastSection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <Section id='demo-toast' title='Flash Toast (OOB)' description='Click a type — a toast is injected OOB into #flash-container via HTMX GET.'>
    <div class='flex flex-wrap gap-3'>
      {(["success", "info", "warning", "error"] as const).map((type) => (
        <Button key={type} variant='secondary' size='sm' hx-get={`${paths.toast}?type=${type}`} hx-swap='none'>
          {type}
        </Button>
      ))}
    </div>
    <p class='text-xs text-muted-foreground'>
      Uses <code>FlashOob</code> with <code>hx-swap-oob</code> targeting <code>#flash-container</code>.
    </p>
  </Section>
);
