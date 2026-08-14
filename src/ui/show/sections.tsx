/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { dependentSelect, inlineValidation, liveSearch, paginatedTableLink } from "../../html/htmx/htmx-patterns";
import type { FC } from "../../jsx/types";
import { Button } from "../core/button";
import { FormField } from "../core/field-layout";
import type { ForgeIcon } from "../core/icon";
import { Input } from "../core/input";
import { Select } from "../core/select";
import { FlashOob } from "../server/flash";
import type { DependentData, PaginateData, PreviewData, SearchData, ShowcasePaths, ToastData, ValidateData } from "./route";

/** @public */ export const SHOW_SEARCH_ID = "show-search-results";
/** @public */ export const SHOW_VALIDATE_ID = "show-validate-field";
/** @public */ export const SHOW_PAGINATE_ID = "show-paginate-table";
/** @public */ export const SHOW_DEPENDENT_ID = "show-dependent-select";
/** @public */ export const SHOW_PREVIEW_ID = "show-preview-button";

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
  "ToggleGroup",
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
  { id: 19, name: "ToggleGroup", category: "Action" },
];

const PAGE_SIZE = 6;
const TOTAL_PAGES = Math.ceil(TABLE_ROWS.length / PAGE_SIZE);

const CATEGORY_ITEMS: Record<string, string[]> = {
  fruit: ["Apple", "Banana", "Cherry", "Mango", "Papaya"],
  vegetable: ["Broccoli", "Carrot", "Celery", "Kale", "Spinach"],
  grain: ["Barley", "Millet", "Oats", "Quinoa", "Wheat"],
};

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
export const ValidateFragment: FC<{ data: ValidateData; icon: ForgeIcon<"close"> }> = ({ data, icon: Icon }) => {
  const isValid = data.email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
  const showError = data.email.length > 0 && !isValid;
  return (
    <FormField id={SHOW_VALIDATE_ID} name='email' invalid={showError}>
      <FormField.Label name='email'>Email</FormField.Label>
      {/* On the control rather than a wrapper: htmx sends the triggering element's own value on a
          GET. `sync` is explicit because the default resolves `closest form`, which this standalone
          field has none of — htmx would throw inside its own trigger handler and send nothing. */}
      <Input
        type='email'
        name='email'
        placeholder='you@example.com'
        value={data.email}
        field={{ name: "email", invalid: showError, description: isValid }}
        {...inlineValidation({ get: data.paths.validate, target: `#${SHOW_VALIDATE_ID}`, trigger: "change delay:200ms, blur" })}
      />
      {showError ? (
        <FormField.Error name='email'>
          <Icon name='close' aria-hidden='true' />
          Please enter a valid email address.
        </FormField.Error>
      ) : null}
      {isValid ? (
        <FormField.Description name='email' class='text-success'>
          Looks good!
        </FormField.Description>
      ) : null}
    </FormField>
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
    <FormField id={SHOW_DEPENDENT_ID} name='item' class='gap-1.5'>
      <FormField.Label for='dependent-item'>Item</FormField.Label>
      <Select id='dependent-item' name='item' icon={Icon}>
        {items.map((item) => (
          <Select.Option key={item} value={item.toLowerCase()}>
            {item}
          </Select.Option>
        ))}
      </Select>
    </FormField>
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
      <FormField name='variant' class='w-auto gap-1.5'>
        <FormField.Label for='preview-variant'>Variant</FormField.Label>
        <Select id='preview-variant' name='variant' icon={Icon}>
          <Select.Option value='primary'>primary</Select.Option>
          <Select.Option value='secondary'>secondary</Select.Option>
          <Select.Option value='ghost'>ghost</Select.Option>
        </Select>
      </FormField>
      <FormField name='size' class='w-auto gap-1.5'>
        <FormField.Label for='preview-size'>Size</FormField.Label>
        <Select id='preview-size' name='size' icon={Icon}>
          <Select.Option value='sm'>sm</Select.Option>
          <Select.Option value='md' selected>
            md
          </Select.Option>
          <Select.Option value='lg'>lg</Select.Option>
        </Select>
      </FormField>
    </form>
    <PreviewFragment data={{ variant: "primary", size: "md" }} icon={Icon} />
  </Section>
);

/** Validate demo: inline email validation. @public */
export const ValidateSection: FC<{ paths: ShowcasePaths; icon: ForgeIcon<"close"> }> = ({ paths, icon }) => (
  <Section
    id='demo-validate'
    title='Inline Validation'
    description='Type an email — validation runs on blur via HTMX GET, swapping only the field.'>
    <div class='max-w-sm'>
      <ValidateFragment data={{ email: "", paths }} icon={icon} />
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
      <FormField name='q' class='max-w-sm gap-1.5'>
        <FormField.Label name='q'>Search components</FormField.Label>
        <Input
          type='search'
          placeholder='Search components…'
          field={{ name: "q" }}
          {...liveSearch({ get: paths.search, target: `#${SHOW_SEARCH_ID}` })}
        />
      </FormField>
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
      <FormField name='category' class='flex-1 min-w-32 gap-1.5'>
        <FormField.Label for='dependent-category'>Category</FormField.Label>
        <Select id='dependent-category' name='category' icon={Icon} {...dependentSelect({ get: paths.dependent, target: `#${SHOW_DEPENDENT_ID}` })}>
          <Select.Option value='fruit'>Fruit</Select.Option>
          <Select.Option value='vegetable'>Vegetable</Select.Option>
          <Select.Option value='grain'>Grain</Select.Option>
        </Select>
      </FormField>
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
