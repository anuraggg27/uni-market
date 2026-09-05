import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { io, type Socket } from "socket.io-client";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { currentPolicyVersion, defaultAvatarId, listingInputSchema, type AvatarId, type ListingInput } from "@campus-market/shared";
import { z } from "zod";
import {
  ArrowDown,
  ArrowLeft,
  Bell,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Download,
  ExternalLink,
  ImagePlus,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  MoreHorizontal,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { api, clearCsrf, jsonBody } from "../api";
import { useAuth } from "../auth";
import { shouldFollowNewMessage } from "../chat-scroll";
import { pendingContact } from "../contact-intent";
import {
  detachMsg91Captcha,
  initializeMsg91,
  msg91AccessToken,
  msg91Identifier,
  msg91RequestId,
  retryMsg91Otp,
  sendMsg91Otp,
  verifyMsg91Otp,
} from "../msg91";
import { ProductCard } from "../components/ProductCard";
import { ProfileModeSwitcher } from "../components/ProfileModeSwitcher";
import { AvatarPicker, AvatarPickerDialog } from "../components/AvatarPicker";
import { UserAvatar } from "../components/UserAvatar";
import { BuyerReputation } from "../components/BuyerReputation";
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
  StatusBadge,
  SubmitButton,
} from "../components/UI";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const accountDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
type VerificationProviderConfig =
  | { provider: "development"; otpLength: number; retryAfter: number }
  | {
      provider: "msg91";
      widgetId: string;
      tokenAuth: string;
      otpLength: number;
      retryAfter: number;
    };
type SupportedAcademicDomain = {
  id: string;
  domain: string;
  institutionName: string;
};

function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<any[]>("/api/categories"),
  });
}

function useAcademicDomains(enabled = true) {
  return useQuery({
    queryKey: ["supported-academic-domains"],
    queryFn: () => api<SupportedAcademicDomain[]>("/api/academic-domains"),
    enabled,
    staleTime: 5 * 60_000,
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
  const [removedExistingImageIds, setRemovedExistingImageIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const createdListingIdRef = useRef<string | null>(null);
  const uploadedFileKeysRef = useRef(new Set<string>());
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
      usedPhysicalGoodsAttested: true,
      accurateDescriptionAttested: true,
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
        usedPhysicalGoodsAttested: true,
        accurateDescriptionAttested: true,
      });
  }, [existing.data, form]);
  const priceType = form.watch("priceType");
  const condition = form.watch("condition");
  const retainedExistingImages = useMemo(
    () =>
      (existing.data?.images ?? []).filter(
        (image: { id: string }) => !removedExistingImageIds.includes(image.id),
      ) as Array<{ id: string; url: string; position: number }>,
    [existing.data?.images, removedExistingImageIds],
  );
  useEffect(() => {
    const previews = images.map((file) => URL.createObjectURL(file));
    setImagePreviews(previews);
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview));
  }, [images]);
  function addImages(files: FileList | null) {
    if (!files?.length || uploading) return;
    const selectedFiles = Array.from(files).filter((file) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`${file.name}: please use a JPG, PNG or WebP photo.`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name}: photos must be 5 MB or smaller.`);
        return false;
      }
      return true;
    });
    if (!selectedFiles.length) return;
    const availableNewImageSlots = Math.max(0, 8 - retainedExistingImages.length);
    if (images.length + selectedFiles.length > availableNewImageSlots) {
      toast.error("You can add up to 8 photos. Extra photos were not added.");
    }
    setImages((current) =>
      [...current, ...selectedFiles].slice(0, availableNewImageSlots),
    );
  }
  function removeImage(index: number) {
    setImages((current) =>
      current.filter((_, imageIndex) => imageIndex !== index),
    );
  }
  function removeExistingImage(imageId: string) {
    setRemovedExistingImageIds((current) =>
      current.includes(imageId) ? current : [...current, imageId],
    );
  }
  async function uploadFiles(id: string) {
    for (const file of images) {
      const fileKey = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
      if (uploadedFileKeysRef.current.has(fileKey)) continue;
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
      uploadedFileKeysRef.current.add(fileKey);
    }
  }
  async function submit(values: ListingInput) {
    setServerError("");
    setUploading(true);
    try {
      if (edit && retainedExistingImages.length + images.length === 0) {
        throw new Error("Keep or add at least one product image.");
      }
      const listing = edit || createdListingIdRef.current
        ? await api<any>(`/api/listings/${edit ? listingId : createdListingIdRef.current}`, {
            method: "PATCH",
            ...jsonBody(values),
          })
        : await api<any>("/api/listings", {
            method: "POST",
            ...jsonBody(values),
          });
      if (!edit) createdListingIdRef.current = listing.id;
      for (const imageId of removedExistingImageIds) {
        await api(`/api/uploads/listings/${listing.id}/${imageId}`, {
          method: "DELETE",
        });
      }
      if (images.length) await uploadFiles(listing.id);
      if (!edit) {
        await api(`/api/listings/${listing.id}/submit`, { method: "POST" });
      }
      toast.success(edit ? "Listing updated" : "Listing submitted for review");
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
        <Loading variant="form" label="Loading listing form" />
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
          <h1>{edit ? "Edit your listing" : "List a product"}</h1>
          <p className="lede">
            Complete the details below. Your listing stays private while it is
            manually reviewed.
          </p>
        </div>
      </div>
      <form className="listing-form" onSubmit={form.handleSubmit(submit)}>
        <fieldset className="listing-section listing-photo-section">
          <legend>Photos</legend>
          <p className="listing-section-intro">
            Add clear, genuine photos of the actual item. AI-generated or materially altered images are not allowed.
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
              tabIndex={-1}
              disabled={uploading || retainedExistingImages.length + images.length >= 8}
              onChange={(event) => {
                addImages(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={cameraInputRef}
              id="listing-camera"
              className="listing-file-input"
              aria-label="Take a product photo"
              type="file"
              accept="image/*"
              capture="environment"
              tabIndex={-1}
              disabled={uploading || retainedExistingImages.length + images.length >= 8}
              onChange={(event) => {
                addImages(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <div className="photo-upload-label">
              <span className="photo-upload-icon" aria-hidden="true">
                <ImagePlus />
              </span>
              <span className="photo-upload-copy">
                <strong>Upload photos</strong>
                <span>PNG, JPG or WebP · Up to 8 images, 5 MB each</span>
              </span>
              <div className="photo-upload-actions">
                <button
                  type="button"
                  className="photo-upload-action"
                  disabled={uploading || retainedExistingImages.length + images.length >= 8}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose photos
                </button>
                <button
                  type="button"
                  className="photo-upload-action"
                  disabled={uploading || retainedExistingImages.length + images.length >= 8}
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera size={18} aria-hidden="true" />
                  Take photo
                </button>
              </div>
            </div>
            <p className="hint">
              Metadata is removed.{" "}
              {edit
                ? "New photos require reapproval."
                : "At least one photo is required before submission."}
            </p>
          </div>
          {retainedExistingImages.length || images.length ? (
            <div className="photo-preview-grid" aria-live="polite">
              {retainedExistingImages.map((image, index) => (
                <figure className="photo-preview" key={image.id}>
                  <img
                    src={image.url}
                    alt={`Existing product image ${index + 1}`}
                  />
                  {index === 0 ? <figcaption>Cover</figcaption> : null}
                  <button
                    type="button"
                    className="photo-remove"
                    onClick={() => removeExistingImage(image.id)}
                    aria-label={`Remove existing product image ${index + 1}`}
                  >
                    <X aria-hidden="true" />
                  </button>
                </figure>
              ))}
              {images.map((file, index) => (
                <figure
                  className="photo-preview"
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                >
                  <img
                    src={imagePreviews[index]}
                    alt={`Selected product image: ${file.name}`}
                  />
                  {retainedExistingImages.length === 0 && index === 0 ? <figcaption>Cover</figcaption> : null}
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
                  {...form.register("priceType", {
                    onChange: (event) => {
                      if (event.target.value !== "FIXED") form.setValue("exactPrice", null);
                      if (event.target.value !== "RANGE") {
                        form.setValue("minimumPrice", null);
                        form.setValue("maximumPrice", null);
                      }
                      form.clearErrors(["exactPrice", "minimumPrice", "maximumPrice"]);
                    },
                  })}
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
                      min={1}
                      max={10_000_000}
                      step={1}
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
                        min={1}
                        max={10_000_000}
                        step={1}
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
                        min={1}
                        max={10_000_000}
                        step={1}
                        {...form.register("maximumPrice", {
                          valueAsNumber: true,
                        })}
                      />
                    </span>
                    <FieldError>
                      {form.formState.errors.maximumPrice?.message}
                    </FieldError>
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
        <fieldset className="listing-section listing-section-fields">
          <legend>Seller declarations</legend>
          <p className="listing-section-intro">Confirm these 2 points before saving your draft.</p>
          <div className="declaration-list">
            <label className="declaration-row"><input type="checkbox" {...form.register("ownershipAttested")} /><span><strong>I own this used physical item and may legally sell it</strong><small>It is not a service, digital product, ticket, account, credential, or new retail item.</small></span></label>
            <FieldError>{form.formState.errors.ownershipAttested?.message ?? form.formState.errors.usedPhysicalGoodsAttested?.message}</FieldError>
            <div className="declaration-row declaration-policy-row"><input id="sellerPolicyAccepted" type="checkbox" {...form.register("sellerPolicyAccepted")} /><span><label htmlFor="sellerPolicyAccepted"><strong>This listing is accurate and follows the seller rules</strong></label><small>The description, condition, defects, and price are accurate, and the images are genuine photos of the actual item. I accept the <Link to="/seller-policy" target="_blank" rel="noreferrer">Seller Policy</Link> and <Link to="/prohibited-items" target="_blank" rel="noreferrer">Prohibited Items</Link> rules.</small></span></div>
            <FieldError>{form.formState.errors.sellerPolicyAccepted?.message ?? form.formState.errors.accurateDescriptionAttested?.message}</FieldError>
          </div>
        </fieldset>
        {serverError ? <p className="field-error">{serverError}</p> : null}
        <div className="listing-form-actions">
          <Link className="button secondary" to="/my-listings">
            Cancel
          </Link>
          <SubmitButton pending={form.formState.isSubmitting || uploading}>
            {edit ? "Save changes" : "Submit for review"}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

const primaryListingTabs = ["ALL", "ACTIVE", "PENDING", "SOLD"] as const;
const secondaryListingTabs = [
  "DRAFT",
  "RESERVED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
] as const;
type ListingTab =
  | (typeof primaryListingTabs)[number]
  | (typeof secondaryListingTabs)[number];

function getListingDisplayStatus(item: any): string {
  if (item.moderationState === "REJECTED") return "REJECTED";
  if (
    item.lifecycleState === "DRAFT" &&
    item.moderationState === "PENDING" &&
    item.submittedAt
  ) {
    return "PENDING";
  }
  return item.lifecycleState;
}

function matchesListingTab(item: any, tab: ListingTab): boolean {
  if (tab === "ALL") return true;
  if (tab === "PENDING") {
    return (
      item.moderationState === "PENDING" &&
      item.lifecycleState === "DRAFT" &&
      Boolean(item.submittedAt)
    );
  }
  if (tab === "REJECTED") return item.moderationState === "REJECTED";
  if (tab === "DRAFT") {
    return (
      item.lifecycleState === "DRAFT" &&
      item.moderationState === "PENDING" &&
      !item.submittedAt
    );
  }
  return item.lifecycleState === tab;
}

function listingEmptyCopy(tab: ListingTab) {
  if (tab === "ALL") {
    return {
      title: "No listings yet",
      body: "Create your first listing and start selling on campus.",
    };
  }
  if (tab === "ACTIVE") {
    return {
      title: "No active listings",
      body: "Your approved listings will appear here.",
    };
  }
  if (tab === "PENDING") {
    return {
      title: "No pending listings",
      body: "Listings waiting for review will appear here.",
    };
  }
  if (tab === "SOLD") {
    return {
      title: "No sold listings",
      body: "Completed sales will appear here.",
    };
  }
  return {
    title: `No ${tab.toLowerCase().replaceAll("_", " ")} listings`,
    body: "Listings with this status will appear here.",
  };
}

export function MyListingsPage() {
  const [tab, setTab] = useState<ListingTab>("ALL");
  const [listingToDelete, setListingToDelete] = useState<{ id: string; title: string } | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["my-listings"],
    queryFn: () => api<any[]>("/api/my-listings"),
  });
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) =>
      api(`/api/listings/${id}/${type}`, { method: "POST" }),
    onSuccess: (_data, variables) => {
      const messages: Record<string, string> = {
        submit: "Submitted for review",
        withdraw: "Listing withdrawn",
        duplicate: "Draft duplicated",
      };
      toast.success(messages[variables.type] ?? "Listing updated");
      void client.invalidateQueries({ queryKey: ["my-listings"] });
    },
  });
  const deleteListing = useMutation({
    mutationFn: (id: string) => api(`/api/listings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setListingToDelete(null);
      toast.success("Listing deleted");
      void client.invalidateQueries({ queryKey: ["my-listings"] });
    },
  });
  const items = query.data?.filter((item) => matchesListingTab(item, tab)) ?? [];
  const emptyCopy = listingEmptyCopy(tab);
  const secondaryFilterActive = secondaryListingTabs.includes(
    tab as (typeof secondaryListingTabs)[number],
  );

  useEffect(() => {
    const openMenuSelector =
      "details.my-listings-filter-more[open], details.my-listing-more[open]";

    const closeMenusExcept = (target?: Node) => {
      pageRef.current
        ?.querySelectorAll<HTMLDetailsElement>(openMenuSelector)
        .forEach((menu) => {
          if (!target || !menu.contains(target)) {
            menu.removeAttribute("open");
          }
        });
    };

    const handlePointerDown = (event: PointerEvent) => {
      closeMenusExcept(event.target as Node);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenusExcept();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="page my-listings-page" ref={pageRef}>
      <div className="my-listings-header">
        <div>
          <h1>My listings</h1>
          <p className="my-listings-intro">
            Manage your listings and track their status.
          </p>
        </div>
        <Link className="button primary my-listings-create" to="/sell">
          Create listing
        </Link>
      </div>

      <div className="my-listings-filterbar">
        <div
          className="my-listings-primary-filters"
          role="tablist"
          aria-label="Listing status"
        >
          {primaryListingTabs.map((value) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              key={value}
              onClick={() => setTab(value)}
            >
              {value[0] + value.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <details
          className={`my-listings-filter-more ${secondaryFilterActive ? "active" : ""}`}
        >
          <summary>
            <span>More</span>
            <MoreHorizontal aria-hidden="true" />
          </summary>
          <div className="my-listings-filter-menu" role="menu">
            {secondaryListingTabs.map((value) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={tab === value}
                className={tab === value ? "active" : ""}
                key={value}
                onClick={(event) => {
                  setTab(value);
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
              >
                {value[0] + value.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </details>
      </div>

      {query.isLoading ? (
        <div className="my-listings-loading">
          <Loading variant="my-listings" label="Loading your listings" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !items.length ? (
        <div className="my-listings-empty">
          <span className="my-listings-empty-icon" aria-hidden="true">
            <ImagePlus />
          </span>
          <h2>{emptyCopy.title}</h2>
          <p>{emptyCopy.body}</p>
          <Link className="button primary" to="/sell">
            Create listing
          </Link>
        </div>
      ) : (
        <div className="my-listings-grid">
          {items.map((item) => {
            const displayStatus = getListingDisplayStatus(item);
            const canSubmit =
              item.lifecycleState === "DRAFT" &&
              !(
                item.moderationState === "PENDING" && item.submittedAt
              );
            const continueEditing = ["DRAFT", "REJECTED"].includes(
              displayStatus,
            );

            return (
              <article className="my-listing-card" key={item.id}>
                <Link
                  className="my-listing-image"
                  to={`/listing/${item.id}`}
                  aria-label={`View ${item.title}`}
                >
                  {item.coverImageUrl ? (
                    <img src={item.coverImageUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">
                      <ImagePlus />
                    </span>
                  )}
                </Link>

                <div className="my-listing-content">
                  <div className="my-listing-title-row">
                    <div>
                      <h2>
                        <Link to={`/listing/${item.id}`}>{item.title}</Link>
                      </h2>
                      <strong className="my-listing-price">
                        {item.priceLabel}
                      </strong>
                    </div>
                  </div>
                  {item.location ? (
                    <p className="my-listing-context">{item.location}</p>
                  ) : null}
                  {item.rejectionReason ? (
                    <p className="my-listing-rejection">
                      {item.rejectionReason}
                    </p>
                  ) : null}
                  <p className="my-listing-meta">
                    {item.viewCount} views
                    {" \u00b7 "}
                    {item.favouriteCount} saves
                  </p>
                </div>

                <div className="my-listing-side">
                  <span className="my-listing-status">
                    <StatusBadge value={displayStatus} />
                  </span>
                  <div className="my-listing-actions">
                    {canSubmit ? (
                      <button
                        type="button"
                        className="button small primary"
                        onClick={() =>
                          action.mutate({ id: item.id, type: "submit" })
                        }
                        disabled={action.isPending}
                      >
                        Submit for review
                      </button>
                    ) : continueEditing ? (
                      <Link
                        className="button small primary"
                        to={`/listing/${item.id}/edit`}
                      >
                        Continue editing
                      </Link>
                    ) : (
                      <Link
                        className="button small secondary"
                        to={`/listing/${item.id}`}
                      >
                        View
                      </Link>
                    )}

                    <details className="my-listing-more">
                      <summary aria-label={`More actions for ${item.title}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </summary>
                      <div className="my-listing-actions-menu" role="menu">
                        {!continueEditing || canSubmit ? (
                          <Link
                            role="menuitem"
                            to={`/listing/${item.id}/edit`}
                          >
                            Edit
                          </Link>
                        ) : null}
                        {item.lifecycleState === "ACTIVE" ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() =>
                              action.mutate({ id: item.id, type: "withdraw" })
                            }
                            disabled={action.isPending}
                          >
                            Withdraw
                          </button>
                        ) : null}
                        {["SOLD", "EXPIRED", "WITHDRAWN"].includes(
                          item.lifecycleState,
                        ) ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() =>
                              action.mutate({ id: item.id, type: "duplicate" })
                            }
                            disabled={action.isPending}
                          >
                            Duplicate
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          className="danger"
                          onClick={() =>
                            setListingToDelete({
                              id: item.id,
                              title: item.title,
                            })
                          }
                          disabled={deleteListing.isPending}
                        >
                          Delete
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <DeleteConfirmationDialog
        open={Boolean(listingToDelete)}
        onOpenChange={(open) => {
          if (!open) setListingToDelete(null);
        }}
        title="Delete listing?"
        description={`Are you sure you want to delete "${listingToDelete?.title ?? "this listing"}"?`}
        pending={deleteListing.isPending}
        onConfirm={() => {
          if (listingToDelete) deleteListing.mutate(listingToDelete.id);
        }}
      />
      {action.error || deleteListing.error ? (
        <p className="field-error my-listings-error">
          {(action.error ?? deleteListing.error)?.message}
        </p>
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
          <h1>Saved products</h1>
        </div>
      </div>
      {query.isLoading ? (
        <Loading variant="cards" label="Loading saved products" />
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
  buyerId: string;
  sellerId: string;
  otherUserId: string;
  otherName: string;
  unread: number;
  coverImageUrl: string | null;
  lastMessageAt: string;
};

type TransactionRecord = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPrice: string;
  buyerId: string;
  sellerId: string;
  role: "BUYER" | "SELLER";
  status: string;
  createdAt: string;
  updatedAt: string;
  reviewSubmitted: boolean;
  coverImageUrl?: string | null;
  exchangeCode?: string;
  exchangeCodeLocked?: boolean;
};

const emptyTransactions: TransactionRecord[] = [];
const activeRequestStatuses = new Set(["REQUESTED", "ACCEPTED", "RESERVED", "HANDED_OVER"]);

function refreshTransactionViews(client: QueryClient) {
  for (const key of ["transactions", "conversations", "notifications", "my-listings", "listing", "seller", "buyer-reputation", "leaderboard"]) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

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
  const requests = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api<TransactionRecord[]>("/api/transactions"),
    enabled: Boolean(user?.marketplaceEligible),
    refetchInterval: realtimeState === "connected" ? false : 5_000,
  });
  const selectedConversation = conversations.data?.find(
    (conversation) => conversation.id === conversationId,
  );
  const selectedRequest = useMemo(() => {
    if (!selectedConversation) return undefined;
    const matching = (requests.data ?? emptyTransactions).filter((request) =>
      request.listingId === selectedConversation.listingId
      && request.buyerId === selectedConversation.buyerId
      && request.sellerId === selectedConversation.sellerId
    );
    return matching.find((request) => activeRequestStatuses.has(request.status)) ?? matching[0];
  }, [requests.data, selectedConversation]);

  useEffect(() => {
    activeConversation.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    const realtime = socket();
    const refreshReservations = () => refreshTransactionViews(client);
    const connected = () => {
      setRealtimeState("connected");
      refreshReservations();
    };
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
                    lastMessageAt: new Date(item.lastMessageAt) > new Date(message.createdAt)
                      ? item.lastMessageAt
                      : message.createdAt,
                    unread:
                      message.conversationId === openConversation ||
                      message.senderId === user?.id
                        ? 0
                        // An inbox fetch can already include this message before
                        // its socket event arrives. Do not count it twice.
                        : item.unread + (new Date(item.lastMessageAt) < new Date(message.createdAt) ? 1 : 0),
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
        void client.invalidateQueries({ queryKey: ["conversations"] });
      }
    };

    realtime.on("connect", connected);
    realtime.on("disconnect", disconnected);
    realtime.on("connect_error", unavailable);
    realtime.on("message:new", receive);
    realtime.on("transaction:updated", refreshReservations);
    if (realtime.connected) connected();
    else realtime.connect();

    return () => {
      realtime.off("connect", connected);
      realtime.off("disconnect", disconnected);
      realtime.off("connect_error", unavailable);
      realtime.off("message:new", receive);
      realtime.off("transaction:updated", refreshReservations);
      realtime.disconnect();
    };
  }, [client, user?.id]);

  return (
    <div className="page chat-page">
      <div className={`chat-shell ${conversationId ? "has-conversation" : ""}`}>
        <aside className="conversation-list" aria-label="Conversations">
          <header className="inbox-header">
            <div>
              <h1>Messages</h1>
            </div>
          </header>
          {conversations.isLoading ? (
            <Loading variant="chat-list" label="Loading conversations" />
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
            key={conversationId}
            id={conversationId}
            conversation={selectedConversation}
            reservationRequest={selectedRequest}
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
  reservationRequest,
  realtimeState,
}: {
  id: string;
  conversation: ChatConversation | undefined;
  reservationRequest: TransactionRecord | undefined;
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
  const [scamWarning, setScamWarning] = useState<{ body: string; clientId: string; riskCodes: string[]; confirmationToken: string }>();
  const query = useQuery({
    queryKey: ["messages", id],
    queryFn: () => api<ChatMessage[]>(`/api/conversations/${id}/messages`),
    refetchInterval: realtimeState === "connected" ? false : 5_000,
  });
  const block = useMutation({
    mutationFn: () =>
      api(`/api/blocks/${conversation?.otherUserId}`, { method: "POST" }),
    onSuccess: () => toast.success("User blocked"),
  });
  const requestReservation = useMutation({
    mutationFn: () =>
      api<TransactionRecord>(`/api/conversations/${id}/reservation-requests`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Reservation request sent");
      refreshTransactionViews(client);
    },
  });
  const respondToReservation = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: "accept" | "cancel" }) =>
      api<TransactionRecord>(`/api/transactions/${requestId}/${action}`, { method: "POST" }),
    onSuccess: async (updated, { action }) => {
      // Hide the old request's controls before re-enabling actions. A socket
      // refetch may still be in flight when the mutation response arrives.
      await client.cancelQueries({ queryKey: ["transactions"] });
      client.setQueryData<TransactionRecord[]>(["transactions"], (current) =>
        current?.map((request) => request.id === updated.id ? { ...request, ...updated } : request),
      );
      toast.success(action === "accept" ? "Item reserved for this buyer" : "Request declined");
      refreshTransactionViews(client);
    },
    onError: () => { void client.invalidateQueries({ queryKey: ["transactions"] }); },
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
  const buyerHasMessaged = Boolean(conversation && all.some((message) =>
    message.senderId === conversation.buyerId && !message.pending && !message.failed
  ));
  const isConversationBuyer = user?.id === conversation?.buyerId;
  const requestIsActive = Boolean(reservationRequest && activeRequestStatuses.has(reservationRequest.status));
  const requestView = isConversationBuyer ? "sent" : "received";
  const requestHref = reservationRequest
    ? `/requests?view=${requestView}#transaction-${reservationRequest.id}`
    : "/requests";
  const reservationGuidance = (() => {
    if (reservationRequest?.status === "REQUESTED") return isConversationBuyer
      ? { title: "Waiting for the seller", body: "Your request is sent. Once accepted, your exchange code will be ready." }
      : { title: "The buyer wants to reserve this item", body: "Accept to hold it for this buyer. They’ll get a code to share with you at pickup." };
    if (reservationRequest?.status === "RESERVED") return isConversationBuyer
      ? { title: "Reserved for you", body: "Arrange pickup here. Check the item before sharing your exchange code with the seller." }
      : { title: "Reserved for this buyer", body: "Arrange pickup here. Enter the buyer’s exchange code at the meetup to mark the item sold." };
    if (reservationRequest?.status === "COMPLETED") return { title: "Exchange complete", body: reservationRequest.reviewSubmitted ? "The sale is recorded. You’ve already reviewed this exchange." : "The sale is recorded. You can now leave a review." };
    if (requestIsActive) return { title: "Your exchange is in progress", body: "Open the request to see the next step." };
    if (conversation?.lifecycleState !== "ACTIVE") return { title: "Item unavailable", body: "This item can’t be reserved right now." };
    if (reservationRequest?.status.startsWith("CANCELLED_")) return { title: "Reservation request cancelled", body: "Keep chatting if needed. The buyer can send a new request once you both agree." };
    if (!isConversationBuyer) return { title: "Agree on price and pickup", body: "When you’re both ready, ask the buyer to tap “Ask seller to reserve” here." };
    return buyerHasMessaged
      ? { title: "Ready to go ahead?", body: "Ask the seller to hold this item for you. They’ll confirm the reservation here." }
      : { title: "Start with a message", body: "Agree on the price and pickup here, then ask the seller to reserve the item." };
  })();

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

  function deliver(body: string, clientId: string, safetyConfirmationToken?: string) {
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
      { conversationId: id, clientId, body, safetyConfirmationToken },
        (error: Error | null, result: { ok: boolean; data?: ChatMessage; warning?: { riskCodes: string[]; confirmationToken: string } }) => {
          if (!error && result?.ok && result.data) {
            setScamWarning(undefined);
            receiveMessage(result.data);
            return;
          }
          if (!error && result?.warning) {
            setOptimistic((current) => current.filter((message) => message.clientId !== clientId));
            setScamWarning({ body, clientId, ...result.warning });
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
          {conversation?.sellerId === user?.id && conversation ? <BuyerReputation conversationId={id} /> : null}
        </div>
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
        {conversation ? (
          <section className="chat-reservation-control" aria-label="Reservation and exchange">
            <div className="chat-reservation-copy" aria-live="polite" aria-atomic="true">
              <strong>{reservationGuidance.title}</strong>
              <p>{reservationGuidance.body}</p>
            </div>
            <div className="chat-reservation-buttons" key={reservationRequest?.id ?? "no-request"}>
              {isConversationBuyer ? (
                requestIsActive ? (
                  <Link className={`button ${reservationRequest?.status === "RESERVED" ? "primary" : "secondary"}`} to={requestHref}>
                    {reservationRequest?.status === "RESERVED" ? "View exchange code" : "View request"}
                  </Link>
                ) : reservationRequest?.status === "COMPLETED" ? (
                  <Link className="button secondary" to={requestHref}>{reservationRequest.reviewSubmitted ? "View exchange" : "Leave a review"}</Link>
                ) : conversation.lifecycleState === "ACTIVE" ? (
                  <button
                    className="button primary"
                    type="button"
                    disabled={!buyerHasMessaged || requestReservation.isPending}
                    onClick={() => requestReservation.mutate()}
                  >
                    {requestReservation.isPending ? "Sending request…" : "Ask seller to reserve"}
                  </button>
                ) : null
              ) : reservationRequest?.status === "REQUESTED" ? (
                <>
                  <button
                    className="button primary"
                    type="button"
                    disabled={respondToReservation.isPending}
                    onClick={() => respondToReservation.mutate({ requestId: reservationRequest.id, action: "accept" })}
                  >
                    {respondToReservation.isPending && respondToReservation.variables?.action === "accept" ? "Reserving…" : "Accept and reserve"}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={respondToReservation.isPending}
                    onClick={() => respondToReservation.mutate({ requestId: reservationRequest.id, action: "cancel" })}
                  >
                    {respondToReservation.isPending && respondToReservation.variables?.action === "cancel" ? "Declining…" : "Decline"}
                  </button>
                </>
              ) : reservationRequest?.status === "RESERVED" ? (
                <Link className="button primary" to={requestHref}>Complete exchange</Link>
              ) : reservationRequest?.status === "COMPLETED" ? (
                <Link className="button secondary" to={requestHref}>{reservationRequest.reviewSubmitted ? "View exchange" : "Leave a review"}</Link>
              ) : requestIsActive ? (
                <Link className="button primary" to={requestHref}>View request</Link>
              ) : null}
            </div>
            {requestReservation.error || respondToReservation.error ? (
              <p className="field-error chat-reservation-error" role="alert">{(requestReservation.error ?? respondToReservation.error)?.message}</p>
            ) : null}
          </section>
        ) : null}
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
              Meet in public and inspect before paying. Never share a sign-in or payment OTP.
            </span>
          </div>
          {query.isLoading ? (
            <Loading variant="messages" label="Loading messages" />
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
      {scamWarning ? <div className="chat-risk-warning" role="alert">
        <ShieldAlert aria-hidden="true" />
        <div><div className="chat-risk-warning-heading"><strong>Pause before sending</strong><span>Possible account-security risk</span></div><p>Never share an OTP, password, recovery code, card PIN, or pay an advance fee because of a chat request.</p><small>Detected: {scamWarning.riskCodes.map((riskCode) => riskCode.replaceAll("_", " ").toLowerCase()).join(", ")}</small><div className="button-row"><button type="button" className="button secondary" onClick={() => { setDraft(scamWarning.body); setScamWarning(undefined); }}>Edit Message</button><button type="button" className="button danger" onClick={() => deliver(scamWarning.body, scamWarning.clientId, scamWarning.confirmationToken)}>Send Anyway</button></div></div>
      </div> : null}
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

type TransactionView = "all" | "sent" | "received";
type TransactionSort = "newest" | "oldest";

const transactionDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

function transactionStatusText(transaction: TransactionRecord): string {
  const buyer = transaction.role === "BUYER";
  const labels: Record<string, string> = {
    REQUESTED: buyer ? "Waiting for the seller to respond" : "A buyer is waiting for your response",
    ACCEPTED: buyer ? "The seller accepted your request" : "You accepted this request",
    RESERVED: buyer ? "Reserved for you — arrange the exchange" : "Reserved for this buyer",
    HANDED_OVER: buyer ? "Confirm that you received the item" : "Waiting for the buyer to confirm receipt",
    COMPLETED: "Exchange completed",
    CANCELLED_BY_BUYER: buyer ? "You cancelled this request" : "The buyer cancelled this request",
    CANCELLED_BY_SELLER: buyer ? "The seller cancelled this request" : "You cancelled this request",
    DISPUTED: "This transaction is under review",
  };
  return labels[transaction.status] ?? transaction.status.replaceAll("_", " ").toLocaleLowerCase();
}

export function RequestsPage() {
  const client = useQueryClient();
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  useEffect(() => {
    const realtime = socket();
    const refresh = () => refreshTransactionViews(client);
    const connected = () => {
      setRealtimeState("connected");
      refresh();
    };
    const disconnected = () => setRealtimeState("offline");
    realtime.on("transaction:updated", refresh);
    realtime.on("connect", connected);
    realtime.on("disconnect", disconnected);
    realtime.on("connect_error", disconnected);
    if (realtime.connected) connected();
    else realtime.connect();
    return () => {
      realtime.off("transaction:updated", refresh);
      realtime.off("connect", connected);
      realtime.off("disconnect", disconnected);
      realtime.off("connect_error", disconnected);
      realtime.disconnect();
    };
  }, [client]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [exchangeCodeEntries, setExchangeCodeEntries] = useState<Record<string, string>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const requestedView = searchParams.get("view");
  const view: TransactionView = requestedView === "sent" || requestedView === "buying"
    ? "sent"
    : requestedView === "received" || requestedView === "selling"
      ? "received"
      : "all";
  const sort: TransactionSort = searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  const query = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api<TransactionRecord[]>("/api/transactions"),
    refetchInterval: realtimeState === "connected" ? false : 5_000,
  });
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`/api/transactions/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, variables) => {
      const messages: Record<string, string> = {
        accept: "Request accepted",
        complete: "Exchange completed",
        cancel: "Request cancelled",
      };
      toast.success(messages[variables.action] ?? "Request updated");
      void client.invalidateQueries({ queryKey: ["transactions"] });
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
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
    onSuccess: (_data, variables) => {
      client.setQueryData<TransactionRecord[]>(["transactions"], (current) =>
        current?.map((tx) => tx.id === variables.id ? { ...tx, reviewSubmitted: true } : tx),
      );
      toast.success("Review submitted.");
    },
    onSettled: () => refreshTransactionViews(client),
  });
  const completeExchange = useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) =>
      api(`/api/transactions/${id}/exchange/complete`, {
        method: "POST",
        ...jsonBody({ code }),
      }),
    onSuccess: (_data, variables) => {
      toast.success("Exchange completed");
      setExchangeCodeEntries((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["transactions"] });
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const rotateExchangeCode = useMutation({
    mutationFn: (id: string) =>
      api(`/api/transactions/${id}/exchange-code/rotate`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Exchange code refreshed");
      void client.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
  const transactions = query.data ?? emptyTransactions;
  const transactionCounts = useMemo(() => transactions.reduce((counts, transaction) => {
    counts.all += 1;
    counts[transaction.role === "BUYER" ? "sent" : "received"] += 1;
    return counts;
  }, { all: 0, sent: 0, received: 0 }), [transactions]);
  const visibleTransactions = useMemo(() => {
    const filtered = view === "all"
      ? transactions
      : transactions.filter((transaction) => transaction.role === (view === "sent" ? "BUYER" : "SELLER"));
    return [...filtered].sort((left, right) => {
      const difference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return sort === "newest" ? difference : -difference;
    });
  }, [sort, transactions, view]);
  function selectView(nextView: TransactionView) {
    const next = new URLSearchParams(searchParams);
    if (nextView === "all") next.delete("view");
    else next.set("view", nextView);
    setSearchParams(next, { replace: true });
  }
  function selectSort(nextSort: TransactionSort) {
    const next = new URLSearchParams(searchParams);
    if (nextSort === "newest") next.delete("sort");
    else next.set("sort", nextSort);
    setSearchParams(next, { replace: true });
  }
  return (
    <div className="page transactions-page">
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <p>Track reservation requests you sent and received.</p>
        </div>
      </div>
      <div className="request-controls">
        <div className="transaction-filters" role="tablist" aria-label="Request view">
          {(["all", "sent", "received"] as const).map((filter) => (
            <button type="button" role="tab" aria-selected={view === filter} className={view === filter ? "is-active" : ""} key={filter} onClick={() => selectView(filter)}>
              {filter === "all" ? "All" : filter === "sent" ? "Sent" : "Received"}
              <span>{transactionCounts[filter]}</span>
            </button>
          ))}
        </div>
        <label className="request-sort-control">
          <span>Sort by</span>
          <span className="request-sort-select">
            <select aria-label="Sort requests" value={sort} onChange={(event) => selectSort(event.target.value as TransactionSort)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <ArrowDown aria-hidden="true" />
          </span>
        </label>
      </div>
      {query.isLoading ? (
        <Loading label="Loading requests" />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !visibleTransactions.length ? (
        <div className="request-empty-state">
          <EmptyState
            title={view === "received" ? "No received requests" : view === "sent" ? "No sent requests" : "No requests yet"}
            body={view === "received" ? "Reservation requests from interested students will appear here." : "Start a conversation, send a message, and then request a reservation."}
          />
        </div>
      ) : (
        <div className="transaction-list section">
          {visibleTransactions.map((tx) => (
            <article className="panel transaction-card" id={`transaction-${tx.id}`} key={tx.id}>
              <div className="transaction-card-header">
                <div className="transaction-card-main">
                  <Link className="request-product-thumbnail" to={`/listing/${tx.listingId}`} aria-label={`View ${tx.listingTitle}`}>
                    {tx.coverImageUrl ? <img src={tx.coverImageUrl} alt="" /> : <ImagePlus aria-hidden="true" />}
                  </Link>
                  <div className="transaction-card-copy">
                    <span className={`request-direction request-direction-${tx.role.toLowerCase()}`}>{tx.role === "BUYER" ? "Sent" : "Received"}</span>
                    <h2><Link to={`/listing/${tx.listingId}`}>{tx.listingTitle}</Link></h2>
                    <strong className="transaction-card-price">{tx.listingPrice}</strong>
                    <div className="transaction-card-meta">
                      <CalendarDays aria-hidden="true" />
                      <time dateTime={new Date(tx.createdAt).toISOString()}>Requested {transactionDateFormatter.format(new Date(tx.createdAt))}</time>
                    </div>
                  </div>
                </div>
                <div className="transaction-card-side">
                  <div className="transaction-card-status">
                    <StatusBadge value={tx.status === "REQUESTED" ? "pending" : tx.status.toLowerCase()} />
                    <p className="transaction-status-copy">{transactionStatusText(tx)}</p>
                  </div>
                  <div className="transaction-card-actions">
                    <Link className="button secondary" to={`/listing/${tx.listingId}`}>View listing <ExternalLink aria-hidden="true" /></Link>
                    {tx.role === "SELLER" && tx.status === "REQUESTED" ? <button className="button primary" onClick={() => action.mutate({ id: tx.id, action: "accept" })}>Accept and reserve</button> : null}
                    {tx.role === "BUYER" && tx.status === "HANDED_OVER" ? <button className="button primary" onClick={() => action.mutate({ id: tx.id, action: "complete" })}>Confirm receipt</button> : null}
                    {["REQUESTED", "ACCEPTED", "RESERVED"].includes(tx.status) ? <button className="button danger" onClick={() => action.mutate({ id: tx.id, action: "cancel" })}>Cancel</button> : null}
                  </div>
              {tx.role === "BUYER" && tx.status === "RESERVED" && tx.exchangeCode ? (
                <div className={`exchange-code-panel${tx.exchangeCodeLocked ? " is-locked" : ""}`}>
                  <div>
                    <span className="exchange-code-label">Your exchange code</span>
                    <strong className="exchange-code-value" aria-label={`Exchange code ${tx.exchangeCode.split("").join(" ")}`}>{tx.exchangeCode}</strong>
                  </div>
                  <div className="exchange-code-copy">
                    <p>{tx.exchangeCodeLocked ? "This code is locked after too many incorrect attempts." : "Give this code to the seller only when you have received and checked the item."}</p>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={rotateExchangeCode.isPending}
                      onClick={() => rotateExchangeCode.mutate(tx.id)}
                    >
                      Generate new code
                    </button>
                  </div>
                </div>
              ) : null}
              {tx.role === "SELLER" && tx.status === "RESERVED" ? (
                <form
                  className="exchange-code-entry"
                  onSubmit={(event) => {
                    event.preventDefault();
                    completeExchange.mutate({ id: tx.id, code: exchangeCodeEntries[tx.id] ?? "" });
                  }}
                >
                  <label className="field" htmlFor={`exchange-code-${tx.id}`}>
                    <span>6-digit exchange code</span>
                    <input
                      id={`exchange-code-${tx.id}`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={exchangeCodeEntries[tx.id] ?? ""}
                      disabled={Boolean(tx.exchangeCodeLocked)}
                      onChange={(event) => {
                        const code = event.target.value.replace(/\D/g, "").slice(0, 6);
                        setExchangeCodeEntries((current) => ({ ...current, [tx.id]: code }));
                      }}
                      required
                    />
                  </label>
                  <div>
                    <p>{tx.exchangeCodeLocked ? "The code is locked. Ask the buyer to generate a new one." : "Enter the code during the in-person exchange to mark the listing sold."}</p>
                    <button
                      className="button primary"
                      type="submit"
                      disabled={tx.exchangeCodeLocked || completeExchange.isPending || (exchangeCodeEntries[tx.id]?.length ?? 0) !== 6}
                    >
                      Complete sale
                    </button>
                  </div>
                </form>
              ) : null}
              {tx.status === "COMPLETED" && tx.reviewSubmitted ? (
                <div className="transaction-review-summary" role="status">
                  <div className="transaction-review-heading"><strong>Your review</strong><CheckCircle2 aria-hidden="true" /></div>
                  <span className="sr-only">Already reviewed</span>
                  <p>Verified feedback submitted</p>
                </div>
              ) : tx.status === "COMPLETED" ? (
                <form
                  className="transaction-review-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (review.isPending) return;
                    const f = new FormData(e.currentTarget);
                    review.mutate({
                      id: tx.id,
                      rating: Number(f.get("rating")),
                      text: String(f.get("text")),
                    });
                  }}
                >
                  <div className="transaction-review-heading"><strong>Leave a verified review</strong><span>Helps build a trusted community</span></div>
                  <fieldset className="request-rating-field">
                    <legend className="sr-only">Rating</legend>
                    <div className="request-star-rating">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <label key={rating}>
                          <input type="radio" name="rating" value={rating} defaultChecked={rating === 5} aria-label={`${rating} star${rating === 1 ? "" : "s"}`} />
                          <Star aria-hidden="true" />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="field request-review-text">
                    <span className="sr-only">Short review</span>
                    <textarea
                      name="text"
                      minLength={2}
                      maxLength={1000}
                      rows={3}
                      value={reviewDrafts[tx.id] ?? ""}
                      onChange={(event) => setReviewDrafts((current) => ({ ...current, [tx.id]: event.target.value }))}
                      aria-describedby={`review-count-${tx.id}`}
                      required
                      placeholder="How did the exchange go?"
                    />
                  </label>
                  <span className="request-review-count" id={`review-count-${tx.id}`}>{reviewDrafts[tx.id]?.length ?? 0} / 1000 characters</span>
                  <button type="submit" className="button primary" disabled={review.isPending}>
                    {review.isPending && review.variables?.id === tx.id ? "Submitting…" : "Leave verified review"}
                  </button>
                </form>
              ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {action.error ? (
        <p className="field-error">{action.error.message}</p>
      ) : null}
      {completeExchange.error ? (
        <p className="field-error">{completeExchange.error.message}</p>
      ) : null}
      {rotateExchangeCode.error ? (
        <p className="field-error">{rotateExchangeCode.error.message}</p>
      ) : null}
      {review.error ? (
        <p className="field-error">{review.error.message}</p>
      ) : null}
    </div>
  );
}

export function ProfilePage({ onboarding = false }: { onboarding?: boolean }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const academicDomains = useAcademicDomains(Boolean(user));
  const [avatarId, setAvatarId] = useState<AvatarId>(
    user?.avatarId ?? defaultAvatarId,
  );
  const [avatarDraft, setAvatarDraft] = useState<AvatarId>(
    user?.avatarId ?? defaultAvatarId,
  );
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  useEffect(() => {
    const nextAvatar = user?.avatarId ?? defaultAvatarId;
    setAvatarId(nextAvatar);
    setAvatarDraft(nextAvatar);
  }, [user?.avatarId, user?.id]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(onboarding ? "/api/onboarding/complete" : "/api/auth/me", {
        method: onboarding ? "POST" : "PATCH",
        ...jsonBody(data),
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(onboarding ? "Profile setup complete" : "Profile saved");
      if (onboarding) navigate("/settings?verify=eligibility");
    },
  });
  const avatarMutation = useMutation({
    mutationFn: (nextAvatarId: AvatarId) =>
      api("/api/auth/me/avatar", {
        method: "PATCH",
        ...jsonBody({ avatarId: nextAvatarId }),
      }),
    onSuccess: async (_data, savedAvatarId) => {
      setAvatarId(savedAvatarId);
      await refresh();
      setAvatarDialogOpen(false);
      toast.success("Avatar updated");
    },
  });

  if (!user) return null;
  if (academicDomains.isLoading) {
    return <div className="page narrow"><Loading variant="form" label="Loading supported institutions" /></div>;
  }
  if (academicDomains.isError) {
    return <div className="page narrow"><ErrorState error={academicDomains.error} /></div>;
  }

  const selectedAcademicDomainId = academicDomains.data?.find((entry) =>
    entry.domain === user.studentEmailDomain || entry.institutionName === user.institution
  )?.id ?? "";

  return (
    <div className="page narrow profile-page">
      <div className="page-header profile-page-header">
        <div className="profile-page-heading-copy">
          <h1>{onboarding ? "Set up your profile" : "Your profile"}</h1>
          <p className="lede">
            {onboarding
              ? "Choose how you appear, then add your student details."
              : "Manage how other students see you across Uni Market."}
          </p>
        </div>
        {!onboarding ? (
          <ProfileModeSwitcher activeMode="user" sellerId={user.id} />
        ) : null}
      </div>
      <form
        className="form panel profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          mutation.mutate({
            avatarId,
            displayName: String(form.get("displayName")),
            academicDomainId: String(form.get("academicDomainId")),
            campus: String(form.get("campus")) || null,
            graduationYear: form.get("graduationYear")
              ? Number(form.get("graduationYear"))
              : null,
            ...(onboarding ? {
              adultAttested: form.get("adultAttested") === "on",
              acceptTerms: form.get("policiesAccepted") === "on",
              acknowledgePrivacy: form.get("policiesAccepted") === "on",
              acceptCommunityRules: form.get("policiesAccepted") === "on",
              policyVersion: currentPolicyVersion,
            } : {}),
          });
        }}
      >
        {onboarding ? (
          <AvatarPicker value={avatarId} onChange={setAvatarId} />
        ) : (
          <section className="profile-avatar-card" aria-labelledby="profile-avatar-heading">
            <UserAvatar
              avatarId={avatarId}
              displayName={user.displayName}
              size={104}
            />
            <div>
              <span className="profile-avatar-eyebrow">Profile avatar</span>
              <h2 id="profile-avatar-heading">{user.displayName}</h2>
              <p>This illustration appears in your account menu, listings, and seller profile.</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setAvatarDraft(avatarId);
                  setAvatarDialogOpen(true);
                }}
              >
                Change avatar
              </button>
            </div>
          </section>
        )}

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
          <span>College or institution</span>
          <select name="academicDomainId" defaultValue={selectedAcademicDomainId} required>
            <option value="" disabled>Select your college or institution</option>
            {academicDomains.data?.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.institutionName}</option>
            ))}
          </select>
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
        {onboarding ? (
          <fieldset className="eligibility-policy-card">
            <legend>Eligibility and policies</legend>
            <p className="eligibility-policy-intro">Please confirm both requirements before continuing.</p>
            <div className="eligibility-policy-options">
              <div className="eligibility-policy-option">
                <input id="adultAttested" name="adultAttested" type="checkbox" required aria-describedby="adultAttested-copy" />
                <div className="eligibility-policy-copy">
                  <label htmlFor="adultAttested">I declare that I am at least 18 years old</label>
                  <p id="adultAttested-copy">You must be an adult to create listings or contact other members.</p>
                </div>
              </div>
              <div className="eligibility-policy-option">
                <input id="policiesAccepted" name="policiesAccepted" type="checkbox" required aria-describedby="policiesAccepted-copy" />
                <div className="eligibility-policy-copy">
                  <label htmlFor="policiesAccepted">I accept the platform policies</label>
                  <p id="policiesAccepted-copy">This includes the <Link to="/terms" target="_blank" rel="noreferrer">Terms of use</Link>, <Link to="/seller-policy" target="_blank" rel="noreferrer">Seller policy</Link>, <Link to="/privacy" target="_blank" rel="noreferrer">Privacy notice</Link>, <Link to="/community-rules" target="_blank" rel="noreferrer">Community rules</Link>, and <Link to="/prohibited-items" target="_blank" rel="noreferrer">prohibited-items rules</Link>.</p>
                </div>
              </div>
            </div>
          </fieldset>
        ) : null}
        <SubmitButton pending={mutation.isPending}>
          {onboarding ? "Continue" : "Save profile"}
        </SubmitButton>
        {mutation.error ? (
          <p className="field-error">{mutation.error.message}</p>
        ) : null}
      </form>

      {!onboarding ? (
        <AvatarPickerDialog
          open={avatarDialogOpen}
          value={avatarDraft}
          onChange={setAvatarDraft}
          onClose={() => {
            if (!avatarMutation.isPending) setAvatarDialogOpen(false);
          }}
          onSave={() => avatarMutation.mutate(avatarDraft)}
          pending={avatarMutation.isPending}
          error={avatarMutation.error?.message}
        />
      ) : null}
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
            <Loading label="Loading notifications" />
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
                        className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-surface bg-notification"
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

export { SupportPage, SupportDetailPage } from "./SupportPages";

type EmailPreferenceValues = {
  enabled: boolean;
  listingUpdates: boolean;
  transactionUpdates: boolean;
  messageUpdates: boolean;
  policyReminders: boolean;
  updatedAt: string | null;
};

const emailPreferenceGroups = [
  {
    id: "marketplace-activity",
    keys: ["listingUpdates", "transactionUpdates"],
    label: "Marketplace activity",
    description: "Listing approvals, reservation requests, exchanges, and other marketplace activity.",
  },
  {
    id: "messages",
    keys: ["messageUpdates"],
    label: "Messages",
    description: "Get notified when someone starts a conversation about one of your listings.",
  },
  {
    id: "policy-reminders",
    keys: ["policyReminders"],
    label: "Policy & reminders",
    description: "Important reminders and updates when marketplace policies need your attention.",
  },
] as const;

type EmailPreferenceKey = keyof Omit<EmailPreferenceValues, "updatedAt">;
type EmailPreferencePatch = Partial<Pick<EmailPreferenceValues, EmailPreferenceKey>>;
type EmailCategoryPreferenceKey = Exclude<EmailPreferenceKey, "enabled">;

function emailPreferenceGroupPatch(
  preferences: EmailPreferenceValues,
  keys: readonly EmailCategoryPreferenceKey[],
  checked: boolean,
): EmailPreferencePatch {
  const patch: EmailPreferencePatch = preferences.enabled
    ? {}
    : {
        enabled: true,
        listingUpdates: false,
        transactionUpdates: false,
        messageUpdates: false,
        policyReminders: false,
      };
  for (const key of keys) patch[key] = !checked;
  return patch;
}

function EmailPreferencesCard() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["email-preferences"],
    queryFn: () => api<EmailPreferenceValues>("/api/email-preferences"),
  });
  const update = useMutation({
    mutationFn: (patch: EmailPreferencePatch) =>
      api<EmailPreferenceValues>("/api/email-preferences", { method: "PATCH", ...jsonBody(patch) }),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: ["email-preferences"] });
      const previous = client.getQueryData<EmailPreferenceValues>(["email-preferences"]);
      if (previous) client.setQueryData<EmailPreferenceValues>(["email-preferences"], { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(["email-preferences"], context.previous);
    },
    onSuccess: (preferences) => {
      client.setQueryData(["email-preferences"], preferences);
      toast.success("Email preferences updated");
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ["email-preferences"] }),
  });
  const preferences = query.data;
  return (
    <section id="email-notifications-settings" className="settings-wide-card email-preferences-card" aria-labelledby="email-preferences-title" tabIndex={-1}>
      <header>
        <span className="settings-card-icon"><Mail aria-hidden="true" /></span>
        <div><h2 id="email-preferences-title">Email Notifications</h2><p>Choose which marketplace updates arrive in your inbox.</p></div>
      </header>
      {query.isLoading ? <Loading label="Loading email preferences" /> : query.isError ? <ErrorState error={query.error} /> : preferences ? (
        <div className="email-preference-list" aria-busy={update.isPending}>
          {emailPreferenceGroups.map((group) => {
            const checked = preferences.enabled && group.keys.every((key) => preferences[key]);
            const inputId = `email-preference-${group.id}`;
            const descriptionId = `${inputId}-description`;
            return (
              <label className="email-preference-row" htmlFor={inputId} key={group.id}>
                <span className="email-preference-copy">
                  <strong>{group.label}</strong>
                  <span id={descriptionId}>{group.description}</span>
                </span>
                <span className="email-preference-control">
                  <span className="preference-switch-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
                  <input
                    id={inputId}
                    className="preference-switch-input"
                    type="checkbox"
                    role="switch"
                    checked={checked}
                    aria-checked={checked}
                    aria-label={group.label}
                    aria-describedby={descriptionId}
                    disabled={update.isPending}
                    onChange={() => update.mutate(emailPreferenceGroupPatch(preferences, group.keys, checked))}
                  />
                  <span className="preference-switch" aria-hidden="true"><span /></span>
                </span>
              </label>
            );
          })}
          <aside className="required-email-note" aria-labelledby="required-email-title">
            <h3 id="required-email-title">Required notifications</h3>
            <p>Verification codes, account security, support replies, and grievance updates are always enabled because they are required to provide these services.</p>
          </aside>
          {update.error ? <p className="field-error" role="alert">{update.error.message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsPage() {
  const { user, refresh, clearSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusedSection = useRef<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [requestId, setRequestId] = useState<string>();
  const [studentEmailLocalPart, setStudentEmailLocalPart] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [studentCodeSent, setStudentCodeSent] = useState(false);
  const [studentResendCooldown, setStudentResendCooldown] = useState(0);
  const [studentRequestId, setStudentRequestId] = useState<string>();
  const [activeVerification, setActiveVerification] = useState<"phone" | "student">(
    user?.phoneVerifiedAt ? "student" : "phone",
  );
  const [captchaInitializationError, setCaptchaInitializationError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const verificationConfig = useQuery({
    queryKey: ["phone-verification-config"],
    queryFn: () => api<VerificationProviderConfig>("/api/phone/config"),
    enabled: !user?.phoneVerifiedAt,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const studentVerificationConfig = useQuery({
    queryKey: ["student-email-verification-config"],
    queryFn: () => api<VerificationProviderConfig>("/api/student-email/config"),
    enabled: !user?.studentEmailVerifiedAt,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const academicDomains = useAcademicDomains(Boolean(user && !user.studentEmailVerifiedAt));
  const selectedAcademicDomain = academicDomains.data?.find((entry) =>
    entry.domain === user?.studentEmailDomain || (!user?.studentEmailDomain && entry.institutionName === user?.institution)
  );
  const studentEmail = selectedAcademicDomain && studentEmailLocalPart.trim()
    ? `${studentEmailLocalPart.trim()}@${selectedAcademicDomain.domain}`.toLowerCase()
    : "";
  async function prepareVerificationCard(target: "phone" | "student") {
    setActiveVerification(target);
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
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

      let result: unknown;
      if (codeSent) {
        result = await retryMsg91Otp(requestId);
      } else {
        await prepareVerificationCard("phone");
        await initializeMsg91({
          widgetId: provider.widgetId,
          tokenAuth: provider.tokenAuth,
          captchaRenderId: "msg91-phone-captcha",
        });
        result = await sendMsg91Otp(msg91Identifier(phone));
      }
      return {
        retryAfter: provider.retryAfter,
        requestId: msg91RequestId(result) ?? requestId,
      };
    },
    onSuccess: ({ retryAfter, requestId: nextRequestId }) => {
      detachMsg91Captcha();
      setCodeSent(true);
      setResendCooldown(retryAfter);
      setRequestId(nextRequestId);
      toast.success("Verification code sent");
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
    onSuccess: async () => {
      detachMsg91Captcha();
      await refresh();
      toast.success("Phone verified");
    },
  });
  const sendStudentCode = useMutation({
    mutationFn: async () => {
      const provider = studentVerificationConfig.data;
      if (!provider) throw new Error("Student email verification is not ready");
      if (provider.provider === "development") {
        const result = await api<{ retryAfter: number }>("/api/student-email/send", {
          method: "POST",
          ...jsonBody({ email: studentEmail }),
        });
        return { ...result, requestId: undefined };
      }

      await api("/api/student-email/check-availability", {
        method: "POST",
        ...jsonBody({ email: studentEmail }),
      });
      let result: unknown;
      if (studentCodeSent) {
        result = await retryMsg91Otp(studentRequestId, "3");
      } else {
        await prepareVerificationCard("student");
        await initializeMsg91({
          widgetId: provider.widgetId,
          tokenAuth: provider.tokenAuth,
          captchaRenderId: "msg91-student-email-captcha",
        });
        result = await sendMsg91Otp(studentEmail.trim().toLowerCase());
      }
      return {
        retryAfter: provider.retryAfter,
        requestId: msg91RequestId(result) ?? studentRequestId,
      };
    },
    onSuccess: ({ retryAfter, requestId: nextRequestId }) => {
      detachMsg91Captcha();
      setStudentCodeSent(true);
      setStudentResendCooldown(retryAfter);
      setStudentRequestId(nextRequestId);
      toast.success("Student email code sent");
    },
  });
  const verifyStudentEmail = useMutation({
    mutationFn: async () => {
      const provider = studentVerificationConfig.data;
      if (!provider) throw new Error("Student email verification is not ready");
      if (provider.provider === "development") {
        return api("/api/student-email/verify", {
          method: "POST",
          ...jsonBody({ email: studentEmail, code: studentCode }),
        });
      }

      const result = await verifyMsg91Otp(studentCode, studentRequestId);
      return api("/api/student-email/verify-provider", {
        method: "POST",
        ...jsonBody({ email: studentEmail, accessToken: msg91AccessToken(result) }),
      });
    },
    onSuccess: async () => {
      detachMsg91Captcha();
      await refresh();
      toast.success("Student email verified");
    },
  });
  const revokeSessions = useMutation({
    mutationFn: () => api("/api/account/revoke-sessions", { method: "POST" }),
    onSuccess: () => {
      toast.success("All sessions revoked");
      clearCsrf();
      clearSession();
      navigate("/login");
    },
  });
  const deleteAccount = useMutation({
    mutationFn: () => api("/api/account", { method: "DELETE", ...jsonBody({ confirmation: deleteConfirmation }) }),
    onSuccess: () => {
      clearCsrf();
      clearSession();
      navigate("/login", {
        replace: true,
        state: { accountClosureQueued: true },
      });
    },
  });
  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      clearCsrf();
      clearSession();
      navigate("/");
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
  useEffect(() => {
    if (studentResendCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setStudentResendCooldown((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [studentResendCooldown]);
  useEffect(() => {
    if (user?.phoneVerifiedAt && !user.studentEmailVerifiedAt) {
      setActiveVerification("student");
    }
  }, [user?.phoneVerifiedAt, user?.studentEmailVerifiedAt]);
  useEffect(() => {
    if (!user?.marketplaceEligible) return;
    const intent = pendingContact();
    if (intent) navigate(intent.returnTo, { replace: true });
  }, [navigate, user?.marketplaceEligible]);
  useEffect(() => {
    const section = searchParams.get("section");
    if (section !== "email" || focusedSection.current === section) return;
    focusedSection.current = section;
    window.requestAnimationFrame(() => {
      const target = document.getElementById("email-notifications-settings");
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
  }, [searchParams]);
  useEffect(() => {
    const provider = activeVerification === "phone"
      ? verificationConfig.data
      : studentVerificationConfig.data;
    const alreadyVerified = activeVerification === "phone"
      ? Boolean(user?.phoneVerifiedAt)
      : Boolean(user?.studentEmailVerifiedAt);
    const codeAlreadySent = activeVerification === "phone"
      ? codeSent
      : studentCodeSent;
    if (!provider || provider.provider !== "msg91" || alreadyVerified || codeAlreadySent || (activeVerification === "student" && !selectedAcademicDomain)) return;

    setCaptchaInitializationError("");
    void initializeMsg91({
      widgetId: provider.widgetId,
      tokenAuth: provider.tokenAuth,
      captchaRenderId: activeVerification === "phone"
        ? "msg91-phone-captcha"
        : "msg91-student-email-captcha",
    }).catch((error: unknown) => {
      setCaptchaInitializationError(
        error instanceof Error ? error.message : "Verification could not be loaded",
      );
    });
  }, [activeVerification, codeSent, selectedAcademicDomain, studentCodeSent, studentVerificationConfig.data, user?.phoneVerifiedAt, user?.studentEmailVerifiedAt, verificationConfig.data]);
  const otpLength = verificationConfig.data?.otpLength ?? 4;
  const studentOtpLength = studentVerificationConfig.data?.otpLength ?? 6;
  const eligibilityItems = [
    { label: "Age & policies", detail: "18+ declaration and current policies", complete: Boolean(user?.eligibility?.adultAttested && user?.eligibility?.policiesAccepted), targetId: "age-policies-settings" },
    { label: "Mobile number", detail: "Verified Indian mobile number", complete: Boolean(user?.eligibility?.phoneVerified), targetId: "phone-verification-settings", verification: "phone" as const },
    { label: "Student email", detail: "Verified academic email address", complete: Boolean(user?.eligibility?.studentEmailVerified), targetId: "student-email-settings", verification: "student" as const },
  ];
  function scrollToEligibility(targetId: string, verification?: "phone" | "student") {
    if (verification) setActiveVerification(verification);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
      target.focus({ preventScroll: true });
    });
  }
  return (
    <div className="page settings-page">
      <header className="settings-masthead">
        <div><h1>Settings</h1><p>Manage verification, email, privacy, and account security.</p></div>
        <Link className="button secondary" to="/profile">Edit Profile</Link>
      </header>

      <section className="eligibility-overview" aria-labelledby="eligibility-title">
        <div className="eligibility-overview-heading">
          <div><h2 id="eligibility-title">Your eligibility</h2></div>
          <StatusBadge value={user?.marketplaceEligible ? "VERIFIED" : "INCOMPLETE"} />
        </div>
        <div className="eligibility-checks">
          {eligibilityItems.map((item) => <button type="button" className={item.complete ? "is-complete" : ""} key={item.label} aria-controls={item.targetId} onClick={() => scrollToEligibility(item.targetId, item.verification)}>{item.complete ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}<span><strong>{item.label}</strong><span>{item.detail}</span></span><ChevronRight className="eligibility-check-chevron" aria-hidden="true" /></button>)}
        </div>
        <p className="eligibility-guidance">{user?.marketplaceEligible ? "You can list, message, and transact." : "Complete all 3 checks to use marketplace features. Your Google sign-in and student email can be different."}</p>
      </section>

      <div className="settings-grid">
        <section id="age-policies-settings" className="settings-card settings-card-wide" aria-labelledby="age-policies-title" tabIndex={-1}>
          <header><span className="settings-card-icon"><ShieldCheck aria-hidden="true" /></span><div><h2 id="age-policies-title">Age & Policies</h2><p>Your marketplace eligibility declarations.</p></div></header>
          {user?.eligibility?.adultAttested && user?.eligibility?.policiesAccepted ? <div className="verification-complete"><CheckCircle2 aria-hidden="true" /><div><strong>Your requirements are complete</strong><span>Your 18+ declaration and current policy acceptance are recorded.</span></div></div> : <div className="settings-card-form"><p className="verification-setup-note">Your age declaration or policy acceptance needs attention.</p><Link className="button secondary" to="/onboarding">Review Requirements</Link></div>}
        </section>

        <section id="phone-verification-settings" className="settings-card" aria-labelledby="phone-verification-title" tabIndex={-1}>
          <header><span className="settings-card-icon"><Smartphone aria-hidden="true" /></span><div><h2 id="phone-verification-title">Mobile Number</h2><p>Kept private and used for account trust.</p></div></header>
          {user?.phoneVerifiedAt ? <div className="verification-complete"><CheckCircle2 aria-hidden="true" /><div><strong>Your phone is verified</strong><span>Your Indian mobile number is confirmed.</span></div></div> : <div className="settings-card-form" onFocusCapture={() => setActiveVerification("phone")}>
            <label className="field"><span>Indian mobile number</span><input name="phone" type="tel" value={phone} onChange={(event) => { setPhone(event.target.value); if (codeSent) { setCodeSent(false); setCode(""); setRequestId(undefined); setResendCooldown(0); } }} placeholder="e.g. 98765 43210…" inputMode="tel" autoComplete="tel" disabled={send.isPending || verify.isPending} /></label>
            {activeVerification === "phone" && !codeSent ? <div id="msg91-phone-captcha" className="msg91-captcha-slot" /> : null}
            <button type="button" className="button secondary" onClick={() => send.mutate()} disabled={verificationConfig.isPending || send.isPending || resendCooldown > 0}>{send.isPending ? "Sending…" : codeSent ? resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code" : "Send Code"}</button>
            {codeSent ? <><label className="field"><span>{otpLength}-digit code</span><input name="phoneCode" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, otpLength))} inputMode="numeric" autoComplete="one-time-code" maxLength={otpLength} /></label><button type="button" className="button primary" onClick={() => verify.mutate()} disabled={verify.isPending || code.length !== otpLength || !/^\d+$/.test(code)}>{verify.isPending ? "Verifying…" : "Verify Phone"}</button></> : null}
            {send.error ? <p className="field-error" role="alert">{send.error.message}</p> : null}{verify.error ? <p className="field-error" role="alert">{verify.error.message}</p> : null}{verificationConfig.error ? <p className="field-error" role="alert">{verificationConfig.error.message}</p> : null}{activeVerification === "phone" && captchaInitializationError ? <p className="field-error" role="alert">{captchaInitializationError}</p> : null}
          </div>}
        </section>

        <section id="student-email-settings" className="settings-card" aria-labelledby="student-email-title" tabIndex={-1}>
          <header><span className="settings-card-icon"><MailCheck aria-hidden="true" /></span><div><h2 id="student-email-title">Student Email</h2><p>Verified separately from your Google sign-in.</p></div></header>
          {user?.studentEmailVerifiedAt ? <div className="verification-complete"><CheckCircle2 aria-hidden="true" /><div><strong>{user.studentEmailMasked} is verified</strong><span>Valid until {user.studentEmailExpiresAt ? accountDateFormatter.format(new Date(user.studentEmailExpiresAt)) : "12 months after verification"}.</span></div></div> : <div className="settings-card-form" onFocusCapture={() => setActiveVerification("student")}>
            {academicDomains.isPending ? <Loading label="Loading student email domain" /> : selectedAcademicDomain ? <>
              <label className="field"><span>Student email</span><div className="student-email-address"><input aria-label="Student email" name="studentEmailLocalPart" type="text" value={studentEmailLocalPart} onChange={(event) => { setStudentEmailLocalPart(event.target.value.replace(/@.*$/, "")); setStudentCodeSent(false); setStudentCode(""); setStudentRequestId(undefined); setStudentResendCooldown(0); }} autoComplete="username" spellCheck={false} placeholder="your.name" /><span aria-hidden="true">@{selectedAcademicDomain.domain}</span></div></label>
              {activeVerification === "student" && !studentCodeSent ? <div id="msg91-student-email-captcha" className="msg91-captcha-slot" /> : null}
              <button type="button" className="button secondary" onClick={() => sendStudentCode.mutate()} disabled={studentVerificationConfig.isPending || sendStudentCode.isPending || !studentEmail || studentResendCooldown > 0}>{sendStudentCode.isPending ? "Sending…" : studentCodeSent ? studentResendCooldown > 0 ? `Resend in ${studentResendCooldown}s` : "Resend Code" : "Send Email Code"}</button>
            </> : <p className="verification-setup-note">Choose a supported college or institution in <Link to="/profile">your profile</Link> before verifying your student email.</p>}
            {studentCodeSent ? <><label className="field"><span>{studentOtpLength}-digit email code</span><input name="studentCode" value={studentCode} onChange={(event) => setStudentCode(event.target.value.replace(/\D/g, "").slice(0, studentOtpLength))} inputMode="numeric" autoComplete="one-time-code" maxLength={studentOtpLength} /></label><button type="button" className="button primary" onClick={() => verifyStudentEmail.mutate()} disabled={verifyStudentEmail.isPending || studentCode.length !== studentOtpLength}>{verifyStudentEmail.isPending ? "Verifying…" : "Verify Student Email"}</button></> : null}
            {sendStudentCode.error ? <p className="field-error" role="alert">{sendStudentCode.error.message}</p> : null}{verifyStudentEmail.error ? <p className="field-error" role="alert">{verifyStudentEmail.error.message}</p> : null}{studentVerificationConfig.error ? <p className="field-error" role="alert">{studentVerificationConfig.error.message}</p> : null}{academicDomains.error ? <p className="field-error" role="alert">{academicDomains.error.message}</p> : null}{activeVerification === "student" && captchaInitializationError ? <p className="field-error" role="alert">{captchaInitializationError}</p> : null}
          </div>}
        </section>
      </div>

      <EmailPreferencesCard />

      <section className="settings-wide-card" aria-labelledby="privacy-controls-title">
        <header><div><h2 id="privacy-controls-title">Privacy & Security</h2><p>Export your information or sign out every active device.</p></div></header>
        <div className="settings-action-list">
          <div><span className="settings-action-icon"><Download aria-hidden="true" /></span><div><strong>Download account data</strong><p>Get a machine-readable export with other members’ private details removed.</p></div><a className="button secondary" href={`${API_URL}/api/account/export`} download>Download Data</a></div>
          <div><span className="settings-action-icon"><KeyRound aria-hidden="true" /></span><div><strong>Revoke all sessions</strong><p>Sign out every device, including this one.</p></div><button type="button" className="button secondary" onClick={() => revokeSessions.mutate()} disabled={revokeSessions.isPending}>{revokeSessions.isPending ? "Revoking…" : "Revoke Sessions"}</button></div>
        </div>
        {revokeSessions.error ? <p className="field-error" role="alert">{revokeSessions.error.message}</p> : null}
      </section>

      <section className="settings-wide-card danger-zone" aria-labelledby="delete-account-title">
        <header><span className="settings-card-icon"><Trash2 aria-hidden="true" /></span><div><h2 id="delete-account-title">Close Account</h2><p>Access ends immediately. Eligible data is deleted or anonymised after 180 days; legal holds and required records can remain longer.</p></div></header>
        <div className="danger-zone-action"><label className="field"><span>Type <strong>DELETE MY ACCOUNT</strong> to confirm</span><input name="deleteConfirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /></label><button type="button" className="button danger" onClick={() => deleteAccount.mutate()} disabled={deleteAccount.isPending || deleteConfirmation !== "DELETE MY ACCOUNT"}>{deleteAccount.isPending ? "Closing Account…" : "Close Account"}</button></div>
        {deleteAccount.error ? <p className="field-error" role="alert">{deleteAccount.error.message}</p> : null}
      </section>

      <section className="settings-signout"><div><LogOut aria-hidden="true" /><div><strong>Sign out of this device</strong><p>Your current secure session will end.</p></div></div><button type="button" className="button secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing Out…" : "Sign Out"}</button></section>
    </div>
  );
}
