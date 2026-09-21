import { useId } from "react";

/**
 * The Kleit mark as an inline SVG, in the text colour around it (currentColor).
 * `small` uses the filled-pin variant for 24 px and below (spec 1.1 #7).
 * Never render this inside Creative mode (decision 106).
 */
export function KleitMark({
  size = 32,
  small,
  title = "Kleit",
  className,
}: {
  size?: number;
  small?: boolean;
  title?: string;
  className?: string;
}) {
  const maskId = useId();
  const useSmall = small ?? size <= 24;
  const blade = "M3.5 63 11 53.5C40 45.5 71 43 100 50L19 74Z";
  const hook = "M8.5 34C9 20 14 7 26 7c11.5 0 18.5 6.5 18.5 14 0 7.5-6 11.5-13 10.5";
  const back = "M2.6 31.2 14.4 29.6V129.6c0 7.2-11.8 7.2-11.8 0Z";
  return (
    <svg
      viewBox="0 0 104 140"
      height={size}
      width={(size * 104) / 140}
      role="img"
      aria-label={title}
      className={className}
    >
      {useSmall ? (
        <g fill="currentColor" stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" paintOrder="stroke">
          <path d={back} />
          <path d={blade} />
          <g transform="rotate(24 19 68.5)">
            <path d={blade} transform="matrix(1 0 0 -1 0 137)" />
          </g>
          <path d={hook} fill="none" strokeWidth={14.2} strokeLinecap="round" />
        </g>
      ) : (
        <>
          <defs>
            <mask id={maskId}>
              <rect x={-52} y={-70} width={208} height={280} fill="white" />
              <circle cx={19} cy={68.5} r={4.4} fill="black" />
            </mask>
          </defs>
          <g fill="currentColor" mask={`url(#${maskId})`}>
            <path d={back} />
            <path d={blade} />
            <g transform="rotate(24 19 68.5)">
              <path d={blade} transform="matrix(1 0 0 -1 0 137)" />
            </g>
            <path
              d={hook}
              fill="none"
              stroke="currentColor"
              strokeWidth={11.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </>
      )}
    </svg>
  );
}
