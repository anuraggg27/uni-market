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
  Bell,
  Check,
  ChevronRight,
  ImagePlus,
  MoreHorizontal,
  SendHorizontal,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, clearCsrf, jsonBody } from "../api";
import { useAuth } from "../auth";
import { shouldFollowNewMessage } from "../chat-scroll";
import {
  initializeMsg91,
  msg91AccessToken,
  msg91Identifier,
  msg91RequestId,
  retryMsg91Otp,
  sendMsg91Otp,
  verifyMsg91Otp,
} from "../msg91";
import { ProductCard } from "../components/ProductCard";
import {
  formatNotificationTime,
  getNotificationIcon,
  type NotificationRecord,
} from "../components/NotificationTray";
import { ReportButton } from "../components/ReportButton";
import { Bubble, BubbleContent } from "../components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "../components/ui/message";
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
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  useEffect(() => {
    const previews = images.map((file) => URL.createObjectURL(file));
    setImagePreviews(previews);
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview));
  }, [images]);
  function addImages(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    setImages((current) => [...current, ...selectedFiles].slice(0, 8));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removeImage(index: number) {
    setImages((current) =>
      current.filter((_, imageIndex) => imageIndex !== index),
    );
  }
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
    <div className="page listing-form-page">
      <div className="page-header listing-form-header">
        <div>
          <p className="eyebrow">{edit ? "Update" : "Sell"}</p>
          <h1>{edit ? "Edit your listing" : "List a product"}</h1>
          <p className="lede">
            One clear page, saved as a private draft. Every submitted listing is
            manually reviewed.
          </p>
        </div>
      </div>
      <form className="listing-form" onSubmit={form.handleSubmit(submit)}>
        <fieldset className="listing-section listing-photo-section">
          <legend>Photos</legend>
          <p className="listing-section-intro">
            Add clear photos of your product.
          </p>
          <div className="photo-uploader">
            <input
              ref={fileInputRef}
              id="listing-images"
              className="listing-file-input"
              aria-label="Product images"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => addImages(event.target.files)}
            />
            <label className="photo-upload-label" htmlFor="listing-images">
              <span className="photo-upload-icon" aria-hidden="true">
                <ImagePlus />
              </span>
              <span className="photo-upload-copy">
                <strong>Upload photos</strong>
                <span>PNG, JPG or WebP · Up to 8 images, 5 MB each</span>
              </span>
              <span className="photo-upload-action">Choose photos</span>
            </label>
            <p className="hint">
              Metadata is removed.{" "}
              {edit
                ? "New photos require reapproval."
                : "At least one photo is required before submission."}
            </p>
          </div>
          {images.length ? (
            <div className="photo-preview-grid" aria-live="polite">
              {images.map((file, index) => (
                <figure
                  className="photo-preview"
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                >
                  <img
                    src={imagePreviews[index]}
                    alt={`Selected product image: ${file.name}`}
                  />
                  {index === 0 ? <figcaption>Cover</figcaption> : null}
                  <button
                    type="button"
                    className="photo-remove"
                    onClick={() => removeImage(index)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X aria-hidden="true" />
                  </button>
                </figure>
              ))}
            </div>
          ) : null}
        </fieldset>
        <fieldset className="listing-section listing-section-fields">
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
        <fieldset className="listing-section listing-section-fields pricing-section">
          <legend>Pricing</legend>
          <div className="pricing-options" aria-label="Price type">
            {(["FIXED", "RANGE", "FREE"] as const).map((value) => (
              <label className="pricing-choice" key={value}>
                <input
                  type="radio"
                  value={value}
                  {...form.register("priceType")}
                />
                <span>{value[0] + value.slice(1).toLowerCase()}</span>
              </label>
            ))}
          </div>
          {priceType !== "FREE" ? (
            <div className="price-entry-row">
              {priceType === "FIXED" ? (
                <label className="field">
                  <span>Price</span>
                  <span className="price-control">
                    <span aria-hidden="true">₹</span>
                    <input
                      aria-label="Price (₹)"
                      type="number"
                      {...form.register("exactPrice", { valueAsNumber: true })}
                    />
                  </span>
                  <FieldError>
                    {form.formState.errors.exactPrice?.message}
                  </FieldError>
                </label>
              ) : (
                <div className="form-grid price-range-grid">
                  <label className="field">
                    <span>Minimum</span>
                    <span className="price-control">
                      <span aria-hidden="true">₹</span>
                      <input
                        aria-label="Minimum (₹)"
                        type="number"
                        {...form.register("minimumPrice", {
                          valueAsNumber: true,
                        })}
                      />
                    </span>
                    <FieldError>
                      {form.formState.errors.minimumPrice?.message}
                    </FieldError>
                  </label>
                  <label className="field">
                    <span>Maximum</span>
                    <span className="price-control">
                      <span aria-hidden="true">₹</span>
                      <input
                        aria-label="Maximum (₹)"
                        type="number"
                        {...form.register("maximumPrice", {
                          valueAsNumber: true,
                        })}
                      />
                    </span>
                  </label>
                </div>
              )}
              <label className="negotiable-control">
                <input type="checkbox" {...form.register("negotiable")} />
                <span>Price is negotiable</span>
              </label>
            </div>
          ) : null}
        </fieldset>
        <fieldset className="listing-section listing-section-fields">
          <legend>Location &amp; meetup</legend>
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
        <div className="listing-form-actions">
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

function groupChatMessages(messages: ChatMessage[]) {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const current = groups.at(-1);
    if (current?.[0]?.senderId === message.senderId) current.push(message);
    else groups.push([message]);
  }
  return groups;
}

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
  const messageGroups = useMemo(() => groupChatMessages(all), [all]);

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
          <span className="chat-listing-image" aria-hidden="true">
            {(conversation?.listingTitle ?? "L").trim().charAt(0).toUpperCase()}
          </span>
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
          <div className="chat-safety-note" data-slot="chat-marker">
            <ShieldCheck aria-hidden="true" />
            <span>
              Meet in public, inspect before paying & never share an OTP.
            </span>
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
            messageGroups.map((group) => {
              const mine = group[0]?.senderId === user?.id;
              return (
                <MessageGroup key={group[0]?.clientId || group[0]?.id}>
                  {group.map((message, index) => {
                    const lastInGroup = index === group.length - 1;
                    const align = mine ? "end" : "start";
                    return (
                      <Message
                        align={align}
                        data-state={
                          message.failed
                            ? "failed"
                            : message.pending
                              ? "pending"
                              : "sent"
                        }
                        key={message.clientId || message.id}
                      >
                        {!mine ? (
                          <MessageAvatar>
                            {lastInGroup ? (
                              <span className="message-avatar-fallback">
                                {(conversation?.otherName ?? "U")
                                  .trim()
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>
                            ) : null}
                          </MessageAvatar>
                        ) : null}
                        <MessageContent>
                          {!mine && index === 0 ? (
                            <MessageHeader>
                              {conversation?.otherName ?? "Seller"}
                            </MessageHeader>
                          ) : null}
                          <Bubble
                            align={align}
                            variant={
                              message.failed
                                ? "destructive"
                                : mine
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            <BubbleContent>{message.body}</BubbleContent>
                          </Bubble>
                          <MessageFooter>
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
                                onClick={() =>
                                  deliver(message.body, message.clientId)
                                }
                              >
                                Retry
                              </button>
                            ) : null}
                          </MessageFooter>
                        </MessageContent>
                      </Message>
                    );
                  })}
                </MessageGroup>
              );
            })
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
          rows={1}
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
            <article className="panel transaction-card" key={tx.id}>
              <div className="transaction-card-header">
                <div className="transaction-card-copy">
                  <h2>{tx.listingTitle}</h2>
                  <p>
                    {tx.role === "BUYER" ? "You are buying" : "You are selling"}
                  </p>
                </div>
                <StatusBadge value={tx.status} />
              </div>
              <div className="transaction-card-actions">
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
                  className="form-grid transaction-review-form"
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
    queryFn: () => api<NotificationRecord[]>("/api/notifications"),
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
  const notifications = query.data ?? [];
  const unreadCount = notifications.filter(
    (notification) => !notification.readAt,
  ).length;

  return (
    <div className="page max-w-[1040px] !pt-12 sm:!pt-14">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            Updates
          </p>
          <h1 className="m-0 text-[34px] font-semibold tracking-[-0.04em] text-ink sm:text-[40px]">
            Notifications
          </h1>
        </div>
        <button
          type="button"
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full border border-line bg-surface-muted px-3.5 text-[12px] font-semibold text-accent transition-colors hover:border-sandalwood hover:bg-surface-muted disabled:cursor-default disabled:opacity-45"
          onClick={() => all.mutate()}
          disabled={!unreadCount || all.isPending}
        >
          <Check className="size-3.5" aria-hidden="true" />
          Mark all as read
        </button>
      </div>

      <section
        className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_10px_35px_rgba(17,24,39,0.06)]"
        aria-label="Notification history"
      >
        {query.isLoading ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : query.isError ? (
          <div className="p-6">
            <ErrorState error={query.error} />
          </div>
        ) : !notifications.length ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
            <span className="mb-4 grid size-11 place-items-center rounded-full bg-surface-muted text-accent">
              <Bell className="size-5" aria-hidden="true" />
            </span>
            <h2 className="m-0 text-[16px] font-semibold text-ink">
              You&apos;re all caught up
            </h2>
            <p className="mb-0 mt-1.5 text-[14px] text-muted">
              Marketplace and support updates will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {notifications.map((notification) => {
              const Icon = getNotificationIcon(notification.type);
              const unread = !notification.readAt;

              return (
                <article
                  className={`group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-[18px] transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-focus/25 sm:gap-4 sm:px-6 sm:py-[22px] ${unread ? "bg-surface-muted" : "bg-surface"} hover:bg-surface-muted`}
                  key={notification.id}
                >
                  <Link
                    to={notification.href}
                    className="absolute inset-0 z-0 rounded-[inherit] outline-none"
                    onClick={() => unread && read.mutate(notification.id)}
                    aria-label={`Open notification: ${notification.title}`}
                  />

                  <span className="pointer-events-none relative z-[1] grid size-9 place-items-center rounded-full bg-surface-muted text-accent sm:size-10">
                    <Icon
                      className="size-[17px] sm:size-[18px]"
                      aria-hidden="true"
                    />
                    {unread ? (
                      <span
                        className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-brand"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>

                  <div className="pointer-events-none relative z-[1] min-w-0">
                    <h2 className="m-0 truncate text-[15px] font-semibold leading-5 text-ink sm:text-[16px]">
                      {notification.title}
                      {unread ? <span className="sr-only"> Unread</span> : null}
                    </h2>
                    <p className="mb-0 mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted sm:text-[14px]">
                      {notification.body}
                    </p>
                    <time
                      className="mt-1.5 block text-[12px] text-muted"
                      dateTime={notification.createdAt}
                    >
                      {formatNotificationTime(notification.createdAt)}
                    </time>
                  </div>

                  <div className="relative z-[2] flex items-center gap-2 sm:gap-3">
                    {unread ? (
                      <button
                        type="button"
                        className="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-accent transition-colors hover:bg-surface-muted disabled:opacity-50 sm:px-2.5"
                        onClick={() => read.mutate(notification.id)}
                        disabled={read.isPending}
                        aria-label={`Mark ${notification.title} as read`}
                      >
                        New
                      </button>
                    ) : (
                      <span className="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted sm:px-2.5">
                        Read
                      </span>
                    )}
                    <ChevronRight
                      className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                      aria-hidden="true"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
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
  const [requestId, setRequestId] = useState<string>();
  const verificationConfig = useQuery({
    queryKey: ["phone-verification-config"],
    queryFn: () =>
      api<
        | { provider: "development"; otpLength: number; retryAfter: number }
        | {
            provider: "msg91";
            widgetId: string;
            tokenAuth: string;
            otpLength: number;
            retryAfter: number;
          }
      >("/api/phone/config"),
    enabled: !user?.phoneVerifiedAt,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const send = useMutation({
    mutationFn: async () => {
      const provider = verificationConfig.data;
      if (!provider) throw new Error("Phone verification is not ready");
      await api("/api/phone/check-availability", {
        method: "POST",
        ...jsonBody({ phone }),
      });
      if (provider.provider === "development") {
        const result = await api<{ retryAfter: number }>("/api/phone/send", {
          method: "POST",
          ...jsonBody({ phone }),
        });
        return { ...result, requestId: undefined };
      }

      await initializeMsg91({
        widgetId: provider.widgetId,
        tokenAuth: provider.tokenAuth,
        captchaRenderId: "msg91-captcha",
      });
      const result = codeSent
        ? await retryMsg91Otp(requestId)
        : await sendMsg91Otp(msg91Identifier(phone));
      return {
        retryAfter: provider.retryAfter,
        requestId: msg91RequestId(result) ?? requestId,
      };
    },
    onSuccess: ({ retryAfter, requestId: nextRequestId }) => {
      setCodeSent(true);
      setResendCooldown(retryAfter);
      setRequestId(nextRequestId);
    },
  });
  const verify = useMutation({
    mutationFn: async () => {
      const provider = verificationConfig.data;
      if (!provider) throw new Error("Phone verification is not ready");
      if (provider.provider === "development") {
        return api("/api/phone/verify", {
          method: "POST",
          ...jsonBody({ phone, code }),
        });
      }

      const result = await verifyMsg91Otp(code, requestId);
      return api("/api/phone/verify-provider", {
        method: "POST",
        ...jsonBody({ phone, accessToken: msg91AccessToken(result) }),
      });
    },
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
  const otpLength = verificationConfig.data?.otpLength ?? 4;
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
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (codeSent) {
                    setCodeSent(false);
                    setCode("");
                    setRequestId(undefined);
                    setResendCooldown(0);
                  }
                }}
                placeholder="9876543210"
                inputMode="tel"
                autoComplete="tel"
                disabled={send.isPending || verify.isPending}
              />
            </label>
            <div id="msg91-captcha" />
            <button
              className="button secondary"
              onClick={() => send.mutate()}
              disabled={
                verificationConfig.isPending ||
                send.isPending ||
                resendCooldown > 0
              }
            >
              {send.isPending
                ? "Sending…"
                : codeSent
                  ? resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Resend code"
                  : "Send code"}
            </button>
            {codeSent ? (
              <>
                <label className="field">
                  <span>{otpLength}-digit code</span>
                  <input
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, otpLength))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={otpLength}
                  />
                </label>
                <button
                  className="button primary"
                  onClick={() => verify.mutate()}
                  disabled={
                    verify.isPending ||
                    code.length !== otpLength ||
                    !/^\d+$/.test(code)
                  }
                >
                  {verify.isPending ? "Verifying…" : "Verify phone"}
                </button>
              </>
            ) : null}
            {send.error ? (
              <p className="field-error">{send.error.message}</p>
            ) : null}
            {verify.error ? (
              <p className="field-error">{verify.error.message}</p>
            ) : null}
            {verificationConfig.error ? (
              <p className="field-error">
                {verificationConfig.error.message}
              </p>
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
        <div className="settings-safety-reminder">
          <SafetyReminder />
        </div>
      ) : null}
    </div>
  );
}
