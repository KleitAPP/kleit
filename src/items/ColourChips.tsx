import { Chip } from "@/components/kleit";
import { COLOUR_NAMES, COLOUR_SWATCHES, colourLabel, type ColourName } from "@/items/colour";

/**
 * The sixteen colour words as chips (spec 4.4 #4 on a new photo, 9 #1 as a search filter, and
 * on a piece of your own to correct the guess). A dot shows the colour and the word says it
 * (design pack 8.3 #3: never colour alone). With `none`, a first chip clears the choice.
 */
export function ColourChips({
  value,
  onChange,
  label,
  none,
}: {
  value: ColourName | null;
  onChange: (colour: ColourName | null) => void;
  label: string;
  /** The words of the chip that means "no colour chosen"; absent, there is no such chip. */
  none?: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={label}>
      {none ? (
        <Chip label={none} selected={value === null} onToggle={() => onChange(null)} />
      ) : null}
      {COLOUR_NAMES.map((name) => (
        <Chip
          key={name}
          label={colourLabel(name)}
          swatch={COLOUR_SWATCHES[name]}
          selected={value === name}
          onToggle={() => onChange(value === name && none ? null : name)}
        />
      ))}
    </div>
  );
}
