import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { listingInputSchema, type ListingInput } from "@campus-market/shared";
import { z } from "zod";
import {
  ArrowDown,
  ArrowLeft,
  MoreHorizontal,
  SendHorizontal,
  ShieldCheck,
} from "lucide-react";
import { api, clearCsrf, jsonBody } from "../api";
import { useAuth } from "../auth";
import { shouldFollowNewMessage } from "../chat-scroll";
import { ProductCard } from "../components/ProductCard";
import { ReportButton } from "../components/ReportButton";
import {
  DeleteConfirmationDialog,
  EmptyState,
  ErrorState,
  FieldError,
  Loading,
  SafetyReminder,
  StatusBadge,
  SubmitButton,
} from "../components/UI";

const API_URL = import.meta.env.VITE_API_URL ?? "";
function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<any[]>("/api/categories"),
  });
}

export function ListingFormPage({ edit = false }: { edit?: boolean }) {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const categories = useCategories();
  const existing = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => api<any>(`/api/listings/${listingId}`),
    enabled: edit && Boolean(listingId),
  });
  const [images, setImages] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [serverError, setServerError] = useState("");
  const form = useForm<
    z.input<typeof listingInputSchema>,
    unknown,
    ListingInput
  >({
    resolver: zodResolver(listingInputSchema),
    defaultValues: {
      title: "",
      description: "",
      categoryId: "",
      condition: "GOOD",
      conditionExplanation: "",
      priceType: "FIXED",
      exactPrice: null,
      minimumPrice: null,
      maximumPrice: null,
      negotiable: true,
      location: "",
      brand: "",
      defects: "",
      meetupPoint: "",
    },
  });
  useEffect(() => {
    if (existing.data)
      form.reset({
        title: existing.data.title,
        description: existing.data.description,
        categoryId: existing.data.categoryId,
        condition: existing.data.condition,
        conditionExplanation: existing.data.conditionExplanation ?? "",
        priceType: existing.data.priceType,
        exactPrice: existing.data.exactPrice,
        minimumPrice: existing.data.minimumPrice,
        maximumPrice: existing.data.maximumPrice,
        negotiable: existing.data.negotiable,
        location: existing.data.location,
        brand: existing.data.brand ?? "",
        defects: existing.data.defects ?? "",
        meetupPoint: existing.data.meetupPoint ?? "",
      });
  }, [existing.data, form]);
  const priceType = form.watch("priceType");
  const condition = form.watch("condition");
  async function uploadFiles(id: string) {
    for (const file of images) {
      const ticket = await api<any>(`/api/uploads/listings/${id}/presign`, {
        method: "POST",
        ...jsonBody({ mimeType: file.type, byteSize: file.size }),
      });
      const uploaded = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: ticket.headers,
        body: file,
      });
      if (!uploaded.ok) throw new Error("Image upload failed");
      await api(`/api/uploads/listings/${id}/finalize`, {
        method: "POST",
        ...jsonBody({ imageId: ticket.imageId }),
      });
    }
  }
  async function submit(values: ListingInput) {
    setServerError("");
    setUploading(true);
    try {
      const listing = edit
        ? await api<any>(`/api/listings/${listingId}`, {
            method: "PATCH",
            ...jsonBody(values),
          })
        : await api<any>("/api/listings", {
            method: "POST",
            ...jsonBody(values),
          });
      if (images.length) await uploadFiles(listing.id);
      navigate(`/listing/${listing.id}`);
    } catch (error: any) {
      setServerError(error.message);
    } finally {
      setUploading(false);
    }
  }
  if (existing.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (existing.isError)
    return (
      <div className="page">
        <ErrorState error={existing.error} />
      </div>
    );
  return (
    <div className="page narrow">
      <div className="page-header">
        <div>
          <p className="eyebrow">{edit ? "Update" : "Sell"}</p>
          <h1>{edit ? "Edit your listing" : "List a product"}</h1>
          <p className="lede">
            One clear page, saved as a private draft. Every submitted listing is
            manually reviewed.
          </p>
        </div>
      </div>
      <form className="form" onSubmit={form.handleSubmit(submit)}>
        <fieldset className="fieldset">
          <legend>Photos</legend>
          <label className="field">
            <span>
              Product images{" "}
              {edit
                ? "(additions require reapproval)"
                : "(required before submission)"}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) =>
                setImages(Array.from(e.target.files ?? []).slice(0, 8))
              }
            />
            <p className="hint">
              JPEG, PNG or WebP. Up to 8 images, 5 MB each. Metadata is removed.
            </p>
          </label>
          {images.length ? (
            <div className="row">
              {images.map((file) => (
                <span className="status" key={`${file.name}-${file.size}`}>
                  {file.name}
                </span>
              ))}
            </div>
          ) : null}
        </fieldset>
        <fieldset className="fieldset form">
          <legend>Product details</legend>
          <label className="field">
            <span>Title</span>
            <input {...form.register("title")} autoComplete="off" />
            <FieldError>{form.formState.errors.title?.message}</FieldError>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea {...form.register("description")} />
            <FieldError>
              {form.formState.errors.description?.message}
            </FieldError>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Category</span>
              <select {...form.register("categoryId")}>
                <option value="">Choose category</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <FieldError>
                {form.formState.errors.categoryId?.message}
              </FieldError>
            </label>
            <label className="field">
              <span>Condition</span>
              <select {...form.register("condition")}>
                <option value="NEW">New</option>
                <option value="LIKE_NEW">Like new</option>
                <option value="GOOD">Good</option>
                <option value="FAIR">Fair</option>
                <option value="POOR">Poor</option>
              </select>
            </label>
          </div>
          {["FAIR", "POOR"].includes(condition) ? (
            <label className="field">
              <span>Explain the condition</span>
              <textarea {...form.register("conditionExplanation")} />
              <FieldError>
                {form.formState.errors.conditionExplanation?.message}
              </FieldError>
            </label>
          ) : null}
          <div className="form-grid">
            <label className="field">
              <span>Brand (optional)</span>
              <input {...form.register("brand")} />
            </label>
            <label className="field">
              <span>Known defects (optional)</span>
              <input {...form.register("defects")} />
            </label>
          </div>
        </fieldset>
        <fieldset className="fieldset form">
          <legend>Price</legend>
          <div className="row">
            {(["FIXED", "RANGE", "FREE"] as const).map((value) => (
              <label className="row" key={value}>
                <input
                  type="radio"
                  value={value}
                  {...form.register("priceType")}
                />
                {value[0] + value.slice(1).toLowerCase()}
              </label>
            ))}
          </div>
          {priceType === "FIXED" ? (
            <label className="field">
              <span>Price (₹)</span>
              <input
                type="number"
                {...form.register("exactPrice", { valueAsNumber: true })}
              />
              <FieldError>
                {form.formState.errors.exactPrice?.message}
              </FieldError>
            </label>
          ) : null}
          {priceType === "RANGE" ? (
            <div className="form-grid">
              <label className="field">
                <span>Minimum (₹)</span>
                <input
                  type="number"
                  {...form.register("minimumPrice", { valueAsNumber: true })}
                />
                <FieldError>
                  {form.formState.errors.minimumPrice?.message}
                </FieldError>
              </label>
              <label className="field">
                <span>Maximum (₹)</span>
                <input
                  type="number"
                  {...form.register("maximumPrice", { valueAsNumber: true })}
                />
              </label>
            </div>
          ) : null}
          {priceType !== "FREE" ? (
            <label className="row">
              <input type="checkbox" {...form.register("negotiable")} />
              Price is negotiable
            </label>
          ) : null}
        </fieldset>
        <fieldset className="fieldset form">
          <legend>General location</legend>
          <label className="field">
            <span>Campus, hostel area or neighbourhood</span>
            <input
              {...form.register("location")}
              placeholder="Bidholi campus"
            />
            <p className="hint">
              Never enter a room number, home address or live location.
            </p>
            <FieldError>{form.formState.errors.location?.message}</FieldError>
          </label>
          <label className="field">
            <span>Preferred public meetup point (optional)</span>
            <input
              {...form.register("meetupPoint")}
              placeholder="Main gate security desk"
            />
          </label>
        </fieldset>
        <SafetyReminder />
        {serverError ? <p className="field-error">{serverError}</p> : null}
        <div className="row between">
          <Link className="button secondary" to="/my-listings">
            Cancel
          </Link>
          <SubmitButton pending={form.formState.isSubmitting || uploading}>
            {edit ? "Save changes" : "Save private draft"}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

const tabs = [
  "DRAFT",
  "PENDING",
  "ACTIVE",
  "RESERVED",
  "SOLD",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
];
export function MyListingsPage() {
  const [tab, setTab] = useState("DRAFT");
  const [listingToDelete, setListingToDelete] = useState<{ id: string; title: string } | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["my-listings"],
    queryFn: () => api<any[]>("/api/my-listings"),
  });
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) =>
      api(`/api/listings/${id}/${type}`, { method: "POST" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["my-listings"] }),
  });
  const deleteListing = useMutation({
    mutationFn: (id: string) => api(`/api/listings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setListingToDelete(null);
      void client.invalidateQueries({ queryKey: ["my-listings"] });
    },
  });
  const items =
    query.data?.filter((item) =>
      tab === "PENDING"
        ? item.moderationState === "PENDING" && item.lifecycleState === "DRAFT"
        : tab === "REJECTED"
          ? item.moderationState === "REJECTED"
          : item.lifecycleState === tab,
    ) ?? [];
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Selling</p>
          <h1>My listings</h1>
        </div>
        <Link className="button primary" to="/sell">
          Create listing
        </Link>
      </div>
      <div className="tabs" role="tablist" aria-label="Listing status">
        {tabs.map((value) => (
          <button
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            key={value}
            onClick={() => setTab(value)}
          >
            {value.replaceAll("_", " ")}
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !items.length ? (
        <EmptyState
          title={`No ${tab.toLowerCase().replaceAll("_", " ")} listings`}
          body="Your listings will be organized here by their current status."
          action={
            tab === "DRAFT" ? (
              <Link className="button primary" to="/sell">
                Create a listing
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="list">
          {items.map((item) => (
            <article className="list-item" key={item.id}>
              {item.coverImageUrl ? (
                <img src={item.coverImageUrl} alt="" />
              ) : (
                <div />
              )}
              <div>
                <h3>
                  <Link to={`/listing/${item.id}`}>{item.title}</Link>
                </h3>
                <div className="row">
                  <StatusBadge value={item.moderationState} />
                  <StatusBadge value={item.lifecycleState} />
                </div>
                {item.rejectionReason ? (
                  <p>Reason: {item.rejectionReason}</p>
                ) : null}
                <p>
                  {item.viewCount} views · {item.favouriteCount} saves
                </p>
              </div>
              <div className="row">
                <Link
                  className="button small secondary"
                  to={`/listing/${item.id}/edit`}
                >
                  Edit
                </Link>
                <button
                  className="button small danger"
                  onClick={() => setListingToDelete({ id: item.id, title: item.title })}
                  disabled={deleteListing.isPending}
                >
                  Delete
                </button>
                {item.lifecycleState === "DRAFT" ? (
                  <button
                    className="button small primary"
                    onClick={() =>
                      action.mutate({ id: item.id, type: "submit" })
                    }
                  >
                    Submit for review
                  </button>
                ) : null}
                {item.lifecycleState === "ACTIVE" ? (
                  <button
                    className="button small danger"
                    onClick={() =>
                      action.mutate({ id: item.id, type: "withdraw" })
                    }
                  >
                    Withdraw
                  </button>
                ) : null}
                {["SOLD", "EXPIRED", "WITHDRAWN"].includes(
                  item.lifecycleState,
                ) ? (
                  <button
                    className="button small secondary"
                    onClick={() =>
                      action.mutate({ id: item.id, type: "duplicate" })
                    }
                  >
                    Duplicate
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <DeleteConfirmationDialog
        open={Boolean(listingToDelete)}
        onOpenChange={(open) => { if (!open) setListingToDelete(null); }}
        title="Delete listing?"
        description={`Are you sure you want to delete "${listingToDelete?.title ?? "this listing"}"?`}
        pending={deleteListing.isPending}
        onConfirm={() => { if (listingToDelete) deleteListing.mutate(listingToDelete.id); }}
      />      {action.error || deleteListing.error ? (
        <p className="field-error">{(action.error ?? deleteListing.error)?.message}</p>
      ) : null}
    </div>
  );
}

export function SavedPage() {
  const query = useQuery({
    queryKey: ["favourites"],
    queryFn: () => api<any[]>("/api/favourites"),
  });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Shortlist</p>
          <h1>Saved products</h1>
        </div>
      </div>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !query.data?.length ? (
        <EmptyState
          title="Nothing saved yet"
          body="Save products while browsing to compare them later."
          action={
            <Link className="button primary" to="/browse">
              Browse products
            </Link>
          }
        />
      ) : (
        <div className="product-grid">
          {query.data.map((item) => (
            <ProductCard key={item.id} listing={item} />
          ))}
        </div>
      )}
    </div>
  );
}

let chatSocket: Socket | undefined;
function socket() {
  if (!chatSocket)
    chatSocket = io(API_URL, { withCredentials: true, autoConnect: true });
  return chatSocket;
}

type ChatConversation = {
  id: string;
  listingId: string;
  listingTitle: string;
  lifecycleState: string;
  otherUserId: string;
  otherName: string;
  unread: number;
  coverImageUrl: string | null;
  lastMessageAt: string;
};

type ChatMessage = {
  id: string;
  clientId: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
};

type RealtimeState = "connecting" | "connected" | "offline";

export function ChatsPage() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const activeConversation = useRef(conversationId);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeState>("connecting");
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<ChatConversation[]>("/api/conversations"),
    refetchInterval: realtimeState === "connected" ? false : 5_000,
  });
  const selectedConversation = conversations.data?.find(
    (conversation) => conversation.id === conversationId,
  );

  useEffect(() => {
    activeConversation.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    const realtime = socket();
    const connected = () => setRealtimeState("connected");
    const disconnected = () => setRealtimeState("connecting");
    const unavailable = () => setRealtimeState("offline");
    const receive = (message: ChatMessage) => {
      const openConversation = activeConversation.current;
      if (message.conversationId === openConversation) {
        client.setQueryData<ChatMessage[]>(
          ["messages", openConversation],
          (current = []) =>
            current.some((item) => item.id === message.id)
              ? current
              : [...current, message],
        );
        realtime.emit("conversation:read", openConversation);
      }

      const currentConversations = client.getQueryData<ChatConversation[]>([
        "conversations",
      ]);
      if (
        !currentConversations?.some(
          (item) => item.id === message.conversationId,
        )
      ) {
        void client.invalidateQueries({ queryKey: ["conversations"] });
      } else {
        client.setQueryData<ChatConversation[]>(
          ["conversations"],
          (current = []) => {
            const updated = current.map((item) =>
              item.id === message.conversationId
                ? {
                    ...item,
                    lastMessageAt: message.createdAt,
                    unread:
                      message.conversationId === openConversation ||
                      message.senderId === user?.id
                        ? 0
                        : item.unread + 1,
                  }
                : item,
            );
            return updated.sort(
              (a, b) =>
                new Date(b.lastMessageAt).getTime() -
                new Date(a.lastMessageAt).getTime(),
            );
          },
        );
      }
    };

    realtime.on("connect", connected);
    realtime.on("disconnect", disconnected);
    realtime.on("connect_error", unavailable);
    realtime.on("message:new", receive);
    if (realtime.connected) connected();
    else realtime.connect();

    return () => {
      realtime.off("connect", connected);
      realtime.off("disconnect", disconnected);
      realtime.off("connect_error", unavailable);
      realtime.off("message:new", receive);
      realtime.disconnect();
    };
  }, [client, user?.id]);

  return (
    <div className="page chat-page">
      <div className={`chat-shell ${conversationId ? "has-conversation" : ""}`}>
        <aside className="conversation-list" aria-label="Conversations">
          <header className="inbox-header">
            <div>
              <p className="eyebrow">Private</p>
              <h1>Messages</h1>
            </div>
            <span
              className={`realtime-state ${realtimeState}`}
              role="status"
              aria-live="polite"
            >
              <span aria-hidden="true" />
              {realtimeState === "connected"
                ? "Live"
                : realtimeState === "offline"
                  ? "Retrying"
                  : "Connecting"}
            </span>
          </header>
          {conversations.isLoading ? (
            <Loading />
          ) : conversations.isError ? (
            <ErrorState error={conversations.error} />
          ) : !conversations.data?.length ? (
            <EmptyState
              title="No conversations"
              body="Contact a seller from an active listing to start chatting."
            />
          ) : (
            conversations.data.map((c) => (
              <Link
                className={`conversation-link ${conversationId === c.id ? "active" : ""}`}
                to={`/chats/${c.id}`}
                key={c.id}
              >
                {c.coverImageUrl ? (
                  <img
                    className="conversation-image"
                    src={c.coverImageUrl}
                    alt=""
                    width="52"
                    height="52"
                  />
                ) : (
                  <span className="conversation-image" aria-hidden="true">
                    {c.otherName[0]}
                  </span>
                )}
                <span className="conversation-copy">
                  <span className="conversation-name-row">
                    <strong>{c.otherName}</strong>
                    <time>
                      {new Intl.DateTimeFormat(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(c.lastMessageAt))}
                    </time>
                  </span>
                  <small>{c.listingTitle}</small>
                </span>
                {c.unread ? (
                  <span
                    className="status"
                    aria-label={`${c.unread} unread messages`}
                  >
                    {c.unread}
                  </span>
                ) : null}
              </Link>
            ))
          )}
        </aside>
        {conversationId ? (
          <ChatPanel
            id={conversationId}
            conversation={selectedConversation}
            realtimeState={realtimeState}
          />
        ) : (
          <div className="chat-panel">
            <EmptyState
              title="Choose a conversation"
              body="Messages and listing details will appear here."
            />
          </div>
        )}
      </div>
    </div>
  );
}
function ChatPanel({
  id,
  conversation,
  realtimeState,
}: {
  id: string;
  conversation: ChatConversation | undefined;
  realtimeState: RealtimeState;
}) {
  const { user } = useAuth();
  const client = useQueryClient();
  const messagesElement = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const initialScrollComplete = useRef(false);
  const latestMessage = useRef<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const query = useQuery({
    queryKey: ["messages", id],
    queryFn: () => api<ChatMessage[]>(`/api/conversations/${id}/messages`),
    refetchInterval: realtimeState === "connected" ? false : 5_000,
  });
  const block = useMutation({
    mutationFn: () =>
      api(`/api/blocks/${conversation?.otherUserId}`, { method: "POST" }),
  });

  const receiveMessage = useCallback((message: ChatMessage) => {
    setOptimistic((current) =>
      current.filter((item) => item.clientId !== message.clientId),
    );
    client.setQueryData<ChatMessage[]>(["messages", id], (current = []) =>
      current.some((item) => item.id === message.id)
        ? current
        : [...current, message],
    );
  }, [client, id]);

  useEffect(() => {
    const realtime = socket();
    const subscribe = () => {
      realtime.emit("conversation:subscribe", id, (result: { ok: boolean }) => {
        if (result?.ok) realtime.emit("conversation:read", id);
      });
    };
    const listener = (message: ChatMessage) => {
      if (message.conversationId === id) receiveMessage(message);
    };
    realtime.on("connect", subscribe);
    realtime.on("message:new", listener);
    if (realtime.connected) subscribe();
    else realtime.connect();
    return () => {
      realtime.off("connect", subscribe);
      realtime.off("message:new", listener);
    };
  }, [id, receiveMessage]);

  useEffect(() => {
    initialScrollComplete.current = false;
    latestMessage.current = undefined;
    nearBottom.current = true;
    setHasNewMessages(false);
  }, [id]);

  useEffect(() => {
    if (!query.isSuccess) return;
    client.setQueryData<ChatConversation[]>(["conversations"], (current = []) =>
      current.map((item) => (item.id === id ? { ...item, unread: 0 } : item)),
    );
  }, [client, id, query.isSuccess]);

  const all = useMemo(() => {
    const merged = [...(query.data ?? []), ...optimistic];
    const seen = new Set<string>();
    return merged.filter((message) => {
      const identity = message.clientId || message.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [optimistic, query.data]);

  useEffect(() => {
    if (!query.isSuccess) return;
    const container = messagesElement.current;
    if (!container) return;
    const newest = all.at(-1);
    const identity = newest?.clientId || newest?.id;

    if (!initialScrollComplete.current) {
      const frame = requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        initialScrollComplete.current = true;
        latestMessage.current = identity;
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!identity || identity === latestMessage.current) return;
    latestMessage.current = identity;
    if (
      newest &&
      shouldFollowNewMessage(nearBottom.current, newest.senderId, user?.id)
    ) {
      const frame = requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
        setHasNewMessages(false);
      });
      return () => cancelAnimationFrame(frame);
    }
    setHasNewMessages(true);
  }, [all, query.isSuccess, user?.id]);

  function deliver(body: string, clientId: string) {
    const pendingMessage: ChatMessage = {
      id: clientId,
      clientId,
      conversationId: id,
      body,
      senderId: user?.id ?? "",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setOptimistic((current) => {
      const exists = current.some((message) => message.clientId === clientId);
      return exists
        ? current.map((message) =>
            message.clientId === clientId
              ? { ...message, pending: true, failed: false }
              : message,
          )
        : [...current, pendingMessage];
    });
    socket()
      .timeout(8_000)
      .emit(
      "message:send",
      { conversationId: id, clientId, body },
        (error: Error | null, result: { ok: boolean; data?: ChatMessage }) => {
          if (!error && result?.ok && result.data) {
            receiveMessage(result.data);
            return;
          }
          setOptimistic((current) =>
            current.map((message) =>
              message.clientId === clientId
                ? { ...message, pending: false, failed: true }
                : message,
            ),
          );
        },
      );
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    deliver(body, crypto.randomUUID());
  }

  function jumpToLatest() {
    const container = messagesElement.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    nearBottom.current = true;
    setHasNewMessages(false);
  }

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <Link className="chat-back" to="/chats" aria-label="Back to chats">
          <ArrowLeft aria-hidden="true" />
        </Link>
        {conversation?.coverImageUrl ? (
          <img
            className="chat-listing-image"
            src={conversation.coverImageUrl}
            alt=""
            width="44"
            height="44"
          />
        ) : (
          <span className="chat-listing-image" aria-hidden="true" />
        )}
        <div className="chat-context">
          <strong>{conversation?.otherName ?? "Conversation"}</strong>
          {conversation ? (
            <Link to={`/listing/${conversation.listingId}`}>
              {conversation.listingTitle}
            </Link>
          ) : (
            <span>Loading listing…</span>
          )}
        </div>
        <span
          className={`realtime-state chat-realtime ${realtimeState}`}
          role="status"
        >
          <span aria-hidden="true" />
          {realtimeState === "connected" ? "Live" : "Reconnecting"}
        </span>
        <details className="chat-actions">
          <summary aria-label="Conversation actions">
            <MoreHorizontal aria-hidden="true" />
          </summary>
          <div className="chat-actions-menu">
            <ReportButton
              targetType="CONVERSATION"
              targetId={id}
              label="Report chat"
            />
            {conversation?.otherUserId ? (
              <button
                className="button small danger"
                type="button"
                onClick={() => block.mutate()}
                disabled={block.isPending || block.isSuccess}
              >
                {block.isSuccess ? "Blocked" : "Block user"}
              </button>
            ) : null}
            {block.error ? (
              <p className="field-error">{block.error.message}</p>
            ) : null}
          </div>
        </details>
      </header>
      <div className="messages-wrap">
        <div
          className="messages"
          ref={messagesElement}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(event) => {
            const element = event.currentTarget;
            nearBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              96;
            if (nearBottom.current) setHasNewMessages(false);
          }}
        >
          <div className="chat-safety-note">
            <ShieldCheck aria-hidden="true" />
            <span>Meet in public, inspect before paying & never share an OTP.</span>
          </div>
          {query.isLoading ? (
            <Loading label="Loading messages" />
          ) : query.isError ? (
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          ) : !all.length ? (
            <EmptyState
              title="Start the conversation"
              body="Ask a clear question about the product."
            />
          ) : (
            all.map((message) => (
              <article
                className={`bubble ${message.senderId === user?.id ? "mine" : ""} ${message.failed ? "failed" : ""}`}
                key={message.clientId || message.id}
              >
                <p>{message.body}</p>
                <footer>
                  <time dateTime={message.createdAt}>
                    {message.failed
                      ? "Not sent"
                      : message.pending
                        ? "Sending…"
                        : new Intl.DateTimeFormat(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(message.createdAt))}
                  </time>
                  {message.failed ? (
                    <button
                      type="button"
                      onClick={() => deliver(message.body, message.clientId)}
                    >
                      Retry
                    </button>
                  ) : null}
                </footer>
              </article>
            ))
          )}
        </div>
        {hasNewMessages ? (
          <button
            className="new-message-jump"
            type="button"
            onClick={jumpToLatest}
          >
            <ArrowDown aria-hidden="true" />
            New messages
          </button>
        ) : null}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          autoComplete="off"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onInput={(event) => {
            const element = event.currentTarget;
            element.style.height = "auto";
            element.style.height = `${Math.min(element.scrollHeight, 112)}px`;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Write a message…"
        />
        <button
          className="button primary chat-send"
          type="submit"
          disabled={!draft.trim()}
        >
          <SendHorizontal aria-hidden="true" />
          Send
        </button>
      </form>
    </section>
  );
}

export function TransactionsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api<any[]>("/api/transactions"),
  });
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`/api/transactions/${id}/${action}`, { method: "POST" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["transactions"] }),
  });
  const review = useMutation({
    mutationFn: ({
      id,
      rating,
      text,
    }: {
      id: string;
      rating: number;
      text: string;
    }) =>
      api(`/api/transactions/${id}/reviews`, {
        method: "POST",
        ...jsonBody({ rating, text, tags: [] }),
      }),
  });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Offline exchange</p>
          <h1>Transactions</h1>
        </div>
      </div>
      <SafetyReminder />
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !query.data?.length ? (
        <EmptyState
          title="No purchase requests"
          body="Request to buy an active listing to begin a transaction."
        />
      ) : (
        <div className="stack section">
          {query.data.map((tx) => (
            <article className="panel" key={tx.id}>
              <div className="row between">
                <div>
                  <h2>{tx.listingTitle}</h2>
                  <p>
                    {tx.role === "BUYER" ? "You are buying" : "You are selling"}
                  </p>
                </div>
                <StatusBadge value={tx.status} />
              </div>
              <div className="row">
                {tx.role === "SELLER" && tx.status === "REQUESTED" ? (
                  <button
                    className="button primary"
                    onClick={() =>
                      action.mutate({ id: tx.id, action: "accept" })
                    }
                  >
                    Accept and reserve
                  </button>
                ) : null}
                {tx.role === "SELLER" && tx.status === "RESERVED" ? (
                  <button
                    className="button primary"
                    onClick={() =>
                      action.mutate({ id: tx.id, action: "handover" })
                    }
                  >
                    Mark handed over
                  </button>
                ) : null}
                {tx.role === "BUYER" && tx.status === "HANDED_OVER" ? (
                  <button
                    className="button primary"
                    onClick={() =>
                      action.mutate({ id: tx.id, action: "complete" })
                    }
                  >
                    Confirm receipt
                  </button>
                ) : null}
                {["REQUESTED", "ACCEPTED", "RESERVED"].includes(tx.status) ? (
                  <button
                    className="button danger"
                    onClick={() =>
                      action.mutate({ id: tx.id, action: "cancel" })
                    }
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {tx.status === "COMPLETED" ? (
                <form
                  className="form-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    review.mutate({
                      id: tx.id,
                      rating: Number(f.get("rating")),
                      text: String(f.get("text")),
                    });
                  }}
                >
                  <label className="field">
                    <span>Rating</span>
                    <select name="rating">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} stars
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Short review</span>
                    <input
                      name="text"
                      minLength={2}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button secondary">
                    Leave verified review
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {action.error ? (
        <p className="field-error">{action.error.message}</p>
      ) : null}
      {review.error ? (
        <p className="field-error">{review.error.message}</p>
      ) : null}
      {review.isSuccess ? <p role="status">Review submitted.</p> : null}
    </div>
  );
}

export function ProfilePage({ onboarding = false }: { onboarding?: boolean }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (data: any) =>
      api("/api/auth/me", { method: "PATCH", ...jsonBody(data) }),
    onSuccess: async () => {
      await refresh();
      if (onboarding) navigate("/settings?verify=phone");
    },
  });
  if (!user) return null;
  return (
    <div className="page narrow">
      <div className="page-header">
        <div>
          <p className="eyebrow">{onboarding ? "One quick step" : "Account"}</p>
          <h1>{onboarding ? "Confirm your name" : "Your profile"}</h1>
          <p className="lede">
            Institution details are optional and never restrict registration.
          </p>
        </div>
      </div>
      <form
        className="form panel"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          mutation.mutate({
            displayName: String(f.get("displayName")),
            institution: String(f.get("institution")) || null,
            campus: String(f.get("campus")) || null,
            graduationYear: f.get("graduationYear")
              ? Number(f.get("graduationYear"))
              : null,
            onboardingComplete: true,
          });
        }}
      >
        <label className="field">
          <span>Display name</span>
          <input
            name="displayName"
            defaultValue={user.displayName}
            required
            minLength={2}
            maxLength={80}
          />
        </label>
        <label className="field">
          <span>College or institution (optional)</span>
          <input name="institution" defaultValue={user.institution ?? ""} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Campus (optional)</span>
            <input name="campus" defaultValue={user.campus ?? ""} />
          </label>
          <label className="field">
            <span>Graduation year (optional)</span>
            <input
              name="graduationYear"
              type="number"
              min={2020}
              max={2040}
              defaultValue={user.graduationYear ?? ""}
            />
          </label>
        </div>
        <SubmitButton pending={mutation.isPending}>
          {onboarding ? "Continue" : "Save profile"}
        </SubmitButton>
        {mutation.error ? (
          <p className="field-error">{mutation.error.message}</p>
        ) : null}
      </form>
    </div>
  );
}

export function NotificationsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<any[]>("/api/notifications"),
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      api(`/api/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const all = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Updates</p>
          <h1>Notifications</h1>
        </div>
        <button className="button secondary" onClick={() => all.mutate()}>
          Mark all read
        </button>
      </div>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !query.data?.length ? (
        <EmptyState
          title="You’re all caught up"
          body="Marketplace and support updates will appear here."
        />
      ) : (
        <div className="list">
          {query.data.map((n) => (
            <article className="list-item" key={n.id}>
              <div />
              <div>
                <Link
                  to={n.href}
                  onClick={() => !n.readAt && read.mutate(n.id)}
                >
                  <h3>
                    {n.title}
                    {!n.readAt ? (
                      <span className="sr-only"> Unread</span>
                    ) : null}
                  </h3>
                  <p>{n.body}</p>
                  <span className="meta">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </Link>
              </div>
              {!n.readAt ? (
                <button
                  className="button small secondary"
                  onClick={() => read.mutate(n.id)}
                >
                  Mark read
                </button>
              ) : (
                <StatusBadge value="READ" />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function SupportPage() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["support"],
    queryFn: () => api<any[]>("/api/support"),
  });
  const create = useMutation({
    mutationFn: (data: any) =>
      api<any>("/api/support", { method: "POST", ...jsonBody(data) }),
    onSuccess: (ticket) => navigate(`/support/${ticket.id}`),
  });
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Help</p>
          <h1>Support</h1>
        </div>
      </div>
      <div className="detail-grid">
        <section>
          <h2>Your requests</h2>
          {query.isLoading ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState error={query.error} />
          ) : !query.data?.length ? (
            <EmptyState
              title="No support requests"
              body="Open a request and the team will respond here."
            />
          ) : (
            <div className="list">
              {query.data.map((t) => (
                <Link className="list-item" key={t.id} to={`/support/${t.id}`}>
                  <div />
                  <div>
                    <h3>{t.subject}</h3>
                    <p>{t.category}</p>
                  </div>
                  <StatusBadge value={t.status} />
                </Link>
              ))}
            </div>
          )}
        </section>
        <form
          className="panel form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              category: String(f.get("category")),
              subject: String(f.get("subject")),
              description: String(f.get("description")),
            });
          }}
        >
          <h2>Open a support request</h2>
          <label className="field">
            <span>Category</span>
            <select name="category">
              <option value="ACCOUNT">Account</option>
              <option value="LISTING">Listing</option>
              <option value="TRANSACTION">Transaction</option>
              <option value="SAFETY">Safety</option>
              <option value="TECHNICAL">Technical</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Subject</span>
            <input name="subject" minLength={4} maxLength={120} required />
          </label>
          <label className="field">
            <span>Describe the issue</span>
            <textarea
              name="description"
              minLength={20}
              maxLength={5000}
              required
            />
          </label>
          <SubmitButton pending={create.isPending}>Open request</SubmitButton>
          {create.error ? (
            <p className="field-error">{create.error.message}</p>
          ) : null}
        </form>
      </div>
    </div>
  );
}

export function SupportDetailPage() {
  const { ticketId } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["support", ticketId],
    queryFn: () => api<any>(`/api/support/${ticketId}`),
  });
  const reply = useMutation({
    mutationFn: (body: string) =>
      api(`/api/support/${ticketId}/messages`, {
        method: "POST",
        ...jsonBody({ body }),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["support", ticketId] }),
  });
  if (query.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} />
      </div>
    );
  const t = query.data;
  return (
    <div className="page narrow">
      <Link to="/support">← All support requests</Link>
      <div className="page-header">
        <div>
          <h1>{t.subject}</h1>
          <p>{t.description}</p>
        </div>
        <StatusBadge value={t.status} />
      </div>
      <div className="stack">
        {t.messages.length ? (
          t.messages.map((m: any) => (
            <article className="panel" key={m.id}>
              <strong>{m.senderName}</strong>
              <p>{m.body}</p>
              <span className="meta">
                {new Date(m.createdAt).toLocaleString()}
              </span>
              {m.senderId !== user?.id ? (
                <ReportButton
                  targetType="SUPPORT_RESPONSE"
                  targetId={m.id}
                  label="Report response"
                />
              ) : null}
            </article>
          ))
        ) : (
          <EmptyState
            title="No replies yet"
            body="Your request is queued. You do not need to keep this page open."
          />
        )}
      </div>
      {t.status !== "CLOSED" ? (
        <form
          className="composer panel section"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "body",
            ) as HTMLTextAreaElement;
            reply.mutate(input.value);
            input.value = "";
          }}
        >
          <textarea
            name="body"
            required
            maxLength={5000}
            placeholder="Add a reply"
          />
          <button className="button primary">Reply</button>
        </form>
      ) : null}
    </div>
  );
}

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const send = useMutation({
    mutationFn: () =>
      api<{ retryAfter: number }>("/api/phone/send", {
        method: "POST",
        ...jsonBody({ phone }),
      }),
    onSuccess: ({ retryAfter }) => {
      setCodeSent(true);
      setResendCooldown(retryAfter);
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      api("/api/phone/verify", {
        method: "POST",
        ...jsonBody({ phone, code }),
      }),
    onSuccess: () => void refresh(),
  });
  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      clearCsrf();
      navigate("/");
      void refresh();
    },
  });
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setResendCooldown((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);
  return (
    <div className="page narrow">
      <div className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Settings</h1>
        </div>
      </div>
      <section className="panel form">
        <h2>Phone verification</h2>
        {user?.phoneVerifiedAt ? (
          <p>
            <StatusBadge value="VERIFIED" /> Your phone is verified.
          </p>
        ) : (
          <>
            <p className="lede">
              Required before listing, messaging or completing a transaction.
              Stored privately.
            </p>
            <label className="field">
              <span>Indian mobile number</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                inputMode="tel"
              />
            </label>
            <button
              className="button secondary"
              onClick={() => send.mutate()}
              disabled={send.isPending || resendCooldown > 0}
            >
              {send.isPending
                ? "Sending..."
                : codeSent
                  ? resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Resend code"
                  : "Send code"}
            </button>
            {codeSent ? (
              <>
                <label className="field">
                  <span>6-digit code</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={6}
                  />
                </label>
                <button
                  className="button primary"
                  onClick={() => verify.mutate()}
                  disabled={verify.isPending}
                >
                  Verify phone
                </button>
              </>
            ) : null}
            {send.error ? (
              <p className="field-error">{send.error.message}</p>
            ) : null}
            {verify.error ? (
              <p className="field-error">{verify.error.message}</p>
            ) : null}
          </>
        )}
      </section>
      <section className="panel form section">
        <h2>Session</h2>
        <p>
          Signing out invalidates this server session and clears its secure
          cookie.
        </p>
        <button
          className="button danger"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </button>
      </section>
      {params.get("verify") === "phone" && !user?.phoneVerifiedAt ? (
        <SafetyReminder />
      ) : null}
    </div>
  );
}
