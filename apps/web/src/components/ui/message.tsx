import type { ComponentProps } from "react";

type MessageAlign = "start" | "end";

function MessageGroup(props: ComponentProps<"div">) {
  return <div data-slot="message-group" {...props} />;
}

function Message({
  align = "start",
  ...props
}: ComponentProps<"article"> & { align?: MessageAlign }) {
  return <article data-slot="message" data-align={align} {...props} />;
}

function MessageAvatar(props: ComponentProps<"div">) {
  return <div data-slot="message-avatar" {...props} />;
}

function MessageContent(props: ComponentProps<"div">) {
  return <div data-slot="message-content" {...props} />;
}

function MessageHeader(props: ComponentProps<"header">) {
  return <header data-slot="message-header" {...props} />;
}

function MessageFooter(props: ComponentProps<"footer">) {
  return <footer data-slot="message-footer" {...props} />;
}

export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
};
