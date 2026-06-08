/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */

import type { FC } from "../../jsx/types";
import { Alert } from "../core/alert";
import { Avatar } from "../core/avatar";
import { Badge } from "../core/badge";
import { Button } from "../core/button";
import { Card } from "../core/card";
import { Field } from "../core/field-layout";
import type { ForgeIcon } from "../core/icon";
import { Input } from "../core/input";
import { Label } from "../core/label";
import { Progress } from "../core/progress";
import { Separator } from "../core/separator";
import { Skeleton } from "../core/skeleton";
import { Textarea } from "../core/textarea";
import { Toast } from "../core/toast";
import { createUI } from "../create-ui";
import { FlashContainer } from "../server/flash";
import type { ShowcaseData } from "./route";
import { DependentSection, PaginateSection, PreviewSection, SearchSection, ToastSection, ValidateSection } from "./sections";

// ─── TOC ─────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "alert", label: "Alert" },
  { id: "avatar", label: "Avatar" },
  { id: "badge", label: "Badge" },
  { id: "button", label: "Button" },
  { id: "card", label: "Card" },
  { id: "field", label: "Field" },
  { id: "icon", label: "Icon" },
  { id: "input", label: "Input" },
  { id: "label", label: "Label" },
  { id: "progress", label: "Progress" },
  { id: "separator", label: "Separator" },
  { id: "skeleton", label: "Skeleton" },
  { id: "spinner", label: "Spinner" },
  { id: "textarea", label: "Textarea" },
  { id: "toast", label: "Toast" },
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

const FieldSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({ icon }) => {
  const { Select } = createUI(icon);
  return (
    <CatalogSection id='field' title='Field'>
      <div class='w-full max-w-xs space-y-4'>
        <Field name='text-field'>
          <Field.Label name='text-field'>Label</Field.Label>
          <Input type='text' name='text-field' placeholder='Placeholder' field={{ name: "text-field" }} />
          <Field.Description name='text-field'>Helper text for this field.</Field.Description>
        </Field>
        <Field name='error-field' invalid>
          <Field.Label name='error-field'>Invalid Field</Field.Label>
          <Input type='text' name='error-field' value='bad input' field={{ name: "error-field", invalid: true }} />
          <Field.Error name='error-field'>This field has an error.</Field.Error>
        </Field>
        <Field name='select-field'>
          <Field.Label name='select-field'>Select</Field.Label>
          <Select name='select-field' field={{ name: "select-field" }}>
            <Select.Option value=''>Choose…</Select.Option>
            <Select.Option value='a'>Option A</Select.Option>
            <Select.Option value='b'>Option B</Select.Option>
          </Select>
        </Field>
      </div>
    </CatalogSection>
  );
};

const IconSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({ icon: Icon }) => (
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

const SpinnerSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({ icon }) => {
  const { Spinner: BoundSpinner } = createUI(icon);
  return (
    <CatalogSection id='spinner' title='Spinner'>
      <BoundSpinner size='sm' />
      <BoundSpinner size='md' />
      <BoundSpinner size='lg' />
    </CatalogSection>
  );
};

const TextareaSection: FC = () => (
  <CatalogSection id='textarea' title='Textarea'>
    <Textarea name='demo-textarea' placeholder='Write something…' rows={3} class='max-w-sm' />
    <Textarea name='disabled-textarea' placeholder='Disabled' disabled rows={3} class='max-w-sm' />
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

const ThemeSection: FC<{ icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({ icon }) => {
  const { ThemeToggle } = createUI(icon);
  return (
    <section id='theme' class='scroll-mt-24 space-y-4 rounded-2xl border border-border bg-card p-6'>
      <div>
        <h2 class='text-base font-semibold text-foreground'>Theme</h2>
        <p class='mt-1 text-sm text-muted-foreground'>Cycle light → dark → system. Preference is stored in localStorage.</p>
      </div>
      <div class='flex items-center gap-4'>
        <ThemeToggle />
        <span class='text-sm text-muted-foreground'>Click to cycle themes</span>
      </div>
    </section>
  );
};

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
export const ShowcaseContent: FC<{ data: ShowcaseData; icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor"> }> = ({
  data,
  icon,
}) => {
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
        <AlertSection />
        <AvatarSection />
        <BadgeSection />
        <ButtonSection />
        <CardSection />
        <FieldSection icon={icon} />
        <IconSection icon={icon} />
        <InputSection />
        <LabelSection />
        <ProgressSection />
        <SeparatorSection />
        <SkeletonSection />
        <SpinnerSection icon={icon} />
        <TextareaSection />
        <ToastCatalog />
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
