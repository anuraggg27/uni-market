import type { ComponentProps } from "react";

type BubbleAlign = "start" | "end";
type BubbleVariant = "default" | "secondary" | "destructive";

function Bubble({
  align = "start",
  variant = "secondary",
  ...props
}: ComponentProps<"div"> & {
  align?: BubbleAlign;
  variant?: BubbleVariant;
}) {
  return (
    <div
      data-slot="bubble"
      data-align={align}
      data-variant={variant}
      {...props}
    />
  );
}

function BubbleContent(props: ComponentProps<"div">) {
  return <div data-slot="bubble-content" {...props} />;
}

export { Bubble, BubbleContent };
