/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { TURNSTILE_FIELD_DEFAULT } from "../../form/constants";
import type { TurnstileFailure } from "../../form/types";
import { formSubmit, SWAP } from "../../html/htmx/htmx-patterns";
import type { FC } from "../../jsx/types";
import { Alert } from "../core/alert";
import { Button } from "../core/button";
import { FormField } from "../core/field-layout";
import { Form } from "../core/form";
import type { ForgeIcon } from "../core/icon";
import { Input } from "../core/input";
import { Select } from "../core/select";
import { Turnstile } from "../core/turnstile";
import { CatalogPanel, CatalogRow } from "./components";
import type { ShowcasePaths } from "./route";

/** Where the verdict fragment lands, so the form and the action never drift. @public */
export const SHOW_TURNSTILE_VERDICT_ID = "show-turnstile-verdict";

/** One of Cloudflare's published dummy sitekeys, which is all this page ever renders. @public */
export interface TurnstileTestKey {
  id: string;
  siteKey: string;
  label: string;
  note: string;
}

// A fixed list rather than a free-text sitekey: a key off the query string would be an attacker's
// widget rendered under this origin's name, and no demonstration needs that.
/** The key every band other than the playground renders, and the playground's own default. @public */
export const TURNSTILE_PASS_KEY: TurnstileTestKey = {
  id: "pass",
  siteKey: "1x00000000000000000000AA",
  label: "Visible — always passes",
  note: "The widget renders and clears itself.",
};

/** Cloudflare's dummy sitekeys — the only keys the playground offers. @public */
export const TURNSTILE_TEST_KEYS: readonly TurnstileTestKey[] = [
  TURNSTILE_PASS_KEY,
  {
    id: "block",
    siteKey: "2x00000000000000000000AB",
    label: "Visible — always blocks",
    note: "The widget renders and fails; the error callback fires.",
  },
  {
    id: "interactive",
    siteKey: "3x00000000000000000000FF",
    label: "Visible — forces a challenge",
    note: "The widget always asks the visitor to interact.",
  },
  { id: "invisible", siteKey: "1x00000000000000000000BB", label: "Invisible — always passes", note: "Nothing is drawn; the token arrives anyway." },
];

const SIZES = ["normal", "compact", "flexible"] as const;
const LOADS = ["eager", "focus"] as const;
const CHALLENGES = ["render", "submit"] as const;
const APPEARANCES = ["always", "execute", "interaction-only"] as const;
const LANGUAGES = ["auto", "en", "de", "fr", "es", "ja", "ar"] as const;

/** Every prop the playground drives, read from the query string. @public */
export interface TurnstileDemoOptions {
  key: string;
  size: (typeof SIZES)[number];
  load: (typeof LOADS)[number];
  challenge: (typeof CHALLENGES)[number];
  appearance: (typeof APPEARANCES)[number];
  action: string;
  cData: string;
  responseFieldName: string;
  language: (typeof LANGUAGES)[number];
  tabindex: number | null;
}

/** What the page renders when the query string says nothing. @public */
export const TURNSTILE_DEMO_DEFAULTS: TurnstileDemoOptions = {
  key: "pass",
  size: "normal",
  load: "eager",
  challenge: "render",
  appearance: "always",
  action: "",
  cData: "",
  responseFieldName: "",
  language: "auto",
  tabindex: null,
};

const ACTION_CHARS = /^[a-zA-Z0-9_-]{0,32}$/;
const CDATA_CHARS = /^[a-zA-Z0-9_-]{0,255}$/;
const FIELD_NAME_CHARS = /^[a-zA-Z0-9_-]{0,64}$/;

function pick<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T {
  const raw = params.get(name);
  return allowed.find((value) => value === raw) ?? fallback;
}

/** Reads the playground's options off the query string, rejecting anything the controls cannot produce. @public */
export function loadTurnstileOptions(params: URLSearchParams): TurnstileDemoOptions {
  const key = TURNSTILE_TEST_KEYS.find((candidate) => candidate.id === params.get("key"));
  const action = params.get("action") ?? "";
  const cData = params.get("cData") ?? "";
  const responseFieldName = params.get("responseFieldName") ?? "";
  const rawTab = params.get("tabindex");
  const tab = rawTab === null || rawTab.trim() === "" ? Number.NaN : Number(rawTab);
  return {
    key: key?.id ?? TURNSTILE_DEMO_DEFAULTS.key,
    size: pick(params, "size", SIZES, TURNSTILE_DEMO_DEFAULTS.size),
    load: pick(params, "load", LOADS, TURNSTILE_DEMO_DEFAULTS.load),
    challenge: pick(params, "challenge", CHALLENGES, TURNSTILE_DEMO_DEFAULTS.challenge),
    appearance: pick(params, "appearance", APPEARANCES, TURNSTILE_DEMO_DEFAULTS.appearance),
    action: ACTION_CHARS.test(action) ? action : "",
    cData: CDATA_CHARS.test(cData) ? cData : "",
    responseFieldName: FIELD_NAME_CHARS.test(responseFieldName) ? responseFieldName : "",
    language: pick(params, "language", LANGUAGES, TURNSTILE_DEMO_DEFAULTS.language),
    tabindex: Number.isInteger(tab) && tab >= -1 && tab <= 32_767 ? tab : null,
  };
}

/** The sitekey the chosen preset names. @public */
export function turnstileSiteKey(options: TurnstileDemoOptions): string {
  return (TURNSTILE_TEST_KEYS.find((candidate) => candidate.id === options.key) ?? TURNSTILE_PASS_KEY).siteKey;
}

/** The `<Turnstile>` call the current options correspond to, as source a reader can copy. @public */
export function turnstileSnippet(options: TurnstileDemoOptions): string {
  const props = [`siteKey='${turnstileSiteKey(options)}'`];
  if (options.size !== "normal") props.push(`size='${options.size}'`);
  if (options.load !== "eager") props.push(`load='${options.load}'`);
  if (options.challenge !== "render") props.push(`challenge='${options.challenge}'`);
  if (options.appearance !== "always") props.push(`appearance='${options.appearance}'`);
  if (options.action !== "") props.push(`action='${options.action}'`);
  if (options.cData !== "") props.push(`cData='${options.cData}'`);
  if (options.responseFieldName !== "") props.push(`responseFieldName='${options.responseFieldName}'`);
  if (options.language !== "auto") props.push(`language='${options.language}'`);
  if (options.tabindex !== null) props.push(`tabindex={${options.tabindex}}`);
  return `<Turnstile ${props.join(" ")} />`;
}

type DemoIcon = ForgeIcon<"chevron-down">;

const OPTION_FIELD = "space-y-1";

const OptionSelect: FC<{ name: string; label: string; icon: DemoIcon; children: unknown }> = ({ name, label, icon, children }) => (
  <FormField name={name} class={OPTION_FIELD}>
    <FormField.Label name={name}>{label}</FormField.Label>
    <Select name={name} icon={icon} field={{ name }}>
      {children}
    </Select>
  </FormField>
);

const options = <T extends string>(values: readonly T[], selected: T) =>
  values.map((value) => (
    <Select.Option key={value} value={value} selected={value === selected}>
      {value}
    </Select.Option>
  ));

/** The option panel: a plain GET form, so the whole configuration is the URL. */
const OptionsForm: FC<{ data: TurnstileDemoOptions; path: string; icon: DemoIcon }> = ({ data, path, icon }) => (
  <Form method='get' action={path} class='grid gap-4 sm:grid-cols-2'>
    <FormField name='key' class={OPTION_FIELD}>
      <FormField.Label name='key'>Test sitekey</FormField.Label>
      <Select name='key' icon={icon} field={{ name: "key" }}>
        {TURNSTILE_TEST_KEYS.map((candidate) => (
          <Select.Option key={candidate.id} value={candidate.id} selected={candidate.id === data.key}>
            {candidate.label}
          </Select.Option>
        ))}
      </Select>
    </FormField>
    <OptionSelect name='size' label='size' icon={icon}>
      {options(SIZES, data.size)}
    </OptionSelect>
    <OptionSelect name='load' label='load' icon={icon}>
      {options(LOADS, data.load)}
    </OptionSelect>
    <OptionSelect name='challenge' label='challenge' icon={icon}>
      {options(CHALLENGES, data.challenge)}
    </OptionSelect>
    <OptionSelect name='appearance' label='appearance' icon={icon}>
      {options(APPEARANCES, data.appearance)}
    </OptionSelect>
    <OptionSelect name='language' label='language' icon={icon}>
      {options(LANGUAGES, data.language)}
    </OptionSelect>
    <FormField name='action' class={OPTION_FIELD}>
      <FormField.Label name='action'>action</FormField.Label>
      <Input name='action' value={data.action} placeholder='signup' field={{ name: "action" }} />
      <FormField.Description name='action'>Letters, digits, underscore and hyphen, up to 32.</FormField.Description>
    </FormField>
    <FormField name='cData' class={OPTION_FIELD}>
      <FormField.Label name='cData'>cData</FormField.Label>
      <Input name='cData' value={data.cData} placeholder='order-4821' field={{ name: "cData" }} />
      <FormField.Description name='cData'>
        Returned by siteverify, so a token can be matched to a record. Up to 255 of the same charset.
      </FormField.Description>
    </FormField>
    <FormField name='responseFieldName' class={OPTION_FIELD}>
      <FormField.Label name='responseFieldName'>responseFieldName</FormField.Label>
      <Input name='responseFieldName' value={data.responseFieldName} placeholder='cf-turnstile-signup' field={{ name: "responseFieldName" }} />
      <FormField.Description name='responseFieldName'>Renames the hidden token input, so two widgets can share one form.</FormField.Description>
    </FormField>
    <FormField name='tabindex' class={OPTION_FIELD}>
      <FormField.Label name='tabindex'>tabindex</FormField.Label>
      <Input type='number' name='tabindex' value={data.tabindex === null ? "" : String(data.tabindex)} field={{ name: "tabindex" }} />
    </FormField>
    <div class='flex gap-2 sm:col-span-2'>
      <Button type='submit' tone='primary'>
        Render widget
      </Button>
      <Button tone='neutral' appearance='outline' asChild>
        <a href={path}>Reset</a>
      </Button>
    </div>
  </Form>
);

/** The configured widget, in the form it is meant to live in. */
const PlaygroundWidget: FC<{ data: TurnstileDemoOptions; paths: ShowcasePaths }> = ({ data, paths }) => (
  <Form
    action={paths.turnstileVerify}
    method='post'
    class='w-full max-w-sm space-y-3'
    {...formSubmit({ post: paths.turnstileVerify, target: `#${SHOW_TURNSTILE_VERDICT_ID}`, swap: SWAP.innerHtml })}>
    <FormField name='email'>
      <FormField.Label name='email'>Email</FormField.Label>
      <Input type='email' name='email' placeholder='you@example.com' field={{ name: "email" }} />
    </FormField>
    <Turnstile
      siteKey={turnstileSiteKey(data)}
      size={data.size}
      load={data.load}
      challenge={data.challenge}
      appearance={data.appearance}
      {...(data.action === "" ? {} : { action: data.action })}
      {...(data.cData === "" ? {} : { cData: data.cData })}
      {...(data.responseFieldName === "" ? {} : { responseFieldName: data.responseFieldName })}
      {...(data.language === "auto" ? {} : { language: data.language })}
      {...(data.tabindex === null ? {} : { tabindex: data.tabindex })}
    />
    <Button type='submit'>Submit</Button>
  </Form>
);

const PlaygroundSection: FC<{ data: TurnstileDemoOptions; paths: ShowcasePaths; icon: DemoIcon }> = ({ data, paths, icon }) => (
  // Not `turnstile`: the DOM publishes every `id` on `window`, and Cloudflare's `api.js` reads
  // `window.turnstile`'s truthiness to decide it has already loaded.
  <CatalogPanel
    id='turnstile-widget'
    title='Turnstile playground'
    description='Every prop the SSR component takes, driven from the query string. The URL is the whole configuration, so a setting worth reporting is a link.'>
    <div class='grid gap-6 lg:grid-cols-2'>
      <OptionsForm data={data} path={paths.turnstile} icon={icon} />
      <div class='space-y-4'>
        <PlaygroundWidget data={data} paths={paths} />
        <pre class='overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground'>
          <code>{turnstileSnippet(data)}</code>
        </pre>
      </div>
    </div>
    <div id={SHOW_TURNSTILE_VERDICT_ID} class='mt-6' />
  </CatalogPanel>
);

// `load='focus'` on the first three, against the eager default: three eager widgets would issue
// three challenges to anyone who scrolls past. The field is not decoration either — under
// `load='focus'` the script waits on a `focusin` within the enclosing form.
const VariantsSection: FC = () => (
  <CatalogPanel
    id='turnstile-variants'
    title='Sizes and modes'
    description='The three widget sizes, each deferred to first focus, and the challenge held back to submit.'>
    <CatalogRow>
      <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
        <Input type='email' name='turnstile-email' placeholder='you@example.com' />
        <Turnstile siteKey={TURNSTILE_PASS_KEY.siteKey} size='normal' load='focus' />
        <Button type='submit'>Submit</Button>
      </Form>
      <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
        <Input type='email' name='turnstile-email-compact' placeholder='you@example.com' />
        <Turnstile siteKey={TURNSTILE_PASS_KEY.siteKey} size='compact' load='focus' />
        <Button type='submit'>Submit</Button>
      </Form>
      <Form action='#' method='post' class='w-full max-w-xs space-y-3'>
        <Input type='email' name='turnstile-email-flexible' placeholder='you@example.com' />
        <Turnstile siteKey={TURNSTILE_PASS_KEY.siteKey} size='flexible' load='focus' />
        <Button type='submit'>Submit</Button>
      </Form>
      {/* `hx-post`, because the deferred challenge is run from htmx's `htmx:confirm` seam and a native
        form has no request to hold; `interaction-only` is the pairing Cloudflare documents for it.
        The eager `load` default is deliberate here, unlike the three demos above: the point of
        `challenge='submit'` is a widget up from page load, holding its own space, with only the
        challenge waiting for the press. */}
      <Form action='#' method='post' hx-post='#' class='w-full max-w-xs space-y-3'>
        <Input type='email' name='turnstile-email-submit' placeholder='you@example.com' />
        <Turnstile siteKey={TURNSTILE_PASS_KEY.siteKey} challenge='submit' appearance='interaction-only' />
        <Button type='submit'>Submit</Button>
      </Form>
    </CatalogRow>
  </CatalogPanel>
);

const KeysSection: FC = () => (
  <CatalogPanel
    id='turnstile-keys'
    title='Test keys'
    description='Cloudflare publishes sitekeys that always reach a fixed outcome. Nothing here is a credential, and no submission on this page is really challenged.'>
    <table class='w-full text-start text-sm'>
      <thead class='text-muted-foreground'>
        <tr>
          <th class='py-2 pe-4 font-medium'>Sitekey</th>
          <th class='py-2 pe-4 font-medium'>Behaviour</th>
        </tr>
      </thead>
      <tbody>
        {TURNSTILE_TEST_KEYS.map((candidate) => (
          <tr key={candidate.id} class='border-t border-border'>
            <td class='py-2 pe-4 font-mono text-xs text-foreground'>{candidate.siteKey}</td>
            <td class='py-2 pe-4 text-muted-foreground'>
              {candidate.label} — {candidate.note}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </CatalogPanel>
);

const ResilienceSection: FC = () => (
  <CatalogPanel
    id='turnstile-resilience'
    title='When the challenge cannot run'
    description='Both messages are server-rendered and hidden; the controller reveals whichever one applies. Block challenges.cloudflare.com and reload to see the first.'>
    <div class='grid gap-4 md:grid-cols-2'>
      <Form action='#' method='post' class='space-y-3'>
        <Input type='email' name='turnstile-email-resilient' placeholder='you@example.com' />
        <Turnstile siteKey={TURNSTILE_PASS_KEY.siteKey} load='focus' unsupported='This browser is too old to run our bot check.'>
          Our bot check could not load. Turn off your blocker for this site and reload.
        </Turnstile>
        <Button type='submit'>Submit</Button>
      </Form>
      <Alert tone='info'>
        <Alert.Title>What the controller does</Alert.Title>
        <Alert.Description>
          A script that has not loaded within ten seconds reveals the fallback. An unsupported browser reveals the second message instead. A render
          that throws leaves the widget dead rather than retrying, and the form still submits — the server refuses it, because verification fails
          closed.
        </Alert.Description>
      </Alert>
    </div>
  </CatalogPanel>
);

/** How the verify round trip ended: the pipeline's own verdict, not the widget's. @public */
export type TurnstileVerdict = { kind: "verified" } | { kind: "rejected"; guard: string; reason: TurnstileFailure } | { kind: "unconfigured" };

// Partial, and keyed by every failure this page can actually reach: the one it cannot — a customer-data
// mismatch, which needs an `expectedCData` the showcase never sets — spells a `data-*` name in source
// that `state-attrs.test.ts` would read as an undeclared state attribute.
const VERDICT_COPY: Partial<Record<TurnstileFailure, string>> = {
  "missing-token": "No token reached the server — the widget never ran, or its hidden field was stripped.",
  "verification-failed": "Cloudflare refused the token. On the always-blocks key this is the expected answer.",
  "hostname-mismatch": "The token was minted for a different host than the one that verified it.",
  "action-mismatch": "The token was minted for a different action than the route expected.",
  "network-error": "Siteverify could not be reached. Forge fails closed, so the submission is still refused.",
  timeout: "Siteverify did not answer inside the budget. Forge fails closed.",
  "parse-error": "Siteverify answered something that was not the documented JSON.",
};

/** The verdict panel the verify action swaps in. @public */
export const TurnstileVerdictFragment: FC<{ verdict: TurnstileVerdict }> = ({ verdict }) => {
  if (verdict.kind === "unconfigured") {
    return (
      <Alert tone='warning'>
        <Alert.Title>No secret key is configured</Alert.Title>
        <Alert.Description>
          The form reached the action, but `registerShowcase` was given no `turnstileSecret`, so nothing was sent to siteverify.
        </Alert.Description>
      </Alert>
    );
  }
  if (verdict.kind === "verified") {
    return (
      <Alert tone='success'>
        <Alert.Title>Verified</Alert.Title>
        <Alert.Description>
          The token in `{TURNSTILE_FIELD_DEFAULT}` passed siteverify and was dropped before validation, so the handler never sees it.
        </Alert.Description>
      </Alert>
    );
  }
  return (
    <Alert tone='destructive'>
      <Alert.Title>Refused by the {verdict.guard} guard</Alert.Title>
      <Alert.Description>{VERDICT_COPY[verdict.reason] ?? "Verification failed."}</Alert.Description>
    </Alert>
  );
};

const VerifySection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <CatalogPanel
    id='turnstile-verify'
    title='The server half'
    description='The playground form above posts here. The route is an ordinary defineAction with turnstile declared, and its onBotDetected reports the reason instead of hiding it.'>
    <pre class='overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground'>
      <code>{`defineAction({\n  schema,\n  turnstile: {\n    secretKey: (_c, config) => config.services.turnstile.secretKey,\n    verify: (c) => ({ expectedHostname: c.url.hostname }),\n  },\n  onBotDetected: (rejection) => refuse(rejection),\n  handle,\n})`}</code>
    </pre>
    <p class='mt-3 text-sm text-muted-foreground'>
      A real route answers every refusal the same way, so a bot cannot read the guard off the response. This one names it, because the point of the
      page is to show which guard spoke. The endpoint is <code class='font-mono text-xs'>{paths.turnstileVerify}</code>.
    </p>
  </CatalogPanel>
);

/** The whole Turnstile page body. @public */
export const TurnstileDemos: FC<{ data: TurnstileDemoOptions; paths: ShowcasePaths; icon: DemoIcon }> = ({ data, paths, icon }) => (
  <div class='space-y-10'>
    <PlaygroundSection data={data} paths={paths} icon={icon} />
    <VariantsSection />
    <ResilienceSection />
    <VerifySection paths={paths} />
    <KeysSection />
  </div>
);
