/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { Navbar } from "../chrome/navbar";
import type { NavDefinition } from "../chrome/navbar-items";
import { ThemeToggle } from "../chrome/theme-toggle";
import { APPEARANCES, type Appearance, type Tone, TONES } from "../contracts/vocabulary";
import { Accordion } from "../core/accordion";
import { Alert } from "../core/alert";
import { Avatar } from "../core/avatar";
import { Badge } from "../core/badge";
import { Breadcrumbs } from "../core/breadcrumbs";
import { Button } from "../core/button";
import { Card } from "../core/card";
import { Carousel } from "../core/carousel";
import { CheckboxGroup } from "../core/checkbox-group";
import { Collapsible } from "../core/collapsible";
import { Dialog } from "../core/dialog";
import { Drawer } from "../core/drawer";
import { EmptyState } from "../core/empty-state";
import { FormField } from "../core/field-layout";
import { Field } from "../core/field-stack";
import { FileInput } from "../core/file-input";
import { Filter } from "../core/filter";
import { Form } from "../core/form";
import { Honeypot } from "../core/honeypot";
import type { ForgeIcon } from "../core/icon";
import { Indicator } from "../core/indicator";
import { Input } from "../core/input";
import { Join } from "../core/join";
import { Kbd } from "../core/kbd";
import { Label } from "../core/label";
import { Link } from "../core/link";
import { Menu } from "../core/menu";
import { Meter } from "../core/meter";
import { NumberField } from "../core/number-field";
import { OtpInput } from "../core/otp-input";
import { Pagination } from "../core/pagination";
import { Popover } from "../core/popover";
import { Progress } from "../core/progress";
import { RadioGroup } from "../core/radio-group";
import { ScrollArea } from "../core/scroll-area";
import { Select } from "../core/select";
import { Separator } from "../core/separator";
import { Skeleton } from "../core/skeleton";
import { Slider } from "../core/slider";
import { Spinner } from "../core/spinner";
import { Stack } from "../core/stack";
import { Stat } from "../core/stat";
import { Status } from "../core/status";
import { Steps } from "../core/steps";
import { Switch } from "../core/switch";
import { Table } from "../core/table";
import { Tabs } from "../core/tabs";
import { Textarea } from "../core/textarea";
import { Timeline } from "../core/timeline";
import { Toast } from "../core/toast";
import { Toggle } from "../core/toggle";
import { ToggleGroup } from "../core/toggle-group";
import { Toolbar } from "../core/toolbar";
import { Tooltip } from "../core/tooltip";
import { FlashContainer } from "../server/flash";
import { Resumable } from "../server/resumable";
import { ChromeDemos } from "./chrome-demos";
import { ControlsDemos } from "./controls-demos";
import { FlashSection, LazySection } from "./extra-demos";
import type { ShowcaseData, ShowcasePaths } from "./route";
import { SHOW_SCOPES } from "./scope-contract";
import { DependentSection, PaginateSection, PreviewSection, SearchSection, ToastSection, ValidateSection } from "./sections";
import { TOAST_CYCLE_DURATION, TOAST_CYCLE_SCOPE } from "./toast-contract";
import { TurnstileDemos, type TurnstileDemoOptions } from "./turnstile-demo";

/** The showcase's bound sprite. Named once because a dozen section signatures take it. @internal */
export type ShowIcon = ForgeIcon<
  | "spinner"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "sun"
  | "moon"
  | "monitor"
  | "hamburger"
  | "close"
  | "panel-open"
  | "panel-close"
  | "upload"
>;

/** The bands the table of contents reads in — a catalog entry names one, and nothing else groups. */
type ShowcaseGroup = "Primitives" | "Forms & Controls" | "Bound Controls" | "Interaction & Overlay" | "Feedback" | "Chrome" | "Behaviour";

/** The route a catalog entry is served on — pages are cut by what a consumer must wire up. */
export type ShowcasePage = "index" | "interactive" | "runtime" | "htmx" | "turnstile" | "chrome";

/** Every catalog entry, keyed by the kebab-cased name of the component it shows. */
export const SECTIONS: { id: string; label: string; group: ShowcaseGroup; page: ShowcasePage }[] = [
  { id: "accordion", label: "Accordion", group: "Behaviour", page: "index" },
  { id: "alert", label: "Alert", group: "Feedback", page: "interactive" },
  { id: "avatar", label: "Avatar", group: "Primitives", page: "index" },
  { id: "badge", label: "Badge", group: "Primitives", page: "index" },
  { id: "breadcrumbs", label: "Breadcrumbs", group: "Behaviour", page: "index" },
  { id: "drawer", label: "Drawer", group: "Interaction & Overlay", page: "interactive" },
  { id: "empty-state", label: "EmptyState", group: "Feedback", page: "index" },
  { id: "file-input", label: "FileInput", group: "Forms & Controls", page: "index" },
  { id: "filter", label: "Filter", group: "Forms & Controls", page: "index" },
  { id: "indicator", label: "Indicator", group: "Primitives", page: "index" },
  { id: "join", label: "Join", group: "Forms & Controls", page: "index" },
  { id: "kbd", label: "Kbd", group: "Primitives", page: "index" },
  { id: "link", label: "Link", group: "Primitives", page: "index" },
  { id: "pagination", label: "Pagination", group: "Behaviour", page: "index" },
  { id: "stat", label: "Stat", group: "Primitives", page: "index" },
  { id: "status", label: "Status", group: "Primitives", page: "index" },
  { id: "steps", label: "Steps", group: "Behaviour", page: "index" },
  { id: "timeline", label: "Timeline", group: "Behaviour", page: "index" },
  { id: "carousel", label: "Carousel", group: "Behaviour", page: "interactive" },
  { id: "table", label: "Table", group: "Primitives", page: "index" },
  { id: "button", label: "Button", group: "Primitives", page: "index" },
  { id: "card", label: "Card", group: "Primitives", page: "index" },
  { id: "dialog", label: "Dialog", group: "Interaction & Overlay", page: "interactive" },
  { id: "field", label: "Field", group: "Forms & Controls", page: "index" },
  { id: "form", label: "Form", group: "Forms & Controls", page: "index" },
  { id: "form-field", label: "FormField", group: "Forms & Controls", page: "index" },
  { id: "honeypot", label: "Honeypot", group: "Forms & Controls", page: "index" },
  { id: "icon", label: "Icon", group: "Primitives", page: "index" },
  { id: "input", label: "Input", group: "Forms & Controls", page: "index" },
  { id: "label", label: "Label", group: "Forms & Controls", page: "index" },
  { id: "popover", label: "Popover", group: "Interaction & Overlay", page: "interactive" },
  { id: "progress", label: "Progress", group: "Primitives", page: "index" },
  { id: "select", label: "Select", group: "Forms & Controls", page: "index" },
  { id: "separator", label: "Separator", group: "Primitives", page: "index" },
  { id: "skeleton", label: "Skeleton", group: "Primitives", page: "index" },
  { id: "slider", label: "Slider", group: "Forms & Controls", page: "interactive" },
  { id: "spinner", label: "Spinner", group: "Primitives", page: "index" },
  { id: "stack", label: "Stack", group: "Primitives", page: "index" },
  { id: "switch", label: "Switch", group: "Forms & Controls", page: "index" },
  { id: "textarea", label: "Textarea", group: "Forms & Controls", page: "index" },
  { id: "toast", label: "Toast", group: "Feedback", page: "interactive" },
  { id: "toggle", label: "Toggle", group: "Forms & Controls", page: "index" },
  { id: "toggle-group", label: "ToggleGroup", group: "Forms & Controls", page: "interactive" },
  { id: "toolbar", label: "Toolbar", group: "Chrome", page: "interactive" },
  { id: "menu", label: "Menu", group: "Interaction & Overlay", page: "interactive" },
  { id: "tabs", label: "Tabs", group: "Behaviour", page: "interactive" },
  { id: "collapsible", label: "Collapsible", group: "Behaviour", page: "index" },
  { id: "tooltip", label: "Tooltip", group: "Interaction & Overlay", page: "interactive" },
  { id: "checkbox-group", label: "CheckboxGroup", group: "Forms & Controls", page: "index" },
  { id: "radio-group", label: "RadioGroup", group: "Forms & Controls", page: "index" },
  { id: "meter", label: "Meter", group: "Primitives", page: "index" },
  { id: "number-field", label: "NumberField", group: "Forms & Controls", page: "interactive" },
  { id: "otp-input", label: "OtpInput", group: "Forms & Controls", page: "index" },
  { id: "scroll-area", label: "ScrollArea", group: "Behaviour", page: "index" },
  { id: "turnstile-widget", label: "Turnstile playground", group: "Forms & Controls", page: "turnstile" },
  { id: "turnstile-variants", label: "Turnstile sizes and modes", group: "Forms & Controls", page: "turnstile" },
  { id: "turnstile-resilience", label: "Turnstile resilience", group: "Forms & Controls", page: "turnstile" },
  { id: "turnstile-verify", label: "Turnstile verification", group: "Forms & Controls", page: "turnstile" },
  { id: "turnstile-keys", label: "Turnstile test keys", group: "Forms & Controls", page: "turnstile" },
  { id: "htmx-demos", label: "HTMX Demos", group: "Behaviour", page: "htmx" },
  { id: "theme", label: "Theme", group: "Chrome", page: "chrome" },
  { id: "tokens", label: "Shape tokens", group: "Chrome", page: "chrome" },
  { id: "resumable", label: "Resumable", group: "Behaviour", page: "runtime" },
  { id: "native-and-reactive", label: "Native vs Bound", group: "Bound Controls", page: "runtime" },
  { id: "controls-input", label: "Bound Input", group: "Bound Controls", page: "runtime" },
  { id: "controls-select", label: "Bound Select", group: "Bound Controls", page: "runtime" },
  { id: "controls-slider", label: "Bound Slider", group: "Bound Controls", page: "runtime" },
  { id: "controls-switch", label: "Bound Switch", group: "Bound Controls", page: "runtime" },
  { id: "controls-textarea", label: "Bound Textarea", group: "Bound Controls", page: "runtime" },
  { id: "controls-toggle-group", label: "Bound ToggleGroup", group: "Bound Controls", page: "runtime" },
  { id: "controls-toggle", label: "Bound Toggle", group: "Bound Controls", page: "runtime" },
  { id: "controls-number-field", label: "Bound NumberField", group: "Bound Controls", page: "runtime" },
  { id: "controls-otp-input", label: "Bound OtpInput", group: "Bound Controls", page: "runtime" },
  { id: "controls-radio-group", label: "Bound RadioGroup", group: "Bound Controls", page: "runtime" },
  { id: "controls-checkbox-group", label: "Bound CheckboxGroup", group: "Bound Controls", page: "runtime" },
  { id: "controls-file-input", label: "Bound FileInput", group: "Bound Controls", page: "runtime" },
  { id: "chrome-dock", label: "Chrome Dock", group: "Chrome", page: "chrome" },
  { id: "chrome-navbar", label: "Chrome Navbar", group: "Chrome", page: "chrome" },
  { id: "chrome-toolbar", label: "Chrome Toolbar", group: "Chrome", page: "chrome" },
  { id: "flash", label: "Flash", group: "Feedback", page: "htmx" },
  { id: "lazy", label: "Lazy", group: "Behaviour", page: "runtime" },
];

/** Every showcase page, with the prerequisite a consumer must install for that page's demos to work. */
export const SHOWCASE_PAGES: Record<ShowcasePage, { slug: string; label: string; needs: string }> = {
  index: {
    slug: "",
    label: "Catalog",
    needs: "Nothing beyond the stylesheet — every section here is server-rendered markup and native behaviour, and works with JavaScript disabled.",
  },
  interactive: {
    slug: "interactive",
    label: "Interactive",
    needs:
      'Import "@y-core/forge/ui/core/client" and call resume() — each section here registers a scope that is inert until you do. Toolbar is the ui/core primitive; the configuration-driven chrome Toolbar is on the Chrome page.',
  },
  runtime: {
    slug: "runtime",
    label: "Runtime",
    needs:
      'Import "@y-core/forge/ui/show/client" and call resume() — signals drive the bound controls through bindControls, and lazy() holds the panel module back until its anchor is seen.',
  },
  htmx: {
    slug: "htmx",
    label: "HTMX",
    needs:
      'Import "@y-core/forge/ui/client/htmx" and serve the seven api.* endpoints registerShowcase mounts. Flash reads here because its message links the toast demo in the HTMX band.',
  },
  turnstile: {
    slug: "turnstile",
    label: "Turnstile",
    needs:
      'Import "@y-core/forge/ui/core/client" and call resume(), plus "@y-core/forge/ui/client/htmx" — the deferred challenge is run from the htmx:confirm seam. Pass registerShowcase a turnstileSecret for the verification panel to reach siteverify.',
  },
  chrome: {
    slug: "chrome",
    label: "Chrome",
    needs: 'Import "@y-core/forge/ui/chrome/client", call resume(), and supply the NavDefinition and ToolbarDefinition these sections render from.',
  },
};

/** The order the pages are offered in — the rail lists them, and nothing else orders pages. */
export const PAGE_ORDER: ShowcasePage[] = ["index", "interactive", "runtime", "htmx", "turnstile", "chrome"];

/** The order the groups are read in — plainest primitives first, page-level behaviour last. */
const GROUP_ORDER: ShowcaseGroup[] = [
  "Primitives",
  "Forms & Controls",
  "Bound Controls",
  "Interaction & Overlay",
  "Feedback",
  "Chrome",
  "Behaviour",
];

const pageUrl = (pagePath: string, slug: string) => (slug === "" ? pagePath : `${pagePath}/${slug}`);

/** The leading rail: where the reader can go — every showcase page, as a route. */
function pagesConfig(pagePath: string): NavDefinition {
  const pages = PAGE_ORDER.map((key) => ({ label: SHOWCASE_PAGES[key].label, href: pageUrl(pagePath, SHOWCASE_PAGES[key].slug) }));
  return { sections: [{ items: [{ heading: "Pages", group: pages }] }] };
}

/** The trailing rail: what is on the page being read — that page's own bands, as anchors. */
function sectionsConfig(page: ShowcasePage): NavDefinition {
  const bands = GROUP_ORDER.map((heading) => ({
    heading,
    group: SECTIONS.filter((section) => section.group === heading && section.page === page)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(({ id, label }) => ({ label, href: id })),
  })).filter((band) => band.group.length > 0);

  return { sections: [{ items: bands }] };
}

const pageHref = (key: string) => key;

const anchorHref = (key: string) => `#${key}`;

interface CatalogSectionProps {
  id: string;
  title: string;
  children: unknown;
}

// One heading treatment for every band on every page, so a reader scanning down the page reads the
// same rule in the same place each time.
const CatalogHeading: FC<{ children: unknown }> = ({ children }) => (
  <h2 class='border-b border-border pb-2 text-base font-semibold text-foreground'>{children}</h2>
);

/** A row of specimens, wrapping — the shape a band takes when its children are variants of one thing. @internal */
export const CatalogRow: FC<{ children: unknown }> = ({ children }) => <div class='flex flex-wrap items-start gap-4'>{children}</div>;

/** One catalog band: an anchored section headed by its component's name. @internal */
export const CatalogSection: FC<CatalogSectionProps> = ({ id, title, children }) => (
  <section id={id} class='scroll-mt-24 space-y-4'>
    <CatalogHeading>{title}</CatalogHeading>
    <CatalogRow>{children}</CatalogRow>
  </section>
);

/** The same band, for a demo that is one column rather than a row of specimens. @internal */
export const CatalogStack: FC<CatalogSectionProps> = ({ id, title, children }) => (
  <section id={id} class='scroll-mt-24 space-y-4'>
    <CatalogHeading>{title}</CatalogHeading>
    <div class='space-y-4'>{children}</div>
  </section>
);

// `w-full` and no cap: a band is a flex row, and an item measured at a cap leaves room on its line
// for the next specimen to land beside the sentence. The note takes the band's width, as its heading
// does.
/** A band's own note — a line about the specimens, on a row of its own. @internal */
export const CatalogNote: FC<{ children: unknown }> = ({ children }) => <p class='w-full text-sm text-pretty text-muted-foreground'>{children}</p>;

/** A titled column within a band, for a demo read as two things side by side. @internal */
export const CatalogGroup: FC<{ title: string; children: unknown }> = ({ title, children }) => (
  <div class='min-w-56 flex-1 space-y-2'>
    <h3 class='text-sm font-semibold text-foreground'>{title}</h3>
    {children}
  </div>
);

/** A job this band's component is not the answer to, and the catalog id of the one that is. @internal */
export interface CatalogAlternative {
  /** The other component's own job, in the corpus's words. */
  when: string;
  /** Its catalog id — the label and the page are read from `SECTIONS`. */
  id: string;
}

// Varied so a band with three alternatives does not read as a list of identical clauses.
const ALTERNATIVE_VERDICT = ["is likely more useful", "is the better choice", "is the better fit"] as const;

/** A catalog band's own anchor, reached across pages when the section is not on this one. */
function sectionHref(pagePath: string, id: string): string {
  const section = SECTIONS.find((entry) => entry.id === id);
  return section === undefined ? `#${id}` : `${pageUrl(pagePath, SHOWCASE_PAGES[section.page].slug)}#${id}`;
}

const sectionLabel = (id: string): string => SECTIONS.find((entry) => entry.id === id)?.label ?? id;

// A third sibling for the same reason `CatalogPanel` is the second: the flag would be the fourth on
// `CatalogSection`. Every clause is the corpus's own — `design/catalog.md` stays its single home.
/** What a band's component is best at, and which neighbour answers the jobs it does not. @internal */
export const CatalogPurpose: FC<{ page: string; id: string; best: string; instead: readonly CatalogAlternative[] }> = ({
  page,
  id,
  best,
  instead,
}) => (
  // `tone='secondary'` keeps every link on the same muted step as the sentence around it: the line is
  // a note, and the underline is enough of an affordance without a second colour in it.
  <CatalogNote>
    {sectionLabel(id)} is best when {best}.{" "}
    {instead.map((alternative, index) => (
      <>
        {index === 0 ? "When " : " — or when "}
        {alternative.when},{" "}
        <Link tone='secondary' href={sectionHref(page, alternative.id)}>
          {sectionLabel(alternative.id)}
        </Link>{" "}
        {ALTERNATIVE_VERDICT[index] ?? "is the better choice"}
        {index === instead.length - 1 ? "." : ""}
      </>
    ))}
  </CatalogNote>
);

interface CatalogPanelProps extends CatalogSectionProps {
  description: string;
}

// A sibling of `CatalogSection`, not a flag on it: a band that is a card and carries a description
// is a different shape, and the alternative is the four-flag component the design corpus warns about.
/** A card-shaped band: a heading, a line saying what it demonstrates, and the demo itself. @internal */
export const CatalogPanel: FC<CatalogPanelProps> = ({ id, title, description, children }) => (
  <section id={id} class='scroll-mt-24 space-y-4 rounded-2xl border border-border bg-card p-6'>
    <div>
      <h2 class='text-base font-semibold text-foreground'>{title}</h2>
      <p class='mt-1 text-sm text-muted-foreground'>{description}</p>
    </div>
    {children}
  </section>
);

const BADGE_APPEARANCES = ["solid", "soft", "outline"] as const;
const PANEL_APPEARANCES = ["soft", "solid"] as const;

/** The header row and the tone label a matrix column and row are read by. */
const ToneMatrixHead: FC<{ appearances: readonly Appearance[] }> = ({ appearances }) => (
  <>
    <span />
    {appearances.map((appearance) => (
      <span key={appearance} class='text-xs text-muted-foreground'>
        {appearance}
      </span>
    ))}
  </>
);

const MatrixLabel: FC<{ children: unknown }> = ({ children }) => <span class='text-xs text-muted-foreground'>{children}</span>;

const ToneLabel: FC<{ tone: Tone }> = ({ tone }) => <MatrixLabel>{tone}</MatrixLabel>;

const BUTTON_SIZES = ["sm", "md", "lg"] as const;
const BUTTON_SHAPES = ["default", "icon", "square", "circle"] as const;
/** The control width each size's non-default shape reads from — spelled out, so Tailwind can see them. */
const BUTTON_SHAPE_BOX = { sm: "w-control-sm", md: "w-control-md", lg: "w-control-lg" } as const;
/** The three tones a state has to be legible on: `state-disabled` composes over `--tone`, it does not replace it. */
const STATE_TONES = ["primary", "neutral", "destructive"] as const;

// A matrix belongs to the component it varies, not to a band of its own: a reader who has scrolled to
// `Badge` is the reader asking what its tones look like.
const AlertSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='alert' title='Alert'>
    <CatalogPurpose
      page={page}
      id='alert'
      best='stating a condition that persists on the page'
      instead={[{ when: "surfacing a background result the user did not wait for", id: "toast" }]}
    />
    <Alert class='min-w-56 flex-1'>
      <Alert.Title>Default</Alert.Title>
      <Alert.Description>A neutral informational alert.</Alert.Description>
    </Alert>
    <Alert tone='info' class='min-w-56 flex-1'>
      <Alert.Title>Info</Alert.Title>
      <Alert.Description>Informational notice for the user.</Alert.Description>
    </Alert>
    <Alert tone='success' class='min-w-56 flex-1'>
      <Alert.Title>Success</Alert.Title>
      <Alert.Description>Operation completed successfully.</Alert.Description>
    </Alert>
    <Alert tone='warning' class='min-w-56 flex-1'>
      <Alert.Title>Warning</Alert.Title>
      <Alert.Description>Something may need attention.</Alert.Description>
    </Alert>
    <Alert tone='destructive' class='min-w-56 flex-1' dismissible>
      <Alert.Title>Destructive</Alert.Title>
      <Alert.Description>An error occurred. Dismiss to acknowledge.</Alert.Description>
    </Alert>
    <Alert tone='primary' appearance='solid' class='min-w-56 flex-1'>
      <Alert.Title>Solid</Alert.Title>
      <Alert.Description>The filled appearance, for a banner that must lead the page.</Alert.Description>
    </Alert>
    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Tone × appearance</h3>
      <div class='grid grid-cols-[5rem_repeat(2,minmax(0,1fr))] items-center gap-2'>
        <ToneMatrixHead appearances={PANEL_APPEARANCES} />
        {TONES.map((tone) => (
          <>
            <ToneLabel key={tone} tone={tone} />
            {PANEL_APPEARANCES.map((appearance) => (
              <Alert key={`${tone}-${appearance}`} tone={tone} appearance={appearance}>
                <Alert.Title>{tone}</Alert.Title>
              </Alert>
            ))}
          </>
        ))}
      </div>
    </div>
  </CatalogSection>
);

const AvatarSection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <CatalogSection id='avatar' title='Avatar'>
    <Avatar size='lg'>
      <Avatar.Image src={paths.avatar} alt='Ada Lovelace' />
    </Avatar>
    <Avatar size='sm'>
      <Avatar.Fallback>AB</Avatar.Fallback>
    </Avatar>
    <Avatar size='md'>
      <Avatar.Fallback>CD</Avatar.Fallback>
    </Avatar>
    <Avatar size='lg'>
      <Avatar.Fallback>EF</Avatar.Fallback>
    </Avatar>
  </CatalogSection>
);

const BadgeSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='badge' title='Badge'>
    <CatalogPurpose
      page={page}
      id='badge'
      best="labelling a record's status or category"
      instead={[{ when: "offering a low-stakes or repeated action", id: "button" }]}
    />
    <Badge>Neutral</Badge>
    <Badge tone='primary' appearance='solid'>
      Primary
    </Badge>
    <Badge size='sm'>Small</Badge>
    <Badge tone='secondary' appearance='solid'>
      Secondary
    </Badge>
    <Badge appearance='outline'>Outline</Badge>
    <Badge tone='destructive'>Destructive</Badge>
    <Badge tone='info'>Info</Badge>
    <Badge tone='success'>Success</Badge>
    <Badge tone='warning'>Warning</Badge>
    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Tone × appearance</h3>
      <div class='grid grid-cols-[5rem_repeat(3,minmax(0,1fr))] items-center gap-2'>
        <ToneMatrixHead appearances={BADGE_APPEARANCES} />
        {TONES.map((tone) => (
          <>
            <ToneLabel key={tone} tone={tone} />
            {BADGE_APPEARANCES.map((appearance) => (
              <span key={`${tone}-${appearance}`}>
                <Badge tone={tone} appearance={appearance}>
                  {tone}
                </Badge>
              </span>
            ))}
          </>
        ))}
      </div>
    </div>
  </CatalogSection>
);

const ButtonSection: FC<{ icon: ShowIcon }> = ({ icon: Icon }) => (
  <CatalogSection id='button' title='Button'>
    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Tone × appearance</h3>
      <div class='grid grid-cols-[5rem_repeat(5,minmax(0,1fr))] items-center gap-2'>
        <ToneMatrixHead appearances={APPEARANCES} />
        {TONES.map((tone) => (
          <>
            <ToneLabel key={tone} tone={tone} />
            {APPEARANCES.map((appearance) => (
              <Button key={`${tone}-${appearance}`} tone={tone} appearance={appearance} size='sm'>
                {tone}
              </Button>
            ))}
          </>
        ))}
      </div>
    </div>

    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Size × appearance</h3>
      <div class='grid grid-cols-[5rem_repeat(5,minmax(0,1fr))] items-center gap-2'>
        <ToneMatrixHead appearances={APPEARANCES} />
        {BUTTON_SIZES.map((size) => (
          <>
            <MatrixLabel key={size}>{size}</MatrixLabel>
            {APPEARANCES.map((appearance) => (
              <Button key={`${size}-${appearance}`} appearance={appearance} size={size}>
                {size}
              </Button>
            ))}
          </>
        ))}
      </div>
    </div>

    {/* `square` is `aspect-square w-full`, so its cell is the width it reads from — the control width
        for its own size, not the column's. */}
    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Shape × size</h3>
      <div class='grid grid-cols-[5rem_repeat(3,minmax(0,1fr))] items-center gap-2'>
        <>
          <span />
          {BUTTON_SIZES.map((size) => (
            <MatrixLabel key={size}>{size}</MatrixLabel>
          ))}
        </>
        {BUTTON_SHAPES.map((shape) => (
          <>
            <MatrixLabel key={shape}>{shape}</MatrixLabel>
            {BUTTON_SIZES.map((size) =>
              shape === "default" ? (
                <Button key={`${shape}-${size}`} tone='neutral' appearance='outline' size={size}>
                  {size}
                </Button>
              ) : (
                <div key={`${shape}-${size}`} class={BUTTON_SHAPE_BOX[size]}>
                  <Button tone='neutral' appearance='outline' shape={shape} size={size} aria-label={`${shape} ${size}`}>
                    <Icon name='chevron-down' width={16} height={16} />
                  </Button>
                </div>
              ),
            )}
          </>
        ))}
      </div>
    </div>

    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>State × tone</h3>
      <div class='grid grid-cols-[5rem_repeat(3,minmax(0,1fr))] items-center gap-2'>
        <>
          <span />
          {STATE_TONES.map((tone) => (
            <MatrixLabel key={tone}>{tone}</MatrixLabel>
          ))}
        </>
        <MatrixLabel>resting</MatrixLabel>
        {STATE_TONES.map((tone) => (
          <Button key={`resting-${tone}`} tone={tone} size='md'>
            {tone}
          </Button>
        ))}
        <MatrixLabel>disabled</MatrixLabel>
        {STATE_TONES.map((tone) => (
          <Button key={`disabled-${tone}`} tone={tone} size='md' disabled>
            {tone}
          </Button>
        ))}
        <MatrixLabel>loading</MatrixLabel>
        {STATE_TONES.map((tone) => (
          <Button key={`loading-${tone}`} tone={tone} size='md' loading loadingIcon={Icon}>
            {tone}
          </Button>
        ))}
      </div>
    </div>
  </CatalogSection>
);

const CardSection: FC<{ icon: ShowIcon; page: string }> = ({ icon: Icon, page }) => (
  <CatalogSection id='card' title='Card'>
    <CatalogPurpose
      page={page}
      id='card'
      best='grouping content that has its own title and action'
      instead={[{ when: "the group has no title, description or action of its own", id: "separator" }]}
    />
    <Card class='w-64'>
      <Card.Header>
        <Card.Title>Card Title</Card.Title>
        <Card.Description>A short description of this card.</Card.Description>
        <Card.Action>
          <Button tone='neutral' appearance='ghost' shape='icon' size='sm' aria-label='Card options'>
            <Icon name='chevron-down' width={16} height={16} />
          </Button>
        </Card.Action>
      </Card.Header>
      <Card.Content>
        <p class='text-sm text-muted-foreground'>Card body content goes here.</p>
      </Card.Content>
      <Card.Footer>
        <Button size='sm'>Action</Button>
      </Card.Footer>
    </Card>
  </CatalogSection>
);

const FormFieldSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='form-field' title='FormField'>
    <div class='w-full max-w-xs space-y-4'>
      <FormField name='text-field'>
        <FormField.Label name='text-field'>Label</FormField.Label>
        <Input type='text' name='text-field' placeholder='Placeholder' field={{ name: "text-field", description: true }} />
        <FormField.Description name='text-field'>Helper text for this field.</FormField.Description>
      </FormField>
      <FormField name='error-field' invalid>
        <FormField.Label name='error-field'>Invalid Field</FormField.Label>
        <Input type='text' name='error-field' value='bad input' field={{ name: "error-field", invalid: true }} />
        <FormField.Error name='error-field'>This field has an error.</FormField.Error>
      </FormField>
      <FormField name='select-field'>
        <FormField.Label name='select-field'>Select</FormField.Label>
        <Select name='select-field' field={{ name: "select-field" }} icon={icon}>
          <Select.Option value=''>Choose…</Select.Option>
          <Select.Option value='a'>Option A</Select.Option>
          <Select.Option value='b'>Option B</Select.Option>
        </Select>
      </FormField>
      <FormField.Set>
        <FormField.Legend>Notifications</FormField.Legend>
        <FormField.Set>
          <FormField.Legend as='label'>Email</FormField.Legend>
          <FormField.Content>
            <FormField.Title>Frequency</FormField.Title>
            <Switch name='digest-weekly' checked>
              Weekly digest
            </Switch>
          </FormField.Content>
          <FormField.Separator>or</FormField.Separator>
          <FormField.Content>
            <FormField.Title>Silence</FormField.Title>
            <Switch name='digest-none'>No email at all</Switch>
          </FormField.Content>
        </FormField.Set>
      </FormField.Set>
    </div>
  </CatalogSection>
);

const IconSection: FC<{ icon: ShowIcon }> = ({ icon: Icon }) => (
  <CatalogSection id='icon' title='Icon'>
    <div class='flex items-center gap-4'>
      <Icon name='spinner' width={20} height={20} />
      <Icon name='chevron-down' width={20} height={20} />
      <Icon name='sun' width={20} height={20} />
      <Icon name='moon' width={20} height={20} />
      <Icon name='monitor' width={20} height={20} />
      <Icon name='hamburger' width={20} height={20} />
      <Icon name='close' width={20} height={20} />
      {/* An icon carrying its own meaning: `aria-label` swaps the default `aria-hidden` for `role="img"`. */}
      <Icon name='spinner' width={20} height={20} aria-label='Loading' />
    </div>
  </CatalogSection>
);

const InputSection: FC = () => (
  <CatalogSection id='input' title='Input'>
    <Input type='text' name='text-input' placeholder='Text input' class='max-w-xs' />
    <Input type='email' name='email-input' placeholder='Email input' class='max-w-xs' />
    <Input type='password' name='pw-input' placeholder='Password input' class='max-w-xs' />
    <Input type='text' name='disabled-input' placeholder='Disabled' disabled class='max-w-xs' />
    {/* The descriptor, not the raw attribute: `field` is what derives the id, the name and
        `aria-invalid` together, so the control and its label cannot disagree. */}
    <Input type='text' field={{ name: "invalid-input", invalid: true }} placeholder='Invalid' class='max-w-xs' />
    <Input type='text' name='readonly-input' value='Read only' readonly class='max-w-xs' />
    <Input type='text' name='required-input' placeholder='Required' required class='max-w-xs' />
    {/* Tier 0 and Tier 1 carry the affordances — `inputmode`, `autocomplete`, `maxlength`, and
        `tabular-nums` as a caller class. `format` only regroups the value on blur, and the `value`
        here arrives already grouped from the server. */}
    <Input
      type='text'
      inputmode='numeric'
      autocomplete='cc-number'
      maxlength={19}
      name='card-input'
      format='#### #### #### ####'
      value='4111111111111111'
      placeholder='Card number'
      class='max-w-xs tabular-nums'
    />
  </CatalogSection>
);

const LabelSection: FC = () => (
  <CatalogSection id='label' title='Label'>
    {/* A plain wrapper, so the band keeps a pair on one wrap line: the section demonstrates `Label`'s
        own `for`/`required` API, which `Field`'s span and `FormField`'s fieldset would both replace. */}
    <div class='space-y-2'>
      <Label for='demo-label-input'>Standalone Label</Label>
      <Input id='demo-label-input' type='text' name='demo-label' placeholder='Paired input' class='max-w-xs' />
    </div>
    <div class='space-y-2'>
      <Label for='demo-label-required-input' required>
        Required Label
      </Label>
      <Input id='demo-label-required-input' type='text' name='demo-label-required' placeholder='Required input' class='max-w-xs' />
    </div>
  </CatalogSection>
);

const ProgressSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='progress' title='Progress'>
    <CatalogPurpose
      page={page}
      id='progress'
      best='showing how far a task has run'
      instead={[{ when: "the value sits within a known range instead", id: "meter" }]}
    />
    <div class='w-full max-w-sm space-y-3'>
      <Progress value={0} max={100} />
      <Progress value={33} max={100} />
      <Progress value={66} max={100} />
      <Progress value={100} max={100} />
    </div>
    <div class='flex h-40 items-stretch gap-4'>
      <Progress value={25} max={100} orientation='vertical' label='Vertical, 25%' />
      <Progress value={75} max={100} orientation='vertical' label='Vertical, 75%' />
    </div>
  </CatalogSection>
);

const SeparatorSection: FC = () => (
  <CatalogSection id='separator' title='Separator'>
    <div class='w-full max-w-sm space-y-3'>
      <p class='text-sm text-muted-foreground'>Above</p>
      <Separator />
      <p class='text-sm text-muted-foreground'>Below</p>
    </div>
    <div class='flex h-10 items-center gap-3 text-sm text-muted-foreground'>
      <span>Left</span>
      <Separator orientation='vertical' />
      <span>Right</span>
    </div>
  </CatalogSection>
);

const BreadcrumbsSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='breadcrumbs' title='Breadcrumbs'>
    <Breadcrumbs>
      <Breadcrumbs.Item>
        <Breadcrumbs.Link href='#breadcrumbs'>Projects</Breadcrumbs.Link>
      </Breadcrumbs.Item>
      <Breadcrumbs.Separator icon={icon} />
      <Breadcrumbs.Item>
        <Breadcrumbs.Link href='#breadcrumbs'>Forge</Breadcrumbs.Link>
      </Breadcrumbs.Item>
      <Breadcrumbs.Separator icon={icon} />
      <Breadcrumbs.Item current>Settings</Breadcrumbs.Item>
    </Breadcrumbs>
  </CatalogSection>
);

const DrawerSection: FC = () => (
  <CatalogSection id='drawer' title='Drawer'>
    {(["left", "right", "top", "bottom"] as const).map((side) => (
      <div key={side}>
        <Drawer.Trigger for={`show-drawer-${side}`}>Open {side}</Drawer.Trigger>
        <Drawer id={`show-drawer-${side}`} side={side}>
          <Drawer.Header>
            <Drawer.Title for={`show-drawer-${side}`}>From the {side}</Drawer.Title>
          </Drawer.Header>
          <Drawer.Content>
            <p class='text-sm text-muted-foreground'>A native dialog anchored to one edge; Escape and the backdrop close it.</p>
          </Drawer.Content>
          <Drawer.Footer>
            <Drawer.Close for={`show-drawer-${side}`}>Close</Drawer.Close>
          </Drawer.Footer>
        </Drawer>
      </div>
    ))}
  </CatalogSection>
);

const EmptyStateSection: FC = () => (
  <CatalogSection id='empty-state' title='EmptyState'>
    <EmptyState class='w-full max-w-md'>
      <EmptyState.Figure>
        <Status label='Nothing yet' size='lg' />
      </EmptyState.Figure>
      <EmptyState.Title>No projects yet</EmptyState.Title>
      <EmptyState.Description>Create a project to see it listed here, or import one from an existing repository.</EmptyState.Description>
      <EmptyState.Actions>
        <Button size='sm'>New project</Button>
        <Button tone='neutral' appearance='outline' size='sm'>
          Import
        </Button>
      </EmptyState.Actions>
    </EmptyState>
  </CatalogSection>
);

const FileInputSection: FC<{ icon: ShowIcon }> = ({ icon: Icon }) => (
  <CatalogSection id='file-input' title='FileInput'>
    <FileInput name='show-file' class='max-w-xs' />
    <FileInput name='show-file-lg' size='lg' class='max-w-xs' />
    <FileInput name='show-file-invalid' invalid class='max-w-xs' />
    {/* `FileInput` takes no children and `FILE_INPUT_BASE` styles the native `::file-selector-button`,
        so a glyph inside the box is a composition over it — the shape `Select` already uses — and not
        an adornment slot on the component. */}
    <div class='relative max-w-xs'>
      <FileInput name='show-file-icon' class='pe-10' />
      <span aria-hidden='true' class='pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground'>
        <Icon name='upload' width={16} height={16} />
      </span>
    </div>
    {/* The shared edge on a control that is not a button: the end cap and the field are one shape. */}
    <Join>
      <Button tone='neutral' appearance='outline' shape='icon' aria-label='Choose a file to upload'>
        <Icon name='upload' width={16} height={16} />
      </Button>
      <FileInput name='show-file-join' class='w-56' />
    </Join>
  </CatalogSection>
);

const FilterSection: FC = () => (
  <CatalogSection id='filter' title='Filter'>
    <Filter aria-label='Category'>
      <Filter.Reset />
      <Filter.Item name='show-filter' value='all' checked>
        All
      </Filter.Item>
      <Filter.Item name='show-filter' value='open'>
        Open
      </Filter.Item>
      <Filter.Item name='show-filter' value='closed'>
        Closed
      </Filter.Item>
    </Filter>
    <form method='get' action='#filter' class='flex flex-wrap items-center gap-4'>
      <Filter nested aria-label='Priority'>
        <Filter.Reset size='md' />
        <Filter.Item name='show-filter-priority' value='high' size='md' appearance='soft'>
          High
        </Filter.Item>
        <Filter.Item name='show-filter-priority' value='low' size='md' appearance='soft'>
          Low
        </Filter.Item>
      </Filter>
      <Button type='submit' tone='neutral' appearance='outline' size='md'>
        Apply
      </Button>
    </form>
  </CatalogSection>
);

const OtpInputSection: FC = () => (
  <CatalogSection id='otp-input' title='OtpInput'>
    <FormField name='show-otp'>
      <FormField.Label>Verification code</FormField.Label>
      <FormField.Content>
        <OtpInput field={{ name: "show-otp" }} />
      </FormField.Content>
    </FormField>
    <FormField name='show-otp-pin'>
      <FormField.Label>PIN</FormField.Label>
      <FormField.Content>
        <OtpInput field={{ name: "show-otp-pin" }} length={4} size='lg' value='1234' />
      </FormField.Content>
    </FormField>
    <FormField name='show-otp-invalid' invalid>
      <FormField.Label>Code</FormField.Label>
      <FormField.Content>
        <OtpInput field={{ name: "show-otp-invalid", invalid: true }} value='000000' />
        <FormField.Error>That code has expired.</FormField.Error>
      </FormField.Content>
    </FormField>
  </CatalogSection>
);

const IndicatorSection: FC = () => (
  <CatalogSection id='indicator' title='Indicator'>
    <Indicator>
      <Button tone='neutral' appearance='outline'>
        Inbox
      </Button>
      <Indicator.Item>
        <Badge tone='destructive' appearance='solid' size='sm'>
          3
        </Badge>
      </Indicator.Item>
    </Indicator>
    <Indicator>
      <Avatar size='md'>
        <Avatar.Fallback>JD</Avatar.Fallback>
      </Avatar>
      <Indicator.Item placement='bottom-start'>
        <Status label='Online' tone='success' />
      </Indicator.Item>
    </Indicator>
  </CatalogSection>
);

const JoinSection: FC = () => (
  <CatalogSection id='join' title='Join'>
    <Join>
      <Input name='show-join-q' placeholder='Search…' class='w-56' />
      <Button tone='neutral' appearance='outline'>
        Go
      </Button>
    </Join>
    <Join orientation='vertical'>
      <Button tone='neutral' appearance='outline'>
        Day
      </Button>
      <Button tone='neutral' appearance='outline'>
        Week
      </Button>
      <Button tone='neutral' appearance='outline'>
        Month
      </Button>
    </Join>
  </CatalogSection>
);

const KbdSection: FC = () => (
  <CatalogSection id='kbd' title='Kbd'>
    <Kbd size='sm'>Esc</Kbd>
    <Kbd>⌘</Kbd>
    <Kbd>K</Kbd>
    <Kbd size='lg'>Enter</Kbd>
  </CatalogSection>
);

const LinkSection: FC = () => (
  <CatalogSection id='link' title='Link'>
    <Link href='#link'>Underlined</Link>
    <Link href='#link' decoration='hover'>
      Underline on hover
    </Link>
    <Link href='#link' decoration='plain' tone='neutral'>
      Plain
    </Link>
    <Link href='#link' tone='destructive'>
      Destructive
    </Link>
  </CatalogSection>
);

const PaginationSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='pagination' title='Pagination'>
    <Pagination>
      <Pagination.Previous href='#pagination' icon={icon} label='Previous page'>
        Previous
      </Pagination.Previous>
      <Pagination.Item href='#pagination'>1</Pagination.Item>
      <Pagination.Item href='#pagination' current>
        2
      </Pagination.Item>
      <Pagination.Item href='#pagination'>3</Pagination.Item>
      <Pagination.Ellipsis />
      <Pagination.Item href='#pagination'>12</Pagination.Item>
      <Pagination.Next href='#pagination' icon={icon} label='Next page'>
        Next
      </Pagination.Next>
    </Pagination>
  </CatalogSection>
);

const StatSection: FC = () => (
  <CatalogSection id='stat' title='Stat'>
    <Stat class='w-48'>
      <Stat.Label>Requests</Stat.Label>
      <Stat.Value>12,480</Stat.Value>
      <Stat.Description>Last 24 hours</Stat.Description>
    </Stat>
    <Stat class='w-48'>
      <Stat.Figure>
        <Status label='Healthy' tone='success' size='lg' />
      </Stat.Figure>
      <Stat.Label>Uptime</Stat.Label>
      <Stat.Value>99.98%</Stat.Value>
      <Stat.Actions>
        <Button tone='neutral' appearance='ghost' size='sm'>
          Details
        </Button>
      </Stat.Actions>
    </Stat>
  </CatalogSection>
);

const StatusSection: FC = () => (
  <CatalogSection id='status' title='Status'>
    <Status label='Neutral' />
    <Status label='Online' tone='success' />
    <Status label='Degraded' tone='warning' />
    <Status label='Down' tone='destructive' size='lg' />
    <Status label='Info' tone='info' size='sm' />
  </CatalogSection>
);

const StepsSection: FC = () => (
  <CatalogSection id='steps' title='Steps'>
    <Steps>
      <Steps.Step state='complete' marker='1'>
        Account
      </Steps.Step>
      <Steps.Step state='current' marker='2'>
        Profile
      </Steps.Step>
      <Steps.Step marker='3'>Review</Steps.Step>
    </Steps>
    <Steps orientation='vertical' tone='success'>
      <Steps.Step state='complete' marker='✓'>
        Uploaded
      </Steps.Step>
      <Steps.Step state='current' marker='2'>
        Processing
      </Steps.Step>
      <Steps.Step marker='3'>Published</Steps.Step>
    </Steps>
  </CatalogSection>
);

const TimelineSection: FC = () => (
  <CatalogSection id='timeline' title='Timeline'>
    <Timeline>
      <Timeline.Item state='complete' marker='1'>
        <Timeline.Time datetime='2026-09-01'>1 Sep</Timeline.Time>
        <Timeline.Content>Request opened</Timeline.Content>
      </Timeline.Item>
      <Timeline.Item state='current' marker='2'>
        <Timeline.Time datetime='2026-09-04'>4 Sep</Timeline.Time>
        <Timeline.Content>Under review</Timeline.Content>
      </Timeline.Item>
      <Timeline.Item marker='3'>
        <Timeline.Content>Merged</Timeline.Content>
      </Timeline.Item>
    </Timeline>
    <Timeline orientation='horizontal' tone='success'>
      <Timeline.Item state='complete' marker='✓'>
        <Timeline.Time datetime='2026-09-01'>1 Sep</Timeline.Time>
        <Timeline.Content>Built</Timeline.Content>
      </Timeline.Item>
      <Timeline.Item state='complete' marker='✓'>
        <Timeline.Time datetime='2026-09-02'>2 Sep</Timeline.Time>
        <Timeline.Content>Tested</Timeline.Content>
      </Timeline.Item>
      <Timeline.Item state='current' marker='3'>
        <Timeline.Time datetime='2026-09-04'>4 Sep</Timeline.Time>
        <Timeline.Content>Releasing</Timeline.Content>
      </Timeline.Item>
    </Timeline>
  </CatalogSection>
);

const CAROUSEL_SLIDES = ["Alpha", "Beta", "Gamma"];

// A dot is a fragment link, so the document scrolls too: the offset is `CatalogSection`'s own
// `scroll-mt-24` plus the heading block above the slide, landing a dot where `#carousel` lands.
const CarouselSlide: FC<{ id: string; title: string; snap?: "start" | "center" }> = ({ id, title, snap }) => (
  <Carousel.Item id={id} label={title} class='scroll-mt-36' {...(snap ? { snap } : {})}>
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>One slide of a same-kind set.</Card.Description>
      </Card.Header>
      <Card.Content>
        <p class='text-sm text-muted-foreground'>The platform scrolls; each dot below is an anchor to a slide.</p>
      </Card.Content>
    </Card>
  </Carousel.Item>
);

const CarouselSection: FC = () => (
  <CatalogSection id='carousel' title='Carousel'>
    <Resumable name={SHOW_SCOPES.carousel} class='w-full max-w-md'>
      <Carousel label='Start-snapping slides'>
        {CAROUSEL_SLIDES.map((title, index) => (
          <CarouselSlide id={`show-carousel-${index + 1}`} title={title} />
        ))}
      </Carousel>
      <Carousel.Dots ids={CAROUSEL_SLIDES.map((_, index) => `show-carousel-${index + 1}`)} />
    </Resumable>
    <Resumable name={SHOW_SCOPES.carousel} class='w-full max-w-md'>
      <Carousel snap='center' label='Centre-snapping slides'>
        {CAROUSEL_SLIDES.map((title, index) => (
          <CarouselSlide id={`show-carousel-center-${index + 1}`} title={title} snap='center' />
        ))}
      </Carousel>
      <Carousel.Dots ids={CAROUSEL_SLIDES.map((_, index) => `show-carousel-center-${index + 1}`)} label='Centred slides' />
    </Resumable>
  </CatalogSection>
);

const TABLE_ROWS = [
  ["Alert", "Feedback", "soft"],
  ["Badge", "Primitives", "soft"],
  ["Button", "Primitives", "solid"],
] as const;

const TableSection: FC = () => (
  <CatalogSection id='table' title='Table'>
    <Table size='sm' zebra pinRows class='max-w-md'>
      <Table.Caption>Three components and their default appearance</Table.Caption>
      <Table.Header>
        <Table.Row>
          <Table.Head>Component</Table.Head>
          <Table.Head>Group</Table.Head>
          <Table.Head>Appearance</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {TABLE_ROWS.map(([name, group, appearance], i) => (
          <Table.Row key={name} selected={i === 1}>
            <Table.Cell>{name}</Table.Cell>
            <Table.Cell>{group}</Table.Cell>
            <Table.Cell>{appearance}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
    <Table size='lg' class='max-w-xs'>
      <Table.Body>
        <Table.Row tone='warning'>
          <Table.Cell>Pending</Table.Cell>
          <Table.Cell>2</Table.Cell>
        </Table.Row>
        <Table.Row>
          <Table.Cell>Done</Table.Cell>
          <Table.Cell>7</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table>
  </CatalogSection>
);

const SkeletonSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='skeleton' title='Skeleton'>
    <CatalogPurpose
      page={page}
      id='skeleton'
      best='showing a value that is loading'
      instead={[{ when: "the shape is not knowable", id: "spinner" }]}
    />
    <div class='w-full max-w-sm space-y-2'>
      <Skeleton class='h-4 w-3/4' />
      <Skeleton class='h-4 w-full' />
      <Skeleton class='h-4 w-1/2' />
    </div>
  </CatalogSection>
);

const SpinnerSection: FC<{ icon: ShowIcon; page: string }> = ({ icon, page }) => (
  <CatalogSection id='spinner' title='Spinner'>
    <CatalogPurpose
      page={page}
      id='spinner'
      best='showing an action in flight with no known shape'
      instead={[{ when: "the slot's shape is known", id: "skeleton" }]}
    />
    <Spinner icon={icon} size='sm' />
    <Spinner icon={icon} size='md' />
    <Spinner icon={icon} size='lg' label='Fetching results…' />
  </CatalogSection>
);

const StackSection: FC = () => (
  <CatalogSection id='stack' title='Stack'>
    <Stack class='w-40'>
      <Card>
        <Card.Content>Top of the pile</Card.Content>
      </Card>
      <Card>
        <Card.Content>Second</Card.Content>
      </Card>
      <Card>
        <Card.Content>Third</Card.Content>
      </Card>
    </Stack>
    <Stack placement='top' class='w-40'>
      <Card>
        <Card.Content>Fans upward</Card.Content>
      </Card>
      <Card>
        <Card.Content>Second</Card.Content>
      </Card>
    </Stack>
    <Stack placement='start' class='w-40'>
      <Card>
        <Card.Content>Fans to the start</Card.Content>
      </Card>
      <Card>
        <Card.Content>Second</Card.Content>
      </Card>
    </Stack>
  </CatalogSection>
);

const TextareaSection: FC = () => (
  <CatalogSection id='textarea' title='Textarea'>
    <Textarea name='demo-textarea' placeholder='Write something…' rows={3} class='max-w-sm' />
    <Textarea name='disabled-textarea' placeholder='Disabled' disabled rows={3} class='max-w-sm' />
    <Textarea field={{ name: "invalid-textarea", invalid: true }} placeholder='Invalid' rows={3} class='max-w-sm' />
    <Textarea name='readonly-textarea' readonly rows={3} class='max-w-sm'>
      Read only
    </Textarea>
    <Textarea name='required-textarea' placeholder='Required' required rows={3} class='max-w-sm' />
  </CatalogSection>
);

/** Enough rows to overflow the viewport, which is the only way to see that it scrolls. */
const SCROLL_ROWS = ["Alert", "Avatar", "Badge", "Button", "Card", "Dialog", "Field", "Form", "Icon", "Input", "Label", "Menu", "Meter"];

const CheckboxGroupSection: FC = () => (
  <CatalogSection id='checkbox-group' title='CheckboxGroup'>
    <CheckboxGroup name='toppings' orientation='horizontal' description>
      <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
      <CheckboxGroup.Description name='toppings'>Pick as many as you like.</CheckboxGroup.Description>
      <CheckboxGroup.Item name='toppings' value='cheese' checked>
        Cheese
      </CheckboxGroup.Item>
      <CheckboxGroup.Item name='toppings' value='basil'>
        Basil
      </CheckboxGroup.Item>
      <CheckboxGroup.Item name='toppings' value='chilli' disabled>
        Chilli
      </CheckboxGroup.Item>
    </CheckboxGroup>
    <CheckboxGroup name='alerts' orientation='vertical'>
      <CheckboxGroup.Label>Alerts</CheckboxGroup.Label>
      <CheckboxGroup.Item name='alerts' value='deploys' checked>
        Deploys
      </CheckboxGroup.Item>
      <CheckboxGroup.Item name='alerts' value='errors'>
        Errors
      </CheckboxGroup.Item>
      <CheckboxGroup.Item name='alerts' value='digest'>
        Weekly digest
      </CheckboxGroup.Item>
    </CheckboxGroup>
  </CatalogSection>
);

const RadioGroupSection: FC = () => (
  <CatalogSection id='radio-group' title='RadioGroup'>
    <RadioGroup name='plan' orientation='horizontal'>
      <RadioGroup.Label>Plan</RadioGroup.Label>
      <RadioGroup.Item name='plan' value='free' checked>
        Free
      </RadioGroup.Item>
      <RadioGroup.Item name='plan' value='pro'>
        Pro
      </RadioGroup.Item>
    </RadioGroup>
    <RadioGroup name='billing' orientation='vertical'>
      <RadioGroup.Label>Billing period</RadioGroup.Label>
      <RadioGroup.Item name='billing' value='monthly' checked>
        Monthly
      </RadioGroup.Item>
      <RadioGroup.Item name='billing' value='yearly'>
        Yearly
      </RadioGroup.Item>
      <RadioGroup.Item name='billing' value='lifetime'>
        Lifetime
      </RadioGroup.Item>
    </RadioGroup>
  </CatalogSection>
);

const MeterSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='meter' title='Meter'>
    <CatalogPurpose
      page={page}
      id='meter'
      best='showing a measurement within a known range'
      instead={[{ when: "something is progressing towards done", id: "progress" }]}
    />
    <Meter>
      <Meter.Label for='show-meter-disk'>Disk usage</Meter.Label>
      <Meter.Track id='show-meter-disk' value={0.72} low={0.3} high={0.8} optimum={0.2} />
      <Meter.Value>72% of 500 GB</Meter.Value>
    </Meter>
    {/* No thresholds at all: the bare track, which is what a plain quantity looks like. */}
    <Meter>
      <Meter.Label for='show-meter-bare'>Battery</Meter.Label>
      <Meter.Track id='show-meter-bare' value={0.41} />
      <Meter.Value>41%</Meter.Value>
    </Meter>
    <Meter>
      <Meter.Label for='show-meter-over'>Quota</Meter.Label>
      <Meter.Track id='show-meter-over' value={0.94} low={0.3} high={0.8} optimum={0.2} />
      <Meter.Value>94% — over the high threshold</Meter.Value>
    </Meter>
  </CatalogSection>
);

const NumberFieldSection: FC = () => (
  <CatalogSection id='number-field' title='NumberField'>
    <NumberField>
      <NumberField.Decrement />
      <NumberField.Input name='show-count' value='1' min='0' max='10' />
      <NumberField.Increment />
    </NumberField>
    {/* `step` and a stepper `label` are both the caller's: the steppers name what they move, which
        "Increment" alone does not when two fields sit side by side. */}
    <NumberField>
      <NumberField.Decrement label='Decrease quantity' />
      <NumberField.Input name='show-quantity' value='10' min='0' max='100' step='5' />
      <NumberField.Increment label='Increase quantity' />
    </NumberField>
    <NumberField>
      <NumberField.Decrement disabled />
      <NumberField.Input name='show-locked' value='3' min='0' max='10' disabled />
      <NumberField.Increment disabled />
    </NumberField>
  </CatalogSection>
);

const ScrollAreaSection: FC = () => (
  <CatalogSection id='scroll-area' title='ScrollArea'>
    <ScrollArea class='h-40 w-64 rounded-md border border-border'>
      <ScrollArea.Viewport label='Vertical sample rows' class='p-3'>
        <div class='space-y-2 text-sm text-muted-foreground'>
          {SCROLL_ROWS.map((row) => (
            <p key={row}>{row}</p>
          ))}
        </div>
      </ScrollArea.Viewport>
    </ScrollArea>
    <ScrollArea orientation='horizontal' class='w-64 rounded-md border border-border'>
      <ScrollArea.Viewport label='Horizontal sample rows' class='p-3'>
        <div class='flex w-max gap-2'>
          {SCROLL_ROWS.map((row) => (
            <span key={row} class='shrink-0 rounded-md border border-border px-2 py-1 text-sm text-muted-foreground'>
              {row}
            </span>
          ))}
        </div>
      </ScrollArea.Viewport>
    </ScrollArea>
  </CatalogSection>
);

const ToggleSection: FC = () => (
  <CatalogSection id='toggle' title='Toggle'>
    <Toggle>Bold</Toggle>
    <Toggle pressed>Italic</Toggle>
    <Toggle disabled>Underline</Toggle>
  </CatalogSection>
);

const AccordionSection: FC<{ icon: ShowIcon; page: string }> = ({ icon, page }) => {
  return (
    <CatalogSection id='accordion' title='Accordion'>
      <CatalogPurpose
        page={page}
        id='accordion'
        best='letting several independent sections expand'
        instead={[
          { when: "showing one of several peer views in one region", id: "tabs" },
          { when: "hiding one optional block behind a disclosure", id: "collapsible" },
        ]}
      />
      <Accordion class='w-full max-w-md gap-2'>
        <Accordion.Item open>
          <Accordion.Trigger icon={icon}>What is a resumable scope?</Accordion.Trigger>
          <Accordion.Content>A server-stamped region whose state is rehydrated on the first interaction inside it.</Accordion.Content>
        </Accordion.Item>
        <Accordion.Item>
          <Accordion.Trigger icon={icon}>Why native disclosure?</Accordion.Trigger>
          <Accordion.Content hint='No JavaScript required'>
            Open and closed belong to the platform; the controller only publishes them for CSS to react to.
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
      {/* A shared `name` is what makes a native disclosure group exclusive — opening one closes the
          others, with no controller involved at all. */}
      <Accordion class='w-full max-w-md gap-2'>
        <Accordion.Item name='exclusive-demo' open>
          <Accordion.Trigger icon={icon}>Exclusive: first</Accordion.Trigger>
          <Accordion.Content>Opening a sibling closes this one, because they share a name.</Accordion.Content>
        </Accordion.Item>
        <Accordion.Item name='exclusive-demo'>
          <Accordion.Trigger icon={icon}>Exclusive: second</Accordion.Trigger>
          <Accordion.Content>The platform enforces it — this is the `name` attribute on `&lt;details&gt;`.</Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </CatalogSection>
  );
};

const DialogSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='dialog' title='Dialog'>
    <CatalogPurpose
      page={page}
      id='dialog'
      best='interrupting for a decision that blocks the task'
      instead={[
        { when: "showing secondary controls anchored to a trigger", id: "popover" },
        { when: "hiding one optional block behind a disclosure", id: "collapsible" },
      ]}
    />
    <Dialog.Trigger for='show-dialog' class='rounded-md border border-border px-3 py-1.5 text-sm'>
      Open dialog
    </Dialog.Trigger>
    <Dialog id='show-dialog' class='max-w-sm'>
      <Dialog.Header>
        <Dialog.Title for='show-dialog' class='text-foreground'>
          A native modal
        </Dialog.Title>
        <Dialog.Close for='show-dialog' aria-label='Close dialog' class='size-8 rounded p-1 text-muted-foreground'>
          ×
        </Dialog.Close>
      </Dialog.Header>
      <Dialog.Content>
        <p class='text-sm text-pretty text-muted-foreground'>
          Opened and closed by Invoker commands — the top layer, the backdrop and Escape are the platform's.
        </p>
      </Dialog.Content>
      <Dialog.Footer class='justify-end'>
        <Dialog.Close for='show-dialog' class='rounded-md border border-border px-3 py-1.5 text-sm'>
          Close
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog>
    {/* `open` is the platform's non-modal spelling — no backdrop, no top layer, the page stays live —
        which is why it sits in the band rather than over the catalog. */}
    <Dialog id='show-dialog-inline' open class='max-w-sm'>
      <Dialog.Header>
        <Dialog.Title for='show-dialog-inline' class='text-foreground'>
          Open and non-modal
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Content>
        <p class='text-sm text-pretty text-muted-foreground'>
          The close below runs <code>request-close</code>, the cancelable algorithm — a <code>cancel</code> listener can keep it open, which plain{" "}
          <code>close</code> cannot.
        </p>
      </Dialog.Content>
      <Dialog.Footer class='justify-end'>
        <Dialog.Close for='show-dialog-inline' request class='rounded-md border border-border px-3 py-1.5 text-sm'>
          Request close
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog>
  </CatalogSection>
);

const PopoverSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='popover' title='Popover'>
    <CatalogPurpose
      page={page}
      id='popover'
      best='showing secondary controls anchored to a trigger'
      instead={[
        { when: "interrupting for a decision that blocks the task", id: "dialog" },
        { when: "offering a list of commands from a trigger", id: "menu" },
      ]}
    />
    {/* A row of its own with a gutter above it: `side=top` opens over whatever sits directly above the
        trigger, and the band's note is what that would be. */}
    <div class='mt-6 flex w-full flex-wrap items-start justify-between gap-4'>
      <Popover>
        <Popover.Trigger for='show-popover' class='rounded-md border border-border px-3 py-1.5 text-sm'>
          Details
        </Popover.Trigger>
        <Popover.Content id='show-popover' class='p-3 text-sm text-muted-foreground'>
          An anchored surface with light-dismiss, and no JavaScript to open it.
        </Popover.Content>
      </Popover>
      <Popover>
        <Popover.Trigger for='show-popover-top' class='rounded-md border border-border px-3 py-1.5 text-sm'>
          side=top
        </Popover.Trigger>
        <Popover.Content id='show-popover-top' side='top' class='p-3 text-sm text-muted-foreground'>
          Opens above the trigger instead of below it.
        </Popover.Content>
      </Popover>
      <Popover>
        <Popover.Trigger for='show-popover-center' class='rounded-md border border-border px-3 py-1.5 text-sm'>
          align=center
        </Popover.Trigger>
        <Popover.Content id='show-popover-center' align='center' class='p-3 text-sm text-muted-foreground'>
          Centred on the trigger along the bottom side.
        </Popover.Content>
      </Popover>
      <Popover>
        <Popover.Trigger for='show-popover-end' class='rounded-md border border-border px-3 py-1.5 text-sm'>
          align=end
        </Popover.Trigger>
        <Popover.Content id='show-popover-end' align='end' class='p-3 text-sm text-muted-foreground'>
          Right edges aligned, so it grows leftward.
        </Popover.Content>
      </Popover>
    </div>
  </CatalogSection>
);

const SelectSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='select' title='Select'>
    <Select name='show-select' class='max-w-xs' icon={icon} aria-label='Units'>
      <Select.Option value=''>Choose…</Select.Option>
      <Select.Option value='mm'>Millimetres</Select.Option>
      <Select.Option value='in'>Inches</Select.Option>
    </Select>
    <Select name='show-select-disabled' class='max-w-xs' icon={icon} aria-label='Units (disabled)' disabled>
      <Select.Option value='mm'>Disabled</Select.Option>
    </Select>
    <Select name='show-select-groups' class='max-w-xs' icon={icon} aria-label='Units'>
      <Select.OptGroup label='Metric'>
        <Select.Option value='mm'>Millimetres</Select.Option>
        <Select.Option value='cm'>Centimetres</Select.Option>
      </Select.OptGroup>
      <Select.OptGroup label='Imperial'>
        <Select.Option value='in'>Inches</Select.Option>
        <Select.Option value='ft'>Feet</Select.Option>
      </Select.OptGroup>
    </Select>
  </CatalogSection>
);

const SliderSection: FC = () => (
  <CatalogSection id='slider' title='Slider'>
    <div class='w-full max-w-xs space-y-4'>
      <Slider name='show-slider' min={0} max={100} value={40} />
      <Slider name='show-slider-output' min={0} max={100} value={70} output />
      <Slider name='show-slider-disabled' min={0} max={100} value={20} disabled />
    </div>
    <Slider name='show-slider-vertical' min={0} max={100} value={60} orientation='vertical' />
  </CatalogSection>
);

const SwitchSection: FC = () => (
  <CatalogSection id='switch' title='Switch'>
    <Switch name='show-switch'>Snap to grid</Switch>
    <Switch name='show-switch-on' checked>
      Show rulers
    </Switch>
    <Switch name='show-switch-before' labelPlacement='before'>
      Label first
    </Switch>
    <Switch name='show-switch-disabled' disabled>
      Disabled
    </Switch>
  </CatalogSection>
);

const FormSection: FC = () => (
  <CatalogSection id='form' title='Form'>
    <Form action='#' method='post' csrfToken='demo-token' class='w-full max-w-xs space-y-3'>
      <Honeypot field='company' />
      <Field label='Project name'>
        <Input type='text' name='project' placeholder='Untitled' />
      </Field>
      <Button type='submit'>Save</Button>
    </Form>
    {/* A `get` form carries no CSRF field: the token guards state change, and a search does none. */}
    <Form action='#' method='get' class='w-full max-w-xs space-y-3'>
      <Field label='Search'>
        <Input type='search' name='q' placeholder='Anything' />
      </Field>
      <Button type='submit'>Search</Button>
    </Form>
    <Form action='#' method='post' csrfToken='demo-token' csrfField='_token' class='w-full max-w-xs space-y-3'>
      <Field label='Renamed CSRF field'>
        <Input type='text' name='note' placeholder='The hidden field is `_token`' />
      </Field>
      <Button type='submit'>Save</Button>
    </Form>
  </CatalogSection>
);

const HoneypotSection: FC = () => (
  <CatalogSection id='honeypot' title='Honeypot'>
    <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
      <Honeypot />
      <Input type='email' name='newsletter-email' placeholder='you@example.com' />
      <Button type='submit'>Subscribe</Button>
    </Form>
    {/* The decoy's name is the whole of its disguise, so it is the caller's to pick. */}
    <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
      <Honeypot field='company-website' />
      <Input type='email' name='waitlist-email' placeholder='you@example.com' />
      <Button type='submit'>Join the waitlist</Button>
    </Form>
  </CatalogSection>
);

/** `Field` is the unlabelled-stack layout; `FormField` below is the descriptor-driven one. */
const FieldStackSection: FC = () => (
  <CatalogSection id='field' title='Field'>
    <div class='w-full max-w-xs space-y-4'>
      <Field label='Vertical'>
        <Input type='text' name='stack-vertical' placeholder='Stacked above' />
      </Field>
      <Field label='Horizontal' orientation='horizontal'>
        <Switch name='stack-horizontal' />
      </Field>
    </div>
  </CatalogSection>
);

const ToolbarSection: FC = () => (
  <CatalogSection id='toolbar' title='Toolbar'>
    <Toolbar aria-label='Formatting'>
      <Toolbar.Button pressed>Bold</Toolbar.Button>
      <Toolbar.Button pressed={false}>Italic</Toolbar.Button>
      <Toolbar.Button tone='neutral' appearance='outline' shape='icon' aria-label='Underline'>
        U
      </Toolbar.Button>
      <Toolbar.Separator />
      <Toolbar.Group aria-label='Search'>
        <Toolbar.Input placeholder='Find' />
      </Toolbar.Group>
      <Toolbar.Separator />
      <Toolbar.Link href='#toolbar'>Help</Toolbar.Link>
      <Toolbar.Button asChild>
        <a href='#toolbar'>Docs</a>
      </Toolbar.Button>
    </Toolbar>
    <Toolbar orientation='vertical' aria-label='Formatting (vertical)'>
      <Toolbar.Button pressed>Bold</Toolbar.Button>
      <Toolbar.Button pressed={false}>Italic</Toolbar.Button>
      <Toolbar.Separator orientation='horizontal' />
      <Toolbar.Link href='#toolbar'>Help</Toolbar.Link>
    </Toolbar>
    <CatalogNote>
      <code>Toolbar.Link</code> renders forge's own anchor; <code>Toolbar.Button asChild</code> takes the caller's anchor and lends it the toolbar
      item's styling and roving-focus wiring.
    </CatalogNote>
  </CatalogSection>
);

const MenuSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='menu' title='Menu'>
    <CatalogPurpose
      page={page}
      id='menu'
      best='offering a list of commands from a trigger'
      instead={[{ when: "showing secondary controls anchored to a trigger", id: "popover" }]}
    />
    <Menu>
      <Menu.Trigger for='show-file-menu' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        File
      </Menu.Trigger>
      <Menu.Popup id='show-file-menu'>
        <Menu.Group aria-labelledby='show-menu-group-label'>
          <Menu.GroupLabel id='show-menu-group-label'>Document</Menu.GroupLabel>
          <Menu.Item for='show-file-menu'>New</Menu.Item>
          <Menu.Item for='show-file-menu'>Open</Menu.Item>
          <Menu.Item for='show-file-menu' disabled>
            Save
          </Menu.Item>
        </Menu.Group>
        <Menu.Separator />
        <Menu.CheckboxItem for={false} checked>
          Autosave
        </Menu.CheckboxItem>
        <Menu.RadioItem for={false}>Compact view</Menu.RadioItem>
        <Menu.Separator />
        <Menu.LinkItem href='#menu'>Open recent…</Menu.LinkItem>
        <Menu.SubmenuTrigger for='show-file-export'>Export as</Menu.SubmenuTrigger>
        <Menu.Popup id='show-file-export' side='inline-end'>
          <Menu.Item for='show-file-export'>PNG</Menu.Item>
          <Menu.Item for='show-file-export'>SVG</Menu.Item>
          <Menu.Item for='show-file-export'>PDF</Menu.Item>
        </Menu.Popup>
      </Menu.Popup>
    </Menu>

    <Menu>
      <Menu.Trigger for='show-view-menu' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        View
      </Menu.Trigger>
      <Menu.Popup id='show-view-menu' side='top' align='end'>
        <Menu.Item for='show-view-menu'>Zoom in</Menu.Item>
        <Menu.Item for='show-view-menu'>Zoom out</Menu.Item>
        <Menu.Item for='show-view-menu'>Actual size</Menu.Item>
      </Menu.Popup>
    </Menu>

    <CatalogNote>
      The View menu sets <code>side=top</code> and <code>align=end</code>: it opens upward, with its right edge on the trigger's.
    </CatalogNote>

    <Resumable
      name={SHOW_SCOPES.contextMenu}
      state={{ target: "show-context-menu-popup" }}
      ref='context-surface'
      class='mt-2 flex h-24 w-full max-w-md items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground'>
      Right-click anywhere in this box
    </Resumable>
    <Menu.Popup id='show-context-menu-popup' coords>
      <Menu.Item for='show-context-menu-popup'>Cut</Menu.Item>
      <Menu.Item for='show-context-menu-popup'>Copy</Menu.Item>
      <Menu.Item for='show-context-menu-popup'>Paste</Menu.Item>
    </Menu.Popup>
  </CatalogSection>
);

const TabsSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='tabs' title='Tabs'>
    <CatalogPurpose
      page={page}
      id='tabs'
      best='showing one of several peer views in one region'
      instead={[{ when: "letting several independent sections expand", id: "accordion" }]}
    />
    <Tabs class='w-full max-w-md'>
      <Tabs.List aria-label='Panels'>
        <Tabs.Tab for='show-tab-a' selected>
          Overview
        </Tabs.Tab>
        <Tabs.Tab for='show-tab-b'>Details</Tabs.Tab>
        <Tabs.Tab for='show-tab-c'>History</Tabs.Tab>
      </Tabs.List>
      <Tabs.Content id='show-tab-a' selected>
        <p class='text-sm text-muted-foreground'>Arrow keys move between tabs; selection follows focus.</p>
      </Tabs.Content>
      <Tabs.Content id='show-tab-b'>
        <p class='text-sm text-muted-foreground'>The list is a single Tab stop.</p>
      </Tabs.Content>
      <Tabs.Content id='show-tab-c'>
        <p class='text-sm text-muted-foreground'>Home and End reach the ends.</p>
      </Tabs.Content>
    </Tabs>
    <Tabs orientation='vertical' class='w-full max-w-md'>
      <Tabs.List orientation='vertical' aria-label='Vertical panels'>
        <Tabs.Tab for='show-vtab-a' selected>
          General
        </Tabs.Tab>
        <Tabs.Tab for='show-vtab-b'>Advanced</Tabs.Tab>
      </Tabs.List>
      <Tabs.Content id='show-vtab-a' selected>
        <p class='text-sm text-muted-foreground'>The list runs down the side, and arrow keys follow it.</p>
      </Tabs.Content>
      <Tabs.Content id='show-vtab-b'>
        <p class='text-sm text-muted-foreground'>Orientation is set on the root and the list alike.</p>
      </Tabs.Content>
    </Tabs>
  </CatalogSection>
);

const CollapsibleSection: FC<{ icon: ShowIcon; page: string }> = ({ icon, page }) => {
  return (
    <CatalogSection id='collapsible' title='Collapsible'>
      <CatalogPurpose
        page={page}
        id='collapsible'
        best='hiding one optional block behind a disclosure'
        instead={[
          { when: "letting several independent sections expand", id: "accordion" },
          { when: "showing secondary controls anchored to a trigger", id: "popover" },
          { when: "interrupting for a decision that blocks the task", id: "dialog" },
        ]}
      />
      <div class='w-full max-w-md space-y-2'>
        <Collapsible>
          <Collapsible.Trigger icon={icon}>Advanced options</Collapsible.Trigger>
          <Collapsible.Content>Native &lt;details&gt;: open and closed belong to the platform.</Collapsible.Content>
        </Collapsible>
        <Collapsible open>
          <Collapsible.Trigger icon={icon}>Already open</Collapsible.Trigger>
          <Collapsible.Content>Rendered open by the server, with no client work at all.</Collapsible.Content>
        </Collapsible>
        {/* `name` reaches `<details>` through the root's rest props: exclusivity without Accordion,
            for two disclosures that are siblings but not a list. */}
        <Collapsible name='collapsible-exclusive' open>
          <Collapsible.Trigger icon={icon}>Exclusive: first</Collapsible.Trigger>
          <Collapsible.Content>A shared `name` makes the platform close the other one.</Collapsible.Content>
        </Collapsible>
        <Collapsible name='collapsible-exclusive'>
          <Collapsible.Trigger icon={icon}>Exclusive: second</Collapsible.Trigger>
          <Collapsible.Content>Opening this closes the one above, with no script.</Collapsible.Content>
        </Collapsible>
      </div>
    </CatalogSection>
  );
};

const TooltipSection: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='tooltip' title='Tooltip'>
    <CatalogPurpose
      page={page}
      id='tooltip'
      best='naming an icon-only control on hover'
      instead={[{ when: "the user must read the text rather than be hinted at", id: "form-field" }]}
    />
    <Tooltip>
      <Tooltip.Trigger for='show-tooltip-save' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        Save
      </Tooltip.Trigger>
      <Tooltip.Content id='show-tooltip-save'>Writes the file to disk</Tooltip.Content>
    </Tooltip>
    <Tooltip>
      <Tooltip.Trigger for='show-tooltip-bottom' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        side=bottom align=start
      </Tooltip.Trigger>
      <Tooltip.Content id='show-tooltip-bottom' side='bottom' align='start'>
        Below the trigger, left edges aligned
      </Tooltip.Content>
    </Tooltip>
    <Tooltip>
      <Tooltip.Trigger for='show-tooltip-right' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        side=right
      </Tooltip.Trigger>
      <Tooltip.Content id='show-tooltip-right' side='right'>
        To the right of the trigger
      </Tooltip.Content>
    </Tooltip>
    <Tooltip>
      <Tooltip.Trigger for='show-tooltip-left' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        side=left align=end
      </Tooltip.Trigger>
      <Tooltip.Content id='show-tooltip-left' side='left' align='end'>
        Left of the trigger, bottom edges aligned
      </Tooltip.Content>
    </Tooltip>
    <Tooltip>
      <Tooltip.Trigger for='show-tooltip-link' asChild>
        <a href='#tooltip' class='text-sm underline underline-offset-4'>
          asChild anchor
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content id='show-tooltip-link'>Jumps back to this section</Tooltip.Content>
    </Tooltip>
  </CatalogSection>
);

const ToggleGroupSection: FC = () => (
  <CatalogSection id='toggle-group' title='ToggleGroup'>
    <ToggleGroup aria-label='Camera projection'>
      <ToggleGroup.Item name='projection' value='perspective' pressed title='Perspective'>
        Perspective
      </ToggleGroup.Item>
      <ToggleGroup.Item name='projection' value='parallel' title='Parallel'>
        Parallel
      </ToggleGroup.Item>
    </ToggleGroup>
    <ToggleGroup aria-label='Alignment'>
      <ToggleGroup.Item name='align' value='left' title='Left'>
        L
      </ToggleGroup.Item>
      <ToggleGroup.Item name='align' value='center' pressed title='Center'>
        C
      </ToggleGroup.Item>
      <ToggleGroup.Item name='align' value='right' title='Right'>
        R
      </ToggleGroup.Item>
    </ToggleGroup>
    <ToggleGroup type='multiple' aria-label='Overlays'>
      <ToggleGroup.Item type='multiple' name='overlay' value='grid' pressed title='Grid'>
        Grid
      </ToggleGroup.Item>
      <ToggleGroup.Item type='multiple' name='overlay' value='rulers' pressed title='Rulers'>
        Rulers
      </ToggleGroup.Item>
      <ToggleGroup.Item type='multiple' name='overlay' value='safe-area' title='Safe area'>
        Safe area
      </ToggleGroup.Item>
    </ToggleGroup>
    <ToggleGroup orientation='vertical' aria-label='Snap mode'>
      <ToggleGroup.Item name='snap' value='grid' pressed title='Grid'>
        Grid
      </ToggleGroup.Item>
      <ToggleGroup.Item name='snap' value='guides' title='Guides'>
        Guides
      </ToggleGroup.Item>
      <ToggleGroup.Item name='snap' value='pixels' title='Pixels'>
        Pixels
      </ToggleGroup.Item>
    </ToggleGroup>
    <ToggleGroup aria-label='Disabled sample'>
      <ToggleGroup.Item name='disabled-sample' value='on' pressed disabled title='On'>
        On
      </ToggleGroup.Item>
      <ToggleGroup.Item name='disabled-sample' value='off' disabled title='Off'>
        Off
      </ToggleGroup.Item>
    </ToggleGroup>
  </CatalogSection>
);

// One band, six boxes: each carries a position *and* a look, so the grid answers "where does it go"
// and "what does each tone read like" in one pass instead of three disconnected rows. The sixth is
// the live one — see `TOAST_CYCLE_SCOPE`.
const TOAST_SAMPLES = [
  { position: "top-left", tone: "neutral", title: "Default", body: "A plain notification." },
  { position: "top-center", tone: "success", title: "Success", body: "Action completed." },
  { position: "top-right", tone: "warning", title: "Warning", body: "Please review this." },
  { position: "bottom-left", tone: "destructive", title: "Error", body: "Something went wrong." },
  { position: "bottom-center", tone: "info", title: "Info", body: "Dismissible — press ×." },
] as const;

const TOAST_BOX = "relative h-32 rounded-lg border border-dashed border-border";
const TOAST_CONTAINER = "absolute w-auto max-w-none p-2";

const ToastCatalog: FC<{ page: string }> = ({ page }) => (
  <CatalogSection id='toast' title='Toast'>
    <CatalogPurpose
      page={page}
      id='toast'
      best='surfacing a background result the user did not wait for'
      instead={[{ when: "stating a condition that persists on the page", id: "alert" }]}
    />

    <div class='w-full space-y-3'>
      <CatalogNote>
        Each box is one Toast.Container, holding one tone. The shipped container is fixed to the viewport — the flash container at the bottom right
        of this page is one — so these are demoted to absolute inside a bounded box. The bottom-right box runs the real thing: a dismissible toast
        with <code>duration=5000</code>, which the eager toast scope removes when it elapses; this page alone puts it back 2000ms later, so the
        cycle is watchable.
      </CatalogNote>
      <div class='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {TOAST_SAMPLES.map(({ position, tone, title, body }) => (
          <div key={position} class={TOAST_BOX}>
            {/* oxlint-disable-next-line forge/a11y-live-politeness -- six containers render at once as position samples, not as announcements; leaving them live would queue six utterances the reader never asked for. */}
            <Toast.Container position={position} aria-label={`Notifications (${position})`} aria-live='off' class={TOAST_CONTAINER}>
              <Toast tone={tone} dismissible={tone === "info"} class='w-auto'>
                <Toast.Title>{title}</Toast.Title>
                <Toast.Description>{body}</Toast.Description>
              </Toast>
            </Toast.Container>
          </div>
        ))}
        <Resumable name={TOAST_CYCLE_SCOPE} class={TOAST_BOX}>
          {/* oxlint-disable-next-line forge/a11y-live-politeness -- this box re-announces every seven seconds for as long as the page is open, which is the one thing a live region must never be used for. */}
          <Toast.Container position='bottom-right' aria-label='Notifications (bottom-right)' aria-live='off' class={TOAST_CONTAINER}>
            <Toast dismissible duration={TOAST_CYCLE_DURATION} class='w-auto'>
              <Toast.Title>Timed</Toast.Title>
              <Toast.Description>duration=5000 — returns in 2s.</Toast.Description>
            </Toast>
          </Toast.Container>
        </Resumable>
      </div>
    </div>
    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Tone × appearance</h3>
      <div class='grid grid-cols-[5rem_repeat(2,minmax(0,1fr))] items-center gap-2'>
        <ToneMatrixHead appearances={PANEL_APPEARANCES} />
        {TONES.map((tone) => (
          <>
            <ToneLabel key={tone} tone={tone} />
            {PANEL_APPEARANCES.map((appearance) => (
              <Toast key={`${tone}-${appearance}`} tone={tone} appearance={appearance}>
                <Toast.Title>{tone}</Toast.Title>
              </Toast>
            ))}
          </>
        ))}
      </div>
    </div>
  </CatalogSection>
);

const ThemeSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogStack id='theme' title='Theme'>
    <CatalogNote>Cycle light → dark → system. Preference is stored in localStorage.</CatalogNote>
    <div class='flex items-center gap-4'>
      <ThemeToggle icon={icon} />
      <span class='text-sm text-muted-foreground'>Click to cycle themes</span>
    </div>
    {/* `size` is the icon's pixel size, not a variant token: the control's own box is unchanged, so
        the hit target holds at every size the caller picks. */}
    <div class='flex items-center gap-4'>
      <ThemeToggle icon={icon} size='sm' />
      <ThemeToggle icon={icon} size='lg' />
      <span class='text-sm text-muted-foreground'>The same toggle at 16px and 24px</span>
    </div>
  </CatalogStack>
);

const FILTER_ITEMS = ["Alert", "Avatar", "Badge", "Button", "Card", "Input", "Spinner", "Textarea", "Toast"];

const ResumableSection: FC = () => (
  <CatalogStack id='resumable' title='Resumable'>
    <CatalogNote>
      Live-filtering list. State is serialised into data-state; the scope resumes on first interaction, never on page load, and the result count is
      a computed() value with no server roundtrip.
    </CatalogNote>
    <Resumable name={SHOW_SCOPES.filter} state={{ query: "" }}>
      <div class='space-y-3'>
        <div>
          <Label for='filter-input'>Filter components</Label>
          <Input id='filter-input' type='text' name='filter' placeholder='Type to filter…' class='mt-1 max-w-xs' data-on-input='filter' />
        </div>
        <p class='text-sm text-muted-foreground'>
          Showing <span data-ref='count'>{FILTER_ITEMS.length}</span> results
        </p>
        <ul class='space-y-1'>
          {FILTER_ITEMS.map((name) => (
            <li key={name} data-filter-item class='text-sm text-foreground'>
              {name}
            </li>
          ))}
        </ul>
      </div>
    </Resumable>
  </CatalogStack>
);

/** Each shape token beside a box drawn with the utility that reads it. */
const SHAPE_TOKENS: { token: string; sample: string }[] = [
  { token: "--radius", sample: "size-12 rounded-lg border-field border-border bg-muted" },
  { token: "--radius-field", sample: "size-12 rounded-field border-field border-border bg-muted" },
  { token: "--radius-box", sample: "size-12 rounded-box border-field border-border bg-muted" },
  { token: "--radius-selector", sample: "size-12 rounded-selector border-field border-border bg-muted" },
  { token: "--control-h-sm", sample: "h-control-sm w-32 rounded-field border-field border-border bg-muted" },
  { token: "--control-h-md", sample: "h-control-md w-32 rounded-field border-field border-border bg-muted" },
  { token: "--control-h-lg", sample: "h-control-lg w-32 rounded-field border-field border-border bg-muted" },
  { token: "--border-width", sample: "size-12 rounded-field border-field border-border bg-muted" },
];

const TokensSection: FC = () => (
  <CatalogSection id='tokens' title='Shape tokens'>
    <div class='w-full space-y-4'>
      <dl class='space-y-3'>
        {SHAPE_TOKENS.map((row) => (
          <div key={row.token} class='flex items-center gap-4'>
            <dt class='w-40 shrink-0'>
              <code class='font-mono text-xs text-muted-foreground'>{row.token}</code>
            </dt>
            <dd class={row.sample} />
          </div>
        ))}
      </dl>
      <p class='text-sm text-muted-foreground'>
        <code>shape-compact.css</code> re-declares these eight tokens and nothing else, which is the whole of re-shaping.
      </p>
    </div>
  </CatalogSection>
);

interface PageBodyProps {
  paths: ShowcasePaths;
  icon: ShowIcon;
  turnstile: TurnstileDemoOptions;
}

const IndexBody: FC<PageBodyProps> = ({ paths, icon }) => (
  <div class='space-y-10'>
    <AccordionSection icon={icon} page={paths.page} />
    <AvatarSection paths={paths} />
    <BadgeSection page={paths.page} />
    <BreadcrumbsSection icon={icon} />
    <ButtonSection icon={icon} />
    <CardSection icon={icon} page={paths.page} />
    <EmptyStateSection />
    <FileInputSection icon={icon} />
    <FilterSection />
    <IndicatorSection />
    <JoinSection />
    <KbdSection />
    <LinkSection />
    <PaginationSection icon={icon} />
    <StatSection />
    <StatusSection />
    <StepsSection />
    <TimelineSection />
    <TableSection />
    <CheckboxGroupSection />
    <CollapsibleSection icon={icon} page={paths.page} />
    <FieldStackSection />
    <FormSection />
    <FormFieldSection icon={icon} />
    <HoneypotSection />
    <IconSection icon={icon} />
    <InputSection />
    <LabelSection />
    <MeterSection page={paths.page} />
    <OtpInputSection />
    <ProgressSection page={paths.page} />
    <RadioGroupSection />
    <ScrollAreaSection />
    <SelectSection icon={icon} />
    <SeparatorSection />
    <SkeletonSection page={paths.page} />
    <SpinnerSection icon={icon} page={paths.page} />
    <StackSection />
    <SwitchSection />
    <TextareaSection />
    <ToggleSection />
  </div>
);

const InteractiveBody: FC<PageBodyProps> = ({ paths }) => (
  <div class='space-y-10'>
    <AlertSection page={paths.page} />
    <CarouselSection />
    <DialogSection page={paths.page} />
    <DrawerSection />
    <MenuSection page={paths.page} />
    <NumberFieldSection />
    <PopoverSection page={paths.page} />
    <SliderSection />
    <TabsSection page={paths.page} />
    <ToastCatalog page={paths.page} />
    <ToggleGroupSection />
    <ToolbarSection />
    <TooltipSection page={paths.page} />
  </div>
);

const TurnstileBody: FC<PageBodyProps> = ({ paths, icon, turnstile }) => <TurnstileDemos data={turnstile} paths={paths} icon={icon} />;

const RuntimeBody: FC<PageBodyProps> = ({ icon }) => (
  <div class='space-y-10'>
    <ControlsDemos icon={icon} />
    <ResumableSection />
    <LazySection />
  </div>
);

const HtmxBody: FC<PageBodyProps> = ({ paths, icon }) => (
  <div class='space-y-10'>
    <section id='htmx-demos' class='scroll-mt-24 space-y-6'>
      <h2 class='border-b border-border pb-2 text-xl font-semibold text-foreground'>HTMX Demos</h2>
      <PreviewSection paths={paths} icon={icon} />
      <ValidateSection paths={paths} icon={icon} />
      <SearchSection paths={paths} />
      <PaginateSection paths={paths} />
      <DependentSection paths={paths} icon={icon} />
      <ToastSection paths={paths} />
    </section>
    <FlashSection paths={paths} />
  </div>
);

const ChromeBody: FC<PageBodyProps> = ({ icon }) => (
  <div class='space-y-10'>
    <ChromeDemos icon={icon} />
    <ThemeSection icon={icon} />
    <TokensSection />
  </div>
);

const PAGE_BODY: Record<ShowcasePage, FC<PageBodyProps>> = {
  index: IndexBody,
  interactive: InteractiveBody,
  runtime: RuntimeBody,
  htmx: HtmxBody,
  turnstile: TurnstileBody,
  chrome: ChromeBody,
};

/** One showcase page — Layout-less; the consuming app wraps this in its own Layout. @public */
export const ShowcaseContent: FC<{ data: ShowcaseData; icon: ShowIcon; page?: ShowcasePage }> = ({ data, icon, page = "index" }) => {
  const { paths, turnstile } = data;
  const { label, needs } = SHOWCASE_PAGES[page];
  const Body = PAGE_BODY[page];
  return (
    <div class='flex min-h-dvh'>
      <Resumable
        name='navbar'
        class='w-64 shrink-0 border-e border-border has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-e-0 max-md:w-auto'>
        <Navbar
          config={pagesConfig(paths.page)}
          resolveHref={pageHref}
          icon={icon}
          collapsible='always'
          collapsedAs='drawer'
          defaultOpen
          id='showcase-pages'
          aria-label='Showcase pages'
        />
      </Resumable>
      <main id='main-content' class='mx-auto max-w-4xl min-w-0 flex-1 space-y-12 px-6 py-10 lg:px-10'>
        <div>
          <h1 class='text-3xl font-bold text-balance text-foreground'>UI Component Showcase — {label}</h1>
          <p class='mt-2 text-muted-foreground'>{needs}</p>
        </div>

        <Body paths={paths} icon={icon} turnstile={turnstile} />

        <FlashContainer />
      </main>
      <Resumable
        name={SHOW_SCOPES.toc}
        class='w-64 shrink-0 border-s border-border has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-s-0 max-md:w-auto'>
        <Navbar
          config={sectionsConfig(page)}
          resolveHref={anchorHref}
          icon={icon}
          placement='right'
          collapsible='always'
          collapsedAs='drawer'
          defaultOpen
          id='showcase-toc'
          aria-label='On this page'
        />
      </Resumable>
    </div>
  );
};
