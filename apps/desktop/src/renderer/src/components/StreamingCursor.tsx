/** Animated cursor shown at the end of streaming text. */
export default function StreamingCursor(): JSX.Element {
  return (
    <span
      className="animate-cursor-blink ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] bg-accent"
      aria-hidden="true"
    />
  )
}
