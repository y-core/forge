/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { Alert } from "../core/alert";
import { Badge } from "../core/badge";
import { Button } from "../core/button";
import { Card } from "../core/card";
import { FormField } from "../core/field-layout";
import { Field } from "../core/field-stack";
import { Form } from "../core/form";
import type { ForgeIcon } from "../core/icon";
import { Select } from "../core/select";
import { Skeleton } from "../core/skeleton";
import { Slider } from "../core/slider";
import { Spinner } from "../core/spinner";
import { Switch } from "../core/switch";
import { Toast } from "../core/toast";
import { CatalogStack } from "./components";

/** The two glyphs this band draws: `Spinner` spins one and `Select` points with the other. */
type CompositionIcon = ForgeIcon<"spinner" | "chevron-down">;

/** Forge's own feedback components, as the corpus every surface below renders. */
const FEEDBACK_ROWS = [
  { name: "Alert", subpath: "ui/core" },
  { name: "FlashOob", subpath: "ui/server" },
  { name: "Skeleton", subpath: "ui/core" },
  { name: "Spinner", subpath: "ui/core" },
  { name: "Toast", subpath: "ui/core" },
];

const RowTable: FC = () => (
  <table class='w-full border-collapse text-sm'>
    <thead>
      <tr class='border-b border-border text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
        <th class='py-2 pe-4'>Component</th>
        <th class='py-2'>Subpath</th>
      </tr>
    </thead>
    <tbody>
      {FEEDBACK_ROWS.map((row) => (
        <tr key={row.name} class='border-b border-border'>
          <td class='py-2 pe-4 font-medium text-foreground'>{row.name}</td>
          <td class='py-2'>
            <Badge appearance='outline'>{row.subpath}</Badge>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** One collection in its four states — populated, empty, loading and failed — shown as siblings. @public */
export const CollectionSurface: FC = () => (
  <CatalogStack id='composition-collection' title='A collection, in all four of its states'>
    <div class='grid gap-4 md:grid-cols-2'>
      <Card>
        <Card.Header>
          <Card.Title>Populated</Card.Title>
          <Card.Description>The layout designed state.</Card.Description>
        </Card.Header>
        <Card.Content>
          <RowTable />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Empty</Card.Title>
          <Card.Description>A state, not an absence.</Card.Description>
        </Card.Header>
        <Card.Content class='space-y-3'>
          <p class='text-sm text-pretty text-muted-foreground'>No components are pinned yet. Pin one from the catalog to start the list.</p>
          <Button tone='neutral' appearance='outline' size='sm'>
            Pin a component
          </Button>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Loading</Card.Title>
          <Card.Description>Shaped to the rows it will become.</Card.Description>
        </Card.Header>
        <Card.Content>
          <div class='space-y-3'>
            {FEEDBACK_ROWS.map((row) => (
              <div key={row.name} class='grid grid-cols-2 gap-4'>
                <Skeleton class='h-4 w-3/4' />
                <Skeleton class='h-4 w-1/2' />
              </div>
            ))}
          </div>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Failed</Card.Title>
          <Card.Description>Names the failure, and offers the way out.</Card.Description>
        </Card.Header>
        <Card.Content class='space-y-3'>
          <Alert tone='destructive'>
            <Alert.Title>Could not load the component list</Alert.Title>
            <Alert.Description>The request did not complete. Nothing was changed, so retrying is safe.</Alert.Description>
          </Alert>
          <Button tone='neutral' appearance='outline' size='sm'>
            Retry
          </Button>
        </Card.Content>
      </Card>
    </div>
  </CatalogStack>
);

/** A settings form: `FormField` where a value is validated, `Field` where a row is only laid out. @public */
export const SettingsSurface: FC<{ icon: CompositionIcon }> = ({ icon }) => (
  <CatalogStack id='composition-form' title='A form that settles the collection above'>
    <Card>
      <Card.Header>
        <Card.Title>Collection settings</Card.Title>
        <Card.Description>Applies to the four cards above.</Card.Description>
      </Card.Header>
      <Card.Content>
        <Form action='#' method='post' csrfToken='demo-token' class='space-y-6'>
          <FormField.Group>
            <FormField name='rows-per-page'>
              <FormField.Label name='rows-per-page'>Rows per page</FormField.Label>
              <Select name='rows-per-page' icon={icon} field={{ name: "rows-per-page", description: true }} class='max-w-xs'>
                <Select.Option value='5' selected>
                  5
                </Select.Option>
                <Select.Option value='10'>10</Select.Option>
                <Select.Option value='25'>25</Select.Option>
              </Select>
              <FormField.Description name='rows-per-page'>How many rows the populated card renders before it paginates.</FormField.Description>
            </FormField>
            <FormField name='row-height'>
              <FormField.Label name='row-height'>Row height</FormField.Label>
              <Slider name='row-height' min={32} max={64} step={4} value={40} output field={{ name: "row-height" }} class='max-w-xs' />
            </FormField>
          </FormField.Group>
          <Field label='Table columns' orientation='horizontal'>
            <Switch name='show-subpath' checked>
              Show subpath
            </Switch>
          </Field>
          <div class='flex justify-end gap-2'>
            <Button tone='neutral' appearance='outline'>
              Reset
            </Button>
            <Button type='submit' tone='primary'>
              Save settings
            </Button>
          </div>
        </Form>
      </Card.Content>
    </Card>
  </CatalogStack>
);

/** Two near-neighbour choices made side by side: `Alert` against `Toast`, `Spinner` against `Skeleton`. @public */
export const FeedbackSurface: FC<{ icon: CompositionIcon }> = ({ icon }) => (
  <CatalogStack id='composition-feedback' title='Two out loud near neighbours'>
    <Card>
      <Card.Header>
        <Card.Title>Alert or Toast</Card.Title>
        <Card.Description>
          The condition on the left is still true until someone dismisses it, so it stays. The one on the right already happened, so it announces
          itself and clears.
        </Card.Description>
      </Card.Header>
      <Card.Content class='space-y-3'>
        <div class='grid gap-4 md:grid-cols-2'>
          <Alert tone='warning'>
            <Alert.Title>Turnstile runs on a test key</Alert.Title>
            <Alert.Description>The widget in the catalog always passes, so no submission here is actually challenged.</Alert.Description>
          </Alert>
          <Toast tone='success'>
            <Toast.Title>Settings saved</Toast.Title>
            <Toast.Description>The collection settings were written.</Toast.Description>
          </Toast>
        </div>
      </Card.Content>
    </Card>
    <Card>
      <Card.Header>
        <Card.Title>Spinner or Skeleton</Card.Title>
        <Card.Description>The test is whether the shape is known.</Card.Description>
      </Card.Header>
      <Card.Content class='space-y-3'>
        <div class='grid items-center gap-4 md:grid-cols-2'>
          <Button tone='neutral' appearance='outline' disabled class='w-fit gap-2'>
            <Spinner icon={icon} size='sm' />
            Saving…
          </Button>
          <div class='space-y-2'>
            <Skeleton class='h-4 w-3/4' />
            <Skeleton class='h-4 w-full' />
          </div>
        </div>
      </Card.Content>
    </Card>
  </CatalogStack>
);

/** The composition band: the catalog's primitives assembled into the surfaces an application ships. @public */
export const CompositionsSection: FC<{ icon: CompositionIcon }> = ({ icon }) => (
  <section id='compositions' class='scroll-mt-24 space-y-6'>
    <h2 class='border-b border-border pb-2 text-xl font-semibold text-foreground'>Compositions</h2>
    <CollectionSurface />
    <SettingsSurface icon={icon} />
    <FeedbackSurface icon={icon} />
  </section>
);
