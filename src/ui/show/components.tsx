/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
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
import type { ShowcaseData } from "./route";
import { DependentSection, PaginateSection, PreviewSection, SearchSection, ToastSection, ValidateSection } from "./sections";

/** The showcase's bound sprite. Named once because a dozen section signatures take it. */
type ShowIcon = ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close">;

// ─── TOC ─────────────────────────────────────────────────────────────────────

/**
 * The catalog, and the showcase's completeness contract.
 *
 * Exported because `components.test.tsx` asserts against it: **every component exported from
 * `core/mod.ts` has a section here, keyed by its own kebab-cased name.** A primitive with no section
 * is one nobody can look at, and — after the cross-cutting corpus — one nobody drives, so the
 * property is checked rather than remembered.
 */
export const SECTIONS = [
  { id: "accordion", label: "Accordion" },
  { id: "alert", label: "Alert" },
  { id: "avatar", label: "Avatar" },
  { id: "badge", label: "Badge" },
  { id: "button", label: "Button" },
  { id: "card", label: "Card" },
  { id: "dialog", label: "Dialog" },
  { id: "field", label: "Field" },
  { id: "form", label: "Form" },
  { id: "form-field", label: "FormField" },
  { id: "icon", label: "Icon" },
  { id: "input", label: "Input" },
  { id: "label", label: "Label" },
  { id: "popover", label: "Popover" },
  { id: "progress", label: "Progress" },
  { id: "select", label: "Select" },
  { id: "separator", label: "Separator" },
  { id: "skeleton", label: "Skeleton" },
  { id: "slider", label: "Slider" },
  { id: "spinner", label: "Spinner" },
  { id: "switch", label: "Switch" },
  { id: "textarea", label: "Textarea" },
  { id: "toast", label: "Toast" },
  { id: "toggle", label: "Toggle" },
  { id: "toggle-group", label: "ToggleGroup" },
  { id: "toolbar", label: "Toolbar" },
  { id: "menu", label: "Menu" },
  { id: "tabs", label: "Tabs" },
  { id: "collapsible", label: "Collapsible" },
  { id: "tooltip", label: "Tooltip" },
  { id: "checkbox-group", label: "CheckboxGroup" },
  { id: "radio-group", label: "RadioGroup" },
  { id: "meter", label: "Meter" },
  { id: "number-field", label: "NumberField" },
  { id: "scroll-area", label: "ScrollArea" },
  { id: "turnstile", label: "Turnstile" },
  { id: "htmx-demos", label: "HTMX Demos" },
  { id: "theme", label: "Theme" },
  { id: "resumable", label: "Resumable" },
];

const ShowcaseToc: FC = () => (
  <nav aria-label='Component catalog' class='mb-10 flex flex-wrap gap-2'>
    {SECTIONS.map(({ id, label }) => (
      <a
        key={id}
        href={`#${id}`}
        class='rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent'>
        {label}
      </a>
    ))}
  </nav>
);

// ─── Catalog section wrapper ──────────────────────────────────────────────────

interface CatalogSectionProps {
  id: string;
  title: string;
  children: unknown;
}

const CatalogSection: FC<CatalogSectionProps> = ({ id, title, children }) => (
  <section id={id} class='scroll-mt-24 space-y-4'>
    <h2 class='text-base font-semibold text-foreground border-b border-border pb-2'>{title}</h2>
    <div class='flex flex-wrap items-start gap-4'>{children}</div>
  </section>
);

// ─── Static catalog sections ─────────────────────────────────────────────────

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

const AvatarSection: FC = () => (
  <CatalogSection id='avatar' title='Avatar'>
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
  </CatalogSection>
);

const ButtonSection: FC = () => (
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
  </CatalogSection>
);

const CardSection: FC = () => (
  <CatalogSection id='card' title='Card'>
    <Card class='w-64'>
      <Card.Header>
        <Card.Title>Card Title</Card.Title>
        <Card.Description>A short description of this card.</Card.Description>
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
        <Input type='text' name='text-field' placeholder='Placeholder' field={{ name: "text-field" }} />
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
    </div>
  </CatalogSection>
);

const IconSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close"> }> = ({ icon: Icon }) => (
  <CatalogSection id='icon' title='Icon'>
    <div class='flex items-center gap-4'>
      <Icon name='spinner' width={20} height={20} />
      <Icon name='chevron-down' width={20} height={20} />
      <Icon name='sun' width={20} height={20} />
      <Icon name='moon' width={20} height={20} />
      <Icon name='monitor' width={20} height={20} />
    </div>
  </CatalogSection>
);

const InputSection: FC = () => (
  <CatalogSection id='input' title='Input'>
    <Input type='text' name='text-input' placeholder='Text input' class='max-w-xs' />
    <Input type='email' name='email-input' placeholder='Email input' class='max-w-xs' />
    <Input type='password' name='pw-input' placeholder='Password input' class='max-w-xs' />
    <Input type='text' name='disabled-input' placeholder='Disabled' disabled class='max-w-xs' />
  </CatalogSection>
);

const LabelSection: FC = () => (
  <CatalogSection id='label' title='Label'>
    <Label for='demo-label-input'>Standalone Label</Label>
    <Input id='demo-label-input' type='text' name='demo-label' placeholder='Paired input' class='max-w-xs' />
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
  </CatalogSection>
);

const SeparatorSection: FC = () => (
  <CatalogSection id='separator' title='Separator'>
    <div class='w-full max-w-sm space-y-3'>
      <p class='text-sm text-muted-foreground'>Above</p>
      <Separator />
      <p class='text-sm text-muted-foreground'>Below</p>
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

const SpinnerSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close"> }> = ({ icon }) => (
  <CatalogSection id='spinner' title='Spinner'>
    <Spinner icon={icon} size='sm' />
    <Spinner icon={icon} size='md' />
    <Spinner icon={icon} size='lg' />
  </CatalogSection>
);

const TextareaSection: FC = () => (
  <CatalogSection id='textarea' title='Textarea'>
    <Textarea name='demo-textarea' placeholder='Write something…' rows={3} class='max-w-sm' />
    <Textarea name='disabled-textarea' placeholder='Disabled' disabled rows={3} class='max-w-sm' />
  </CatalogSection>
);

/** Enough rows to overflow the viewport, which is the only way to see that it scrolls. */
const SCROLL_ROWS = ["Alert", "Avatar", "Badge", "Button", "Card", "Dialog", "Field", "Form", "Icon", "Input", "Label", "Menu", "Meter"];

const CheckboxGroupSection: FC = () => (
  <CatalogSection id='checkbox-group' title='CheckboxGroup'>
    <CheckboxGroup name='toppings' orientation='horizontal'>
      <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
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
  </CatalogSection>
);

const MeterSection: FC = () => (
  <CatalogSection id='meter' title='Meter'>
    <Meter>
      <Meter.Label for='show-meter-disk'>Disk usage</Meter.Label>
      <Meter.Track id='show-meter-disk' value={0.72} low={0.3} high={0.8} optimum={0.2} />
      <Meter.Value>72% of 500 GB</Meter.Value>
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
  </CatalogSection>
);

const ScrollAreaSection: FC = () => (
  <CatalogSection id='scroll-area' title='ScrollArea'>
    <ScrollArea class='h-40 w-64 rounded-md border border-border'>
      <ScrollArea.Viewport class='p-3'>
        <div class='space-y-2 text-sm text-muted-foreground'>
          {SCROLL_ROWS.map((row) => (
            <p key={row}>{row}</p>
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
  // `Accordion.Trigger` takes `ForgeIcon<string>`, because its optional `iconName` is an arbitrary
  // glyph. The showcase's binding names a fixed set, and a narrower name set is not assignable to a
  // wider one — the trigger only ever draws `chevron-down` here, which this binding supplies.
  const wide = icon as unknown as ForgeIcon<string>;
  return (
    <CatalogSection id='accordion' title='Accordion'>
      <Accordion class='w-full max-w-md gap-2'>
        <Accordion.Item open>
          <Accordion.Trigger icon={wide}>What is a resumable scope?</Accordion.Trigger>
          <Accordion.Content>A server-stamped region whose state is rehydrated on the first interaction inside it.</Accordion.Content>
        </Accordion.Item>
        <Accordion.Item>
          <Accordion.Trigger icon={wide}>Why native disclosure?</Accordion.Trigger>
          <Accordion.Content hint='No JavaScript required'>
            Open and closed belong to the platform; the controller only publishes them for CSS to react to.
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </CatalogSection>
  );
};

const DialogSection: FC = () => (
  <CatalogSection id='dialog' title='Dialog'>
    <Dialog.Trigger for='show-dialog'>Open dialog</Dialog.Trigger>
    <Dialog id='show-dialog' class='max-w-sm'>
      <h3 class='text-base font-semibold text-foreground'>A native modal</h3>
      <p class='mt-2 text-sm text-muted-foreground'>
        Opened and closed by Invoker commands — the top layer, the backdrop and Escape are the platform's.
      </p>
      <div class='mt-4 flex justify-end gap-2'>
        <Dialog.Close for='show-dialog'>Close</Dialog.Close>
      </div>
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
  </CatalogSection>
);

const SelectSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='select' title='Select'>
    <Select name='show-select' class='max-w-xs' icon={icon}>
      <Select.Option value=''>Choose…</Select.Option>
      <Select.Option value='mm'>Millimetres</Select.Option>
      <Select.Option value='in'>Inches</Select.Option>
    </Select>
    <Select name='show-select-disabled' class='max-w-xs' icon={icon} disabled>
      <Select.Option value='mm'>Disabled</Select.Option>
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
    <Form action='#' method='post' csrfToken='demo-token' honeypotField='company' class='w-full max-w-xs space-y-3'>
      <Field label='Project name'>
        <Input type='text' name='project' placeholder='Untitled' />
      </Field>
      <Button type='submit'>Save</Button>
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

/**
 * Cloudflare's documented always-passes test key. A real key would tie the showcase to one origin,
 * and this widget is here to be looked at, not to gate anything.
 */
const TURNSTILE_TEST_KEY = "1x00000000000000000000AA";

const TurnstileSection: FC = () => (
  <CatalogSection id='turnstile' title='Turnstile'>
    <Turnstile siteKey={TURNSTILE_TEST_KEY} size='normal' />
  </CatalogSection>
);

const ToolbarSection: FC = () => (
  <CatalogSection id='toolbar' title='Toolbar'>
    <Toolbar aria-label='Formatting'>
      <Toolbar.Button>Bold</Toolbar.Button>
      <Toolbar.Button>Italic</Toolbar.Button>
      <Toolbar.Separator />
      <Toolbar.Group aria-label='Search'>
        <Toolbar.Input placeholder='Find' />
      </Toolbar.Group>
      <Toolbar.Separator />
      <Toolbar.Link href='#toolbar'>Help</Toolbar.Link>
    </Toolbar>
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
      </Menu.Popup>
    </Menu>
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
  </CatalogSection>
);

const CollapsibleSection: FC = () => (
  <CatalogSection id='collapsible' title='Collapsible'>
    <div class='w-full max-w-md space-y-2'>
      <Collapsible>
        <Collapsible.Trigger>Advanced options</Collapsible.Trigger>
        <Collapsible.Panel>Native &lt;details&gt;: open and closed belong to the platform.</Collapsible.Panel>
      </Collapsible>
      <Collapsible open>
        <Collapsible.Trigger>Already open</Collapsible.Trigger>
        <Collapsible.Panel>Rendered open by the server, with no client work at all.</Collapsible.Panel>
      </Collapsible>
    </div>
  </CatalogSection>
);

const TooltipSection: FC = () => (
  <CatalogSection id='tooltip' title='Tooltip'>
    <Tooltip>
      <Tooltip.Trigger for='show-tooltip-save' class='rounded-md border border-input px-3 py-1.5 text-sm'>
        Save
      </Tooltip.Trigger>
      <Tooltip.Content id='show-tooltip-save'>Writes the file to disk</Tooltip.Content>
    </Tooltip>
  </CatalogSection>
);

const ToggleGroupSection: FC = () => (
  <CatalogSection id='toggle-group' title='ToggleGroup'>
    <ToggleGroup aria-label='Camera projection'>
      <ToggleGroup.Item pressed title='Perspective' aria-label='Perspective'>
        Perspective
      </ToggleGroup.Item>
      <ToggleGroup.Item title='Parallel' aria-label='Parallel'>
        Parallel
      </ToggleGroup.Item>
    </ToggleGroup>
    <ToggleGroup aria-label='Alignment'>
      <ToggleGroup.Item title='Left' aria-label='Left'>
        L
      </ToggleGroup.Item>
      <ToggleGroup.Item pressed title='Center' aria-label='Center'>
        C
      </ToggleGroup.Item>
      <ToggleGroup.Item title='Right' aria-label='Right'>
        R
      </ToggleGroup.Item>
    </ToggleGroup>
  </CatalogSection>
);

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
  </CatalogSection>
);

// ─── Theme section ────────────────────────────────────────────────────────────

const ThemeSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close"> }> = ({ icon }) => (
  <section id='theme' class='scroll-mt-24 space-y-4 rounded-2xl border border-border bg-card p-6'>
    <div>
      <h2 class='text-base font-semibold text-foreground'>Theme</h2>
      <p class='mt-1 text-sm text-muted-foreground'>Cycle light → dark → system. Preference is stored in localStorage.</p>
    </div>
    <div class='flex items-center gap-4'>
      <ThemeToggle icon={icon} />
      <span class='text-sm text-muted-foreground'>Click to cycle themes</span>
    </div>
  </section>
);

// ─── Resumability island ─────────────────────────────────────────────────────

const FILTER_ITEMS = ["Alert", "Avatar", "Badge", "Button", "Card", "Input", "Spinner", "Textarea", "Toast"];

const ResumableSection: FC = () => (
  <section id='resumable' class='scroll-mt-24 space-y-4 rounded-2xl border border-border bg-card p-6'>
    <div>
      <h2 class='text-base font-semibold text-foreground'>Resumable</h2>
      <p class='mt-1 text-sm text-muted-foreground'>
        Live-filtering list. State serialised into <code>data-state</code>; the scope resumes on first interaction, never on page load. The result
        count is a <code>computed()</code>-derived value — no server roundtrip needed.
      </p>
    </div>
    <div data-scope='show-filter' data-state='{"query":""}'>
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
    </div>
  </section>
);

// ─── ShowcaseContent ──────────────────────────────────────────────────────────

/** Full showcase page content — Layout-less; the consuming app wraps this in its own Layout. @public */
export const ShowcaseContent: FC<{
  data: ShowcaseData;
  icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close">;
}> = ({ data, icon }) => {
  const { paths } = data;
  return (
    <main id='main-content' class='mx-auto max-w-4xl px-6 py-10 lg:px-10 space-y-12'>
      <div>
        <h1 class='text-3xl font-bold text-foreground'>UI Component Showcase</h1>
        <p class='mt-2 text-muted-foreground'>
          Living reference for every <code>@y-core/forge</code> UI component — static catalog, HTMX demos, theme toggle, and resumability island.
        </p>
      </div>

      <ShowcaseToc />

      {/* Static catalog */}
      <div class='space-y-10'>
        <AccordionSection icon={icon} />
        <AlertSection />
        <AvatarSection />
        <BadgeSection />
        <ButtonSection />
        <CardSection />
        <DialogSection />
        <FieldStackSection />
        <FormSection />
        <FormFieldSection icon={icon} />
        <IconSection icon={icon} />
        <InputSection />
        <LabelSection />
        <PopoverSection />
        <ProgressSection />
        <SelectSection icon={icon} />
        <SeparatorSection />
        <SkeletonSection />
        <SliderSection />
        <SpinnerSection icon={icon} />
        <SwitchSection />
        <TextareaSection />
        <ToastCatalog />
        <ToggleSection />
        <ToggleGroupSection />
        <ToolbarSection />
        <MenuSection />
        <TabsSection />
        <CollapsibleSection />
        <TooltipSection />
        <CheckboxGroupSection />
        <RadioGroupSection />
        <MeterSection />
        <NumberFieldSection />
        <ScrollAreaSection />
        <TurnstileSection />
      </div>

      {/* HTMX demos */}
      <section id='htmx-demos' class='scroll-mt-24 space-y-6'>
        <h2 class='text-xl font-semibold text-foreground border-b border-border pb-2'>HTMX Demos</h2>
        <PreviewSection paths={paths} icon={icon} />
        <ValidateSection paths={paths} />
        <SearchSection paths={paths} />
        <PaginateSection paths={paths} />
        <DependentSection paths={paths} icon={icon} />
        <ToastSection paths={paths} />
      </section>

      {/* Theme toggle */}
      <ThemeSection icon={icon} />

      {/* Resumability island */}
      <ResumableSection />

      {/* OOB flash target */}
      <FlashContainer />
    </main>
  );
};
