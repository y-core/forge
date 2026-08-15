/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { bindAttrAttr, bindTextAttr } from "../contracts/bind-contract";
import { CONTROLS_DEMO_SCOPE, CONTROLS_DEMO_STATE, controlsReadout } from "../contracts/controls-demo-contract";
import { CheckboxGroup } from "../controls/checkbox-group";
import { Input } from "../controls/input";
import { NumberField } from "../controls/number-field";
import { RadioGroup } from "../controls/radio-group";
import { Select } from "../controls/select";
import { Slider } from "../controls/slider";
import { Switch } from "../controls/switch";
import { Textarea } from "../controls/textarea";
import { Toggle } from "../controls/toggle";
import { ToggleGroup } from "../controls/toggle-group";
import { Button } from "../core/button";
import { fieldId } from "../core/field";
import { Form } from "../core/form";
import { Input as InputPrimitive } from "../core/input";
import { Label } from "../core/label";
import { Resumable } from "../server/resumable";
import { CatalogSection, type ShowIcon } from "./components";

const Readout: FC<{ field: string; value: unknown }> = ({ field, value }) => (
  <output {...bindTextAttr(field)} class='text-sm tabular-nums text-muted-foreground'>
    {controlsReadout(value)}
  </output>
);

interface BoundRowProps {
  field: string;
  label?: string;
  value: unknown;
  children: unknown;
}

const BoundRow: FC<BoundRowProps> = ({ field, label, value, children }) => (
  <div class='w-full max-w-xs space-y-2'>
    <div class='flex items-baseline justify-between gap-3'>
      {label === undefined ? null : <Label for={fieldId(field)}>{label}</Label>}
      <Readout field={field} value={value} />
    </div>
    {children}
  </div>
);

const NativeAndBoundSection: FC = () => (
  <CatalogSection id='native-and-reactive' title='Native vs Bound'>
    <p class='w-full max-w-prose text-sm text-muted-foreground text-pretty'>
      The same control twice: the native one is read by the server on submit, the bound one is read by a signal as it is typed.
    </p>
    <div class='flex-1 min-w-56 space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Native SSR</h3>
      <Form action='#' method='post' class='space-y-2'>
        <Label for={fieldId("native-name")}>Display name</Label>
        <InputPrimitive type='text' name='native-name' field={{ name: "native-name" }} />
        <Button type='submit' size='sm'>
          Save
        </Button>
      </Form>
    </div>
    <div class='flex-1 min-w-56 space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Bound</h3>
      <BoundRow field='mirror' label='Display name' value={CONTROLS_DEMO_STATE.mirror}>
        <Input bind='mirror' type='text' field={{ name: "mirror" }} value={CONTROLS_DEMO_STATE.mirror} />
      </BoundRow>
    </div>
  </CatalogSection>
);

const ControlsInputSection: FC = () => (
  <CatalogSection id='controls-input' title='Bound Input'>
    <BoundRow field='text' label='Name' value={CONTROLS_DEMO_STATE.text}>
      <Input bind='text' type='text' field={{ name: "text" }} value={CONTROLS_DEMO_STATE.text} />
    </BoundRow>
    <BoundRow field='email' label='Email (starts empty)' value={CONTROLS_DEMO_STATE.email}>
      <Input bind='email' type='email' field={{ name: "email" }} value={CONTROLS_DEMO_STATE.email} placeholder='you@example.com' />
    </BoundRow>
  </CatalogSection>
);

const ControlsSelectSection: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <CatalogSection id='controls-select' title='Bound Select'>
    <BoundRow field='unit' label='Unit' value={CONTROLS_DEMO_STATE.unit}>
      <Select bind='unit' field={{ name: "unit" }} icon={icon}>
        <Select.Option value='mm' selected={CONTROLS_DEMO_STATE.unit === "mm"}>
          Millimetres
        </Select.Option>
        <Select.Option value='cm' selected={CONTROLS_DEMO_STATE.unit === "cm"}>
          Centimetres
        </Select.Option>
        <Select.Option value='in' selected={CONTROLS_DEMO_STATE.unit === "in"}>
          Inches
        </Select.Option>
      </Select>
    </BoundRow>
    <BoundRow field='precision' label='Precision' value={CONTROLS_DEMO_STATE.precision}>
      <Select bind='precision' field={{ name: "precision" }} icon={icon}>
        <Select.Option value='mm' selected={CONTROLS_DEMO_STATE.precision === "mm"}>
          Millimetres
        </Select.Option>
        <Select.Option value='in' selected={CONTROLS_DEMO_STATE.precision === "in"}>
          Inches
        </Select.Option>
      </Select>
    </BoundRow>
  </CatalogSection>
);

const ControlsSliderSection: FC = () => (
  <CatalogSection id='controls-slider' title='Bound Slider'>
    <BoundRow field='level' label='Level' value={CONTROLS_DEMO_STATE.level}>
      <Slider bind='level' field={{ name: "level" }} min={0} max={100} value={CONTROLS_DEMO_STATE.level} />
    </BoundRow>
    <BoundRow field='zoom' label='Zoom (stepped)' value={CONTROLS_DEMO_STATE.zoom}>
      <Slider bind='zoom' field={{ name: "zoom" }} min={50} max={200} step={25} value={CONTROLS_DEMO_STATE.zoom} />
    </BoundRow>
  </CatalogSection>
);

const ControlsSwitchSection: FC = () => (
  <CatalogSection id='controls-switch' title='Bound Switch'>
    <BoundRow field='enabled' value={CONTROLS_DEMO_STATE.enabled}>
      <Switch bind='enabled' field={{ name: "enabled" }} checked={CONTROLS_DEMO_STATE.enabled}>
        Snap to grid
      </Switch>
    </BoundRow>
    <BoundRow field='notifications' value={CONTROLS_DEMO_STATE.notifications}>
      <Switch bind='notifications' field={{ name: "notifications" }} checked={CONTROLS_DEMO_STATE.notifications} orientation='label-before'>
        Email notifications
      </Switch>
    </BoundRow>
  </CatalogSection>
);

const ControlsTextareaSection: FC = () => (
  <CatalogSection id='controls-textarea' title='Bound Textarea'>
    <BoundRow field='notes' label='Notes' value={CONTROLS_DEMO_STATE.notes}>
      <Textarea bind='notes' field={{ name: "notes" }} rows={3}>
        {CONTROLS_DEMO_STATE.notes}
      </Textarea>
    </BoundRow>
    <BoundRow field='summary' label='Summary (starts empty)' value={CONTROLS_DEMO_STATE.summary}>
      <Textarea bind='summary' field={{ name: "summary" }} rows={2} placeholder='One line' />
    </BoundRow>
  </CatalogSection>
);

const ControlsToggleGroupSection: FC = () => (
  <CatalogSection id='controls-toggle-group' title='Bound ToggleGroup'>
    <BoundRow field='align' value={CONTROLS_DEMO_STATE.align}>
      <ToggleGroup aria-label='Text alignment'>
        <ToggleGroup.Item bind='align' value='left' pressed={CONTROLS_DEMO_STATE.align === "left"}>
          Left
        </ToggleGroup.Item>
        <ToggleGroup.Item bind='align' value='center' pressed={CONTROLS_DEMO_STATE.align === "center"}>
          Center
        </ToggleGroup.Item>
        <ToggleGroup.Item bind='align' value='right' pressed={CONTROLS_DEMO_STATE.align === "right"}>
          Right
        </ToggleGroup.Item>
      </ToggleGroup>
    </BoundRow>
    <BoundRow field='weight' value={CONTROLS_DEMO_STATE.weight}>
      <ToggleGroup orientation='vertical' aria-label='Font weight'>
        {["regular", "medium", "bold"].map((weight) => (
          <ToggleGroup.Item key={weight} bind='weight' value={weight} pressed={CONTROLS_DEMO_STATE.weight === weight}>
            {weight}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup>
    </BoundRow>
  </CatalogSection>
);

const ControlsNumberFieldSection: FC = () => (
  <CatalogSection id='controls-number-field' title='Bound NumberField'>
    <BoundRow field='count' label='Copies' value={CONTROLS_DEMO_STATE.count}>
      <NumberField>
        <NumberField.Decrement />
        <NumberField.Input bind='count' id={fieldId("count")} name='count' value={CONTROLS_DEMO_STATE.count} min={0} max={9} />
        <NumberField.Increment />
      </NumberField>
    </BoundRow>
  </CatalogSection>
);

const ControlsToggleSection: FC = () => (
  <CatalogSection id='controls-toggle' title='Bound Toggle'>
    <BoundRow field='bold' value={CONTROLS_DEMO_STATE.bold}>
      <Toggle bind='bold' name='bold' pressed={CONTROLS_DEMO_STATE.bold}>
        Bold
      </Toggle>
      {/* The complement of the readout above: same signal, bound to an *attribute* rather than to
          text, so the line disappears the moment the toggle turns on. */}
      <p {...bindAttrAttr("hidden", "bold")} hidden={CONTROLS_DEMO_STATE.bold} class='text-sm text-muted-foreground'>
        Bold is off — this line is bound to <code>hidden</code>.
      </p>
    </BoundRow>
  </CatalogSection>
);

const ControlsRadioGroupSection: FC = () => (
  <CatalogSection id='controls-radio-group' title='Bound RadioGroup'>
    <BoundRow field='plan' value={CONTROLS_DEMO_STATE.plan}>
      <RadioGroup name='plan' aria-label='Plan'>
        {["basic", "standard", "pro"].map((plan) => (
          <RadioGroup.Item key={plan} bind='plan' value={plan} checked={CONTROLS_DEMO_STATE.plan === plan}>
            {plan}
          </RadioGroup.Item>
        ))}
      </RadioGroup>
    </BoundRow>
  </CatalogSection>
);

const ControlsCheckboxGroupSection: FC = () => (
  <CatalogSection id='controls-checkbox-group' title='Bound CheckboxGroup'>
    <BoundRow field='toppings' value={CONTROLS_DEMO_STATE.toppings}>
      <CheckboxGroup name='toppings' aria-label='Toppings'>
        {["olives", "basil", "chilli"].map((topping) => (
          <CheckboxGroup.Item key={topping} bind='toppings' value={topping} checked={CONTROLS_DEMO_STATE.toppings.includes(topping)}>
            {topping}
          </CheckboxGroup.Item>
        ))}
      </CheckboxGroup>
    </BoundRow>
  </CatalogSection>
);

/** The bound-control band: every `ui/controls` variant driven by one resumable scope. @internal */
export const ControlsDemos: FC<{ icon: ShowIcon }> = ({ icon }) => (
  <Resumable name={CONTROLS_DEMO_SCOPE} state={{ ...CONTROLS_DEMO_STATE }} class='space-y-10'>
    <NativeAndBoundSection />
    <ControlsInputSection />
    <ControlsSelectSection icon={icon} />
    <ControlsSliderSection />
    <ControlsSwitchSection />
    <ControlsTextareaSection />
    <ControlsToggleGroupSection />
    <ControlsToggleSection />
    <ControlsNumberFieldSection />
    <ControlsRadioGroupSection />
    <ControlsCheckboxGroupSection />
  </Resumable>
);
