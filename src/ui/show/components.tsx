/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import type { NavDefinition } from "../chrome/navbar";
import { Navbar } from "../chrome/navbar";
import { ThemeToggle } from "../chrome/theme-toggle";
import { Accordion } from "../core/accordion";
import { Alert } from "../core/alert";
import { Avatar } from "../core/avatar";
import { Badge } from "../core/badge";
import { Button } from "../core/button";
import { Card } from "../core/card";
import { CheckboxGroup } from "../core/checkbox-group";
import { Collapsible } from "../core/collapsible";
import { Dialog } from "../core/dialog";
import { FormField } from "../core/field-layout";
import { Field } from "../core/field-stack";
import { Form } from "../core/form";
import { Honeypot } from "../core/honeypot";
import type { ForgeIcon } from "../core/icon";
import { Input } from "../core/input";
import { Label } from "../core/label";
import { Menu } from "../core/menu";
import { Meter } from "../core/meter";
import { NumberField } from "../core/number-field";
import { Popover } from "../core/popover";
import { Progress } from "../core/progress";
import { RadioGroup } from "../core/radio-group";
import { ScrollArea } from "../core/scroll-area";
import { Select } from "../core/select";
import { Separator } from "../core/separator";
import { Skeleton } from "../core/skeleton";
import { Slider } from "../core/slider";
import { Spinner } from "../core/spinner";
import { Switch } from "../core/switch";
import { Tabs } from "../core/tabs";
import { Textarea } from "../core/textarea";
import { Toast } from "../core/toast";
import { Toggle } from "../core/toggle";
import { ToggleGroup } from "../core/toggle-group";
import { Toolbar } from "../core/toolbar";
import { Tooltip } from "../core/tooltip";
import { Turnstile } from "../core/turnstile";
import { FlashContainer } from "../server/flash";
import { Resumable } from "../server/resumable";
import { ChromeDemos } from "./chrome-demos";
import { ControlsDemos } from "./controls-demos";
import { FlashSection, LazySection } from "./extra-demos";
import type { ShowcaseData, ShowcasePaths } from "./route";
import { DependentSection, PaginateSection, PreviewSection, SearchSection, ToastSection, ValidateSection } from "./sections";

/** The showcase's bound sprite. Named once because a dozen section signatures take it. @internal */
export type ShowIcon = ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close" | "panel-open" | "panel-close">;

/** The bands the table of contents reads in — a catalog entry names one, and nothing else groups. */
type ShowcaseGroup = "Primitives" | "Forms & Controls" | "Bound Controls" | "Interaction & Overlay" | "Feedback" | "Chrome" | "Behaviour";

/** The route a catalog entry is served on — pages are cut by what a consumer must wire up. */
export type ShowcasePage = "index" | "interactive" | "runtime" | "htmx" | "chrome";

/** Every catalog entry, keyed by the kebab-cased name of the component it shows. */
export const SECTIONS: { id: string; label: string; group: ShowcaseGroup; page: ShowcasePage }[] = [
  { id: "accordion", label: "Accordion", group: "Behaviour", page: "index" },
  { id: "alert", label: "Alert", group: "Feedback", page: "interactive" },
  { id: "avatar", label: "Avatar", group: "Primitives", page: "index" },
  { id: "badge", label: "Badge", group: "Primitives", page: "index" },
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
  { id: "scroll-area", label: "ScrollArea", group: "Behaviour", page: "index" },
  { id: "turnstile-widget", label: "Turnstile", group: "Forms & Controls", page: "interactive" },
  { id: "htmx-demos", label: "HTMX Demos", group: "Behaviour", page: "htmx" },
  { id: "theme", label: "Theme", group: "Chrome", page: "chrome" },
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
  { id: "controls-radio-group", label: "Bound RadioGroup", group: "Bound Controls", page: "runtime" },
  { id: "controls-checkbox-group", label: "Bound CheckboxGroup", group: "Bound Controls", page: "runtime" },
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
  chrome: {
    slug: "chrome",
    label: "Chrome",
    needs: 'Import "@y-core/forge/ui/chrome/client", call resume(), and supply the NavDefinition and ToolbarDefinition these sections render from.',
  },
};

/** The order the pages are offered in — the rail lists them, and nothing else orders pages. */
export const PAGE_ORDER: ShowcasePage[] = ["index", "interactive", "runtime", "htmx", "chrome"];

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

/** One catalog band: an anchored section headed by its component's name. @internal */
export const CatalogSection: FC<CatalogSectionProps> = ({ id, title, children }) => (
  <section id={id} class='scroll-mt-24 space-y-4'>
    <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>{title}</h2>
    <div class='flex flex-wrap items-start gap-4'>{children}</div>
  </section>
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

const AlertSection: FC = () => (
  <CatalogSection id='alert' title='Alert'>
    <Alert variant='default' class='flex-1 min-w-56'>
      <Alert.Title>Default</Alert.Title>
      <Alert.Description>A neutral informational alert.</Alert.Description>
    </Alert>
    <Alert variant='info' class='flex-1 min-w-56'>
      <Alert.Title>Info</Alert.Title>
      <Alert.Description>Informational notice for the user.</Alert.Description>
    </Alert>
    <Alert variant='success' class='flex-1 min-w-56'>
      <Alert.Title>Success</Alert.Title>
      <Alert.Description>Operation completed successfully.</Alert.Description>
    </Alert>
    <Alert variant='warning' class='flex-1 min-w-56'>
      <Alert.Title>Warning</Alert.Title>
      <Alert.Description>Something may need attention.</Alert.Description>
    </Alert>
    <Alert variant='destructive' class='flex-1 min-w-56' dismissible>
      <Alert.Title>Destructive</Alert.Title>
      <Alert.Description>An error occurred. Dismiss to acknowledge.</Alert.Description>
    </Alert>
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

const BadgeSection: FC = () => (
  <CatalogSection id='badge' title='Badge'>
    <Badge variant='default'>Default</Badge>
    <Badge variant='secondary'>Secondary</Badge>
    <Badge variant='outline'>Outline</Badge>
    <Badge variant='destructive'>Destructive</Badge>
    <Badge variant='info'>Info</Badge>
    <Badge variant='success'>Success</Badge>
    <Badge variant='warning'>Warning</Badge>
  </CatalogSection>
);

const ButtonSection: FC<{ icon: ShowIcon }> = ({ icon: Icon }) => (
  <CatalogSection id='button' title='Button'>
    <Button variant='primary' size='sm'>
      Primary sm
    </Button>
    <Button variant='primary' size='md'>
      Primary md
    </Button>
    <Button variant='primary' size='lg'>
      Primary lg
    </Button>
    <Button variant='secondary' size='md'>
      Secondary
    </Button>
    <Button variant='ghost' size='md'>
      Ghost
    </Button>
    <Button variant='primary' size='md' disabled>
      Disabled
    </Button>
    <Button variant='destructive' size='md'>
      Destructive
    </Button>
    <Button variant='secondary' size='icon' aria-label='Close panel'>
      <Icon name='close' width={16} height={16} />
    </Button>
    <Button variant='secondary' size='icon-sm' aria-label='Open menu'>
      <Icon name='hamburger' width={16} height={16} />
    </Button>
    <div class='w-16'>
      <Button variant='secondary' size='square' aria-label='More options'>
        <Icon name='chevron-down' width={16} height={16} />
      </Button>
    </div>
  </CatalogSection>
);

const CardSection: FC<{ icon: ShowIcon }> = ({ icon: Icon }) => (
  <CatalogSection id='card' title='Card'>
    <Card class='w-64'>
      <Card.Header>
        <Card.Title>Card Title</Card.Title>
        <Card.Description>A short description of this card.</Card.Description>
        <Card.Action>
          <Button variant='ghost' size='icon-sm' aria-label='Card options'>
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
          <FormField.Legend variant='label'>Email</FormField.Legend>
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
  </CatalogSection>
);

const LabelSection: FC = () => (
  <CatalogSection id='label' title='Label'>
    <Label for='demo-label-input'>Standalone Label</Label>
    <Input id='demo-label-input' type='text' name='demo-label' placeholder='Paired input' class='max-w-xs' />
    <Label for='demo-label-required-input' required>
      Required Label
    </Label>
    <Input id='demo-label-required-input' type='text' name='demo-label-required' placeholder='Required input' class='max-w-xs' />
  </CatalogSection>
);

const ProgressSection: FC = () => (
  <CatalogSection id='progress' title='Progress'>
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

const SkeletonSection: FC = () => (
  <CatalogSection id='skeleton' title='Skeleton'>
    <div class='w-full max-w-sm space-y-2'>
      <Skeleton class='h-4 w-3/4' />
      <Skeleton class='h-4 w-full' />
      <Skeleton class='h-4 w-1/2' />
    </div>
  </CatalogSection>
);

const SpinnerSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='spinner' title='Spinner'>
    <Spinner icon={icon} size='sm' />
    <Spinner icon={icon} size='md' />
    <Spinner icon={icon} size='lg' label='Fetching results…' />
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

const MeterSection: FC = () => (
  <CatalogSection id='meter' title='Meter'>
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

const AccordionSection: FC<{ icon: ShowIcon }> = ({ icon }) => {
  return (
    <CatalogSection id='accordion' title='Accordion'>
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

const DialogSection: FC = () => (
  <CatalogSection id='dialog' title='Dialog'>
    <Dialog.Trigger for='show-dialog' class='rounded-md border border-border px-3 py-1.5 text-sm'>
      Open dialog
    </Dialog.Trigger>
    <Dialog id='show-dialog' class='max-w-sm'>
      <Dialog.Header>
        <h3 class='text-base font-semibold text-foreground'>A native modal</h3>
        <Dialog.Close for='show-dialog' aria-label='Close dialog' class='size-8 rounded p-1 text-muted-foreground'>
          ×
        </Dialog.Close>
      </Dialog.Header>
      <Dialog.Body>
        <p class='max-w-prose text-sm text-muted-foreground text-pretty'>
          Opened and closed by Invoker commands — the top layer, the backdrop and Escape are the platform's.
        </p>
      </Dialog.Body>
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
        <h3 class='text-base font-semibold text-foreground'>Open and non-modal</h3>
      </Dialog.Header>
      <Dialog.Body>
        <p class='max-w-prose text-sm text-muted-foreground text-pretty'>
          The close below runs <code>request-close</code>, the cancelable algorithm — a <code>cancel</code> listener can keep it open, which plain{" "}
          <code>close</code> cannot.
        </p>
      </Dialog.Body>
      <Dialog.Footer class='justify-end'>
        <Dialog.Close for='show-dialog-inline' request class='rounded-md border border-border px-3 py-1.5 text-sm'>
          Request close
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog>
  </CatalogSection>
);

const PopoverSection: FC = () => (
  <CatalogSection id='popover' title='Popover'>
    <Popover>
      <Popover.Trigger id='show-popover' class='rounded-md border border-border px-3 py-1.5 text-sm'>
        Details
      </Popover.Trigger>
      <Popover.Content id='show-popover' class='p-3 text-sm text-muted-foreground'>
        An anchored surface with light-dismiss, and no JavaScript to open it.
      </Popover.Content>
    </Popover>
    <Popover>
      <Popover.Trigger id='show-popover-top' class='rounded-md border border-border px-3 py-1.5 text-sm'>
        side=top
      </Popover.Trigger>
      <Popover.Content id='show-popover-top' side='top' class='p-3 text-sm text-muted-foreground'>
        Opens above the trigger instead of below it.
      </Popover.Content>
    </Popover>
    <Popover>
      <Popover.Trigger id='show-popover-center' class='rounded-md border border-border px-3 py-1.5 text-sm'>
        align=center
      </Popover.Trigger>
      <Popover.Content id='show-popover-center' align='center' class='p-3 text-sm text-muted-foreground'>
        Centred on the trigger along the bottom side.
      </Popover.Content>
    </Popover>
    <Popover>
      <Popover.Trigger id='show-popover-end' class='rounded-md border border-border px-3 py-1.5 text-sm'>
        align=end
      </Popover.Trigger>
      <Popover.Content id='show-popover-end' align='end' class='p-3 text-sm text-muted-foreground'>
        Right edges aligned, so it grows leftward.
      </Popover.Content>
    </Popover>
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
    <Switch name='show-switch-before' orientation='label-before'>
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

/** Cloudflare's documented always-passes test key. */
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";

// The field is not decoration: `mountTurnstile` gates Cloudflare's script on the first `focusin`
// within the enclosing form, so a form with nothing to focus never loads the widget.
const TurnstileSection: FC = () => (
  // Not `turnstile`: the DOM publishes every `id` on `window`, and Cloudflare's `api.js` reads
  // `window.turnstile`'s truthiness to decide it has already loaded.
  <CatalogSection id='turnstile-widget' title='Turnstile'>
    <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
      <Honeypot />
      <Input type='email' name='turnstile-email' placeholder='you@example.com' />
      <Turnstile siteKey={TURNSTILE_TEST_KEY} size='normal' />
      <Button type='submit'>Submit</Button>
    </Form>
    <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
      <Honeypot />
      <Input type='email' name='turnstile-email-compact' placeholder='you@example.com' />
      <Turnstile siteKey={TURNSTILE_TEST_KEY} size='compact' />
      <Button type='submit'>Submit</Button>
    </Form>
    <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
      <Honeypot />
      <Input type='email' name='turnstile-email-flexible' placeholder='you@example.com' />
      <Turnstile siteKey={TURNSTILE_TEST_KEY} size='flexible' />
      <Button type='submit'>Submit</Button>
    </Form>
  </CatalogSection>
);

const ToolbarSection: FC = () => (
  <CatalogSection id='toolbar' title='Toolbar'>
    <Toolbar aria-label='Formatting'>
      <Toolbar.Button pressed>Bold</Toolbar.Button>
      <Toolbar.Button pressed={false}>Italic</Toolbar.Button>
      <Toolbar.Button variant='secondary' size='icon' aria-label='Underline'>
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
    <p class='w-full max-w-prose text-sm text-muted-foreground text-pretty'>
      <code>Toolbar.Link</code> renders forge's own anchor; <code>Toolbar.Button asChild</code> takes the caller's anchor and lends it the toolbar
      item's styling and roving-focus wiring.
    </p>
  </CatalogSection>
);

const MenuSection: FC = () => (
  <CatalogSection id='menu' title='Menu'>
    <Menu>
      <Menu.Trigger id='show-file-menu' class='rounded-md border border-input px-3 py-1.5 text-sm'>
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
        <Menu.SubmenuTrigger id='show-file-export'>Export as</Menu.SubmenuTrigger>
        <Menu.Popup id='show-file-export' side='inline-end'>
          <Menu.Item for='show-file-export'>PNG</Menu.Item>
          <Menu.Item for='show-file-export'>SVG</Menu.Item>
          <Menu.Item for='show-file-export'>PDF</Menu.Item>
        </Menu.Popup>
      </Menu.Popup>
    </Menu>

    <Menu>
      <Menu.Trigger id='show-view-menu' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        View
      </Menu.Trigger>
      <Menu.Popup id='show-view-menu' side='top' align='end'>
        <Menu.Item for='show-view-menu'>Zoom in</Menu.Item>
        <Menu.Item for='show-view-menu'>Zoom out</Menu.Item>
        <Menu.Item for='show-view-menu'>Actual size</Menu.Item>
      </Menu.Popup>
    </Menu>

    <p class='w-full max-w-prose text-sm text-muted-foreground text-pretty'>
      The View menu sets <code>side=top</code> and <code>align=end</code>: it opens upward, with its right edge on the trigger's.
    </p>

    <Resumable
      name='show-context-menu'
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

const TabsSection: FC = () => (
  <CatalogSection id='tabs' title='Tabs'>
    <Tabs class='w-full max-w-md'>
      <Tabs.List aria-label='Panels'>
        <Tabs.Tab for='show-tab-a' selected>
          Overview
        </Tabs.Tab>
        <Tabs.Tab for='show-tab-b'>Details</Tabs.Tab>
        <Tabs.Tab for='show-tab-c'>History</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id='show-tab-a' selected>
        <p class='text-sm text-muted-foreground'>Arrow keys move between tabs; selection follows focus.</p>
      </Tabs.Panel>
      <Tabs.Panel id='show-tab-b'>
        <p class='text-sm text-muted-foreground'>The list is a single Tab stop.</p>
      </Tabs.Panel>
      <Tabs.Panel id='show-tab-c'>
        <p class='text-sm text-muted-foreground'>Home and End reach the ends.</p>
      </Tabs.Panel>
    </Tabs>
    <Tabs orientation='vertical' class='w-full max-w-md'>
      <Tabs.List orientation='vertical' aria-label='Vertical panels'>
        <Tabs.Tab for='show-vtab-a' selected>
          General
        </Tabs.Tab>
        <Tabs.Tab for='show-vtab-b'>Advanced</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id='show-vtab-a' selected>
        <p class='text-sm text-muted-foreground'>The list runs down the side, and arrow keys follow it.</p>
      </Tabs.Panel>
      <Tabs.Panel id='show-vtab-b'>
        <p class='text-sm text-muted-foreground'>Orientation is set on the root and the list alike.</p>
      </Tabs.Panel>
    </Tabs>
  </CatalogSection>
);

const CollapsibleSection: FC<{ icon: ShowIcon }> = ({ icon }) => {
  return (
    <CatalogSection id='collapsible' title='Collapsible'>
      <div class='w-full max-w-md space-y-2'>
        <Collapsible>
          <Collapsible.Trigger icon={icon}>Advanced options</Collapsible.Trigger>
          <Collapsible.Panel>Native &lt;details&gt;: open and closed belong to the platform.</Collapsible.Panel>
        </Collapsible>
        <Collapsible open>
          <Collapsible.Trigger icon={icon}>Already open</Collapsible.Trigger>
          <Collapsible.Panel>Rendered open by the server, with no client work at all.</Collapsible.Panel>
        </Collapsible>
        {/* `name` reaches `<details>` through the root's rest props: exclusivity without Accordion,
            for two disclosures that are siblings but not a list. */}
        <Collapsible name='collapsible-exclusive' open>
          <Collapsible.Trigger icon={icon}>Exclusive: first</Collapsible.Trigger>
          <Collapsible.Panel>A shared `name` makes the platform close the other one.</Collapsible.Panel>
        </Collapsible>
        <Collapsible name='collapsible-exclusive'>
          <Collapsible.Trigger icon={icon}>Exclusive: second</Collapsible.Trigger>
          <Collapsible.Panel>Opening this closes the one above, with no script.</Collapsible.Panel>
        </Collapsible>
      </div>
    </CatalogSection>
  );
};

const TooltipSection: FC = () => (
  <CatalogSection id='tooltip' title='Tooltip'>
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

const TOAST_POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;

const ToastCatalog: FC = () => (
  <CatalogSection id='toast' title='Toast'>
    <Toast variant='default'>
      <Toast.Title>Default</Toast.Title>
      <Toast.Description>A plain notification.</Toast.Description>
    </Toast>
    <Toast variant='success'>
      <Toast.Title>Success</Toast.Title>
      <Toast.Description>Action completed.</Toast.Description>
    </Toast>
    <Toast variant='warning'>
      <Toast.Title>Warning</Toast.Title>
      <Toast.Description>Please review this.</Toast.Description>
    </Toast>
    <Toast variant='destructive'>
      <Toast.Title>Error</Toast.Title>
      <Toast.Description>Something went wrong.</Toast.Description>
    </Toast>
    <Toast variant='info' dismissible>
      <Toast.Title>Info</Toast.Title>
      <Toast.Description>Dismissible informational toast.</Toast.Description>
    </Toast>

    <div class='w-full space-y-3'>
      <p class='max-w-prose text-sm text-muted-foreground text-pretty'>
        Each box is one Toast.Container. The shipped container is fixed to the viewport — the flash container at the bottom right of this page is
        one — so these are demoted to absolute inside a bounded box.
      </p>
      <div class='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {TOAST_POSITIONS.map((position) => (
          <div key={position} class='relative h-32 rounded-lg border border-dashed border-border'>
            <Toast.Container position={position} aria-label={`Notifications (${position})`} aria-live='off' class='absolute w-auto max-w-none p-2'>
              <Toast variant='default' class='w-auto'>
                <Toast.Description>{position}</Toast.Description>
              </Toast>
            </Toast.Container>
          </div>
        ))}
      </div>
    </div>

    <div class='w-full space-y-3'>
      <Toast variant='info' dismissible duration={600000} class='max-w-sm'>
        <Toast.Title>Long-lived by design</Toast.Title>
        <Toast.Description>duration=600000 — the runtime removes this toast when it elapses.</Toast.Description>
      </Toast>
      <p class='max-w-prose text-sm text-muted-foreground text-pretty'>
        The duration is serialised into <code>data-state</code> and read by the eager toast scope. Flash ships 5000; this exemplar is deliberately
        long so it stays on the page.
      </p>
    </div>
  </CatalogSection>
);

const ThemeSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogPanel id='theme' title='Theme' description='Cycle light → dark → system. Preference is stored in localStorage.'>
    <div class='flex items-center gap-4'>
      <ThemeToggle icon={icon} />
      <span class='text-sm text-muted-foreground'>Click to cycle themes</span>
    </div>
    {/* `size` is the icon's pixel size, not a variant token: the control's own box is unchanged, so
        the hit target holds at every size the caller picks. */}
    <div class='flex items-center gap-4'>
      <ThemeToggle icon={icon} size={16} />
      <ThemeToggle icon={icon} size={24} />
      <span class='text-sm text-muted-foreground'>The same toggle at 16px and 24px</span>
    </div>
  </CatalogPanel>
);

const FILTER_ITEMS = ["Alert", "Avatar", "Badge", "Button", "Card", "Input", "Spinner", "Textarea", "Toast"];

const ResumableSection: FC = () => (
  <CatalogPanel
    id='resumable'
    title='Resumable'
    description='Live-filtering list. State is serialised into data-state; the scope resumes on first interaction, never on page load, and the result count is a computed() value with no server roundtrip.'>
    <Resumable name='show-filter' state={{ query: "" }}>
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
  </CatalogPanel>
);

interface PageBodyProps {
  paths: ShowcasePaths;
  icon: ShowIcon;
}

const IndexBody: FC<PageBodyProps> = ({ paths, icon }) => (
  <div class='space-y-10'>
    <AccordionSection icon={icon} />
    <AvatarSection paths={paths} />
    <BadgeSection />
    <ButtonSection icon={icon} />
    <CardSection icon={icon} />
    <CheckboxGroupSection />
    <CollapsibleSection icon={icon} />
    <FieldStackSection />
    <FormSection />
    <FormFieldSection icon={icon} />
    <HoneypotSection />
    <IconSection icon={icon} />
    <InputSection />
    <LabelSection />
    <MeterSection />
    <ProgressSection />
    <RadioGroupSection />
    <ScrollAreaSection />
    <SelectSection icon={icon} />
    <SeparatorSection />
    <SkeletonSection />
    <SpinnerSection icon={icon} />
    <SwitchSection />
    <TextareaSection />
    <ToggleSection />
  </div>
);

const InteractiveBody: FC<PageBodyProps> = () => (
  <div class='space-y-10'>
    <AlertSection />
    <DialogSection />
    <MenuSection />
    <NumberFieldSection />
    <PopoverSection />
    <SliderSection />
    <TabsSection />
    <ToastCatalog />
    <ToggleGroupSection />
    <ToolbarSection />
    <TooltipSection />
    <TurnstileSection />
  </div>
);

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
      <h2 class='text-xl font-semibold text-foreground border-b border-border pb-2'>HTMX Demos</h2>
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
  </div>
);

const PAGE_BODY: Record<ShowcasePage, FC<PageBodyProps>> = {
  index: IndexBody,
  interactive: InteractiveBody,
  runtime: RuntimeBody,
  htmx: HtmxBody,
  chrome: ChromeBody,
};

/** One showcase page — Layout-less; the consuming app wraps this in its own Layout. @public */
export const ShowcaseContent: FC<{ data: ShowcaseData; icon: ShowIcon; page?: ShowcasePage }> = ({ data, icon, page = "index" }) => {
  const { paths } = data;
  const { label, needs } = SHOWCASE_PAGES[page];
  const Body = PAGE_BODY[page];
  return (
    <div class='flex min-h-dvh'>
      <Resumable
        name='navbar'
        class='w-64 shrink-0 border-e border-border max-md:w-auto has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-e-0'>
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
      <main id='main-content' class='flex-1 min-w-0 mx-auto max-w-4xl px-6 py-10 lg:px-10 space-y-12'>
        <div>
          <h1 class='text-3xl font-bold text-foreground text-balance'>UI Component Showcase — {label}</h1>
          <p class='mt-2 text-muted-foreground'>{needs}</p>
        </div>

        <Body paths={paths} icon={icon} />

        <FlashContainer />
      </main>
      <Resumable
        name='show-toc'
        class='w-64 shrink-0 border-s border-border max-md:w-auto has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-s-0'>
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
