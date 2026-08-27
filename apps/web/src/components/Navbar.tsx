import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CircleHelp,
  LogIn,
  LogOut,
  MenuIcon,
  ReceiptText,
  Settings,
  Store,
  UserRound,
} from "lucide-react";
import { api, clearCsrf } from "../api";
import { useAuth } from "../auth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Button } from "./ui/button";
import { NotificationTray } from "./NotificationTray";
import { MarketplaceSearch } from "./MarketplaceSearch";
import { ThemeToggle } from "./ThemeToggle";
import { UserAvatar } from "./UserAvatar";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "./ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

interface Category {
  id: string;
  name: string;
  slug?: string;
  description?: string;
}

const DROPDOWN_ITEMS = [
  {
    title: "Browse all",
    description: "Search, filter & discover all campus listings",
    slug: "",
    href: "/browse",
  },
  {
    title: "Books & notes",
    description: "Textbooks, reference material, course notes",
    slug: "books-notes",
  },
  {
    title: "Electronics",
    description: "Laptops, phones, calculators, electronics",
    slug: "electronics",
  },
  {
    title: "Furniture",
    description: "Chairs, study desks, mattresses, racks",
    slug: "furniture",
  },
  {
    title: "Cycles & transport",
    description: "Browse listings in Cycles & transport",
    slug: "cycles-transport",
  },
  {
    title: "Clothing",
    description: "College wear, lab coats, sportswear",
    slug: "clothing",
  },
  {
    title: "Sports",
    description: "Cycles, gym gear, racquets, equipment",
    slug: "sports",
  },
  {
    title: "Room essentials",
    description: "Browse listings in Room essentials",
    slug: "room-essentials",
  },
  {
    title: "Other",
    description: "Hostel essentials and miscellaneous items",
    slug: "other",
  },
];

function getCategoryHref(
  item: (typeof DROPDOWN_ITEMS)[number],
  categories: Category[],
): string {
  if (item.href) return item.href;
  const match = categories.find(
    (c) =>
      c.name.toLowerCase() === item.title.toLowerCase() ||
      c.slug === item.slug ||
      c.name.toLowerCase().includes(item.slug.replace("-", " ")),
  );
  if (match) {
    return `/browse?category=${match.id}`;
  }
  return `/browse?q=${encodeURIComponent(item.title)}`;
}

function ProfileMenu({ compact = false }: { compact?: boolean }) {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      clearCsrf();
      clearSession();
      setMenuOpen(false);
      navigate("/");
    },
  });

  const itemClass =
    "flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`grid place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:border-sandalwood hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 ${
          compact ? "size-8" : "size-9"
        }`}
        onClick={() => setMenuOpen((current) => !current)}
        aria-label={user ? `${user.displayName} account menu` : "Account menu"}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
      >
        {user ? (
          <UserAvatar
            avatarId={user.avatarId}
            displayName={user.displayName}
            size={compact ? 28 : 32}
            decorative
          />
        ) : (
          <UserRound className="size-4" aria-hidden="true" />
        )}
      </button>

      {menuOpen ? (
        <section
          className="absolute right-0 top-[calc(100%+12px)] z-[70] w-[260px] overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-[0_18px_50px_rgba(16,18,17,0.16)]"
          role="dialog"
          aria-label="Account menu"
        >
          {user ? (
            <div className="mb-1 grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-3 pb-3 pt-2">
              <UserAvatar avatarId={user.avatarId} displayName={user.displayName} size={40} decorative />
              <strong className="col-start-2 block truncate text-[14px] font-semibold text-ink">
                {user.displayName}
              </strong>
              <span className="col-start-2 mt-0.5 block truncate text-[11px] text-muted">
                {user.email}
              </span>
            </div>
          ) : null}

          <div className="grid gap-1">
            {user ? (
              <Link
                to="/profile"
                className={itemClass}
                onClick={() => setMenuOpen(false)}
              >
                <UserRound className="size-4 text-muted" aria-hidden="true" />
                Profile
              </Link>
            ) : (
              <Link
                to="/login"
                className={itemClass}
                onClick={() => setMenuOpen(false)}
              >
                <LogIn className="size-4 text-muted" aria-hidden="true" />
                Sign in
              </Link>
            )}

            <Link
              to="/sell"
              className={itemClass}
              onClick={() => setMenuOpen(false)}
            >
              <Store className="size-4 text-muted" aria-hidden="true" />
              Sell an item
            </Link>

            {user ? (
              <>
                <Link
                  to="/requests"
                  className={itemClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <ReceiptText className="size-4 text-muted" aria-hidden="true" />
                  Requests
                </Link>
                <Link
                  to="/settings"
                  className={itemClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <Settings className="size-4 text-muted" aria-hidden="true" />
                  Settings
                </Link>
                <Link
                  to="/support"
                  className={itemClass}
                  onClick={() => setMenuOpen(false)}
                >
                  <CircleHelp className="size-4 text-muted" aria-hidden="true" />
                  Support
                </Link>
              </>
            ) : null}

            <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-[14px] font-medium text-ink">
              <span>Appearance</span>
              <ThemeToggle />
            </div>

            {user ? (
              <button
                type="button"
                className={`${itemClass} text-[#b42318] dark:text-[#f87171]`}
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                <LogOut className="size-4" aria-hidden="true" />
                {logout.isPending ? "Signing out..." : "Sign out"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export const Navbar = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setIsScrolled(currentScrollY > 15);

      if (currentScrollY < 30) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY.current && currentScrollY > 70) {
        // Scrolling down
        setIsVisible(false);
      } else if (currentScrollY < lastScrollY.current) {
        // Scrolling up
        setIsVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isAdmin = user?.roles.some((role) =>
    ["MODERATOR", "SUPPORT_AGENT", "SUPER_ADMIN"].includes(role),
  );

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/api/categories"),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <header
      data-site-header
      className={`sticky top-0 z-40 w-full transition-all duration-300 ease-in-out ${
        isScrolled
          ? "bg-surface/60 backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_0_rgba(0,0,0,0.05)]"
          : "bg-surface/25 backdrop-blur-xl backdrop-saturate-150"
      } ${isVisible ? "translate-y-0" : "-translate-y-full"}`}
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <nav className="flex h-[60px] items-center justify-between">
          {/* Brand (Left) */}
          <div className="flex shrink-0 items-center">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-[20px] font-bold tracking-[-0.035em] text-ink transition-opacity hover:opacity-85"
            >
              <span className="text-accent">Uni</span>
              <span>Market</span>
            </Link>
          </div>

          {/* Desktop Navigation (Center) */}
          <div className="hidden flex-1 items-center justify-center lg:flex">
            <NavigationMenu>
              <NavigationMenuList className="gap-1.5">
                {/* Browse Dropdown */}
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="navbar-primary-link text-[15px] !font-medium !text-muted transition-colors hover:!text-ink dark:hover:!text-ink dark:data-[state=open]:!text-ink">
                    Browse
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[580px] grid-cols-2 gap-1.5 p-3.5 bg-surface shadow-[0_16px_36px_rgba(0,0,0,0.06)] rounded-2xl border border-line">
                      {DROPDOWN_ITEMS.map((item, index) => {
                        const href = getCategoryHref(item, categories);
                        return (
                          <NavigationMenuLink
                            asChild
                            key={index}
                            className="rounded-xl p-2.5 transition-colors duration-150 hover:bg-surface-muted group block outline-none focus:bg-surface-muted"
                          >
                            <Link to={href}>
                              <div>
                                <p className="mb-0.5 text-[15px] font-medium text-ink group-hover:text-accent transition-colors leading-tight">
                                  {item.title}
                                </p>
                                <p className="text-[13px] text-muted font-normal leading-snug line-clamp-1">
                                  {item.description}
                                </p>
                              </div>
                            </Link>
                          </NavigationMenuLink>
                        );
                      })}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>

                {/* Saved Link */}
                <NavigationMenuItem>
                  <NavigationMenuLink
                    asChild
                    className={navigationMenuTriggerStyle()}
                  >
                    <NavLink
                      to="/saved"
                      className="navbar-primary-link !font-medium !text-muted hover:!text-ink dark:hover:!text-ink"
                    >
                      Saved
                    </NavLink>
                  </NavigationMenuLink>
                </NavigationMenuItem>

                {/* Chats Link */}
                <NavigationMenuItem>
                  <NavigationMenuLink
                    asChild
                    className={navigationMenuTriggerStyle()}
                  >
                    <NavLink
                      to="/chats"
                      className="navbar-primary-link !font-medium !text-muted hover:!text-ink dark:hover:!text-ink"
                    >
                      Chats
                    </NavLink>
                  </NavigationMenuLink>
                </NavigationMenuItem>

                {/* My listings Link */}
                <NavigationMenuItem>
                  <NavigationMenuLink
                    asChild
                    className={navigationMenuTriggerStyle()}
                  >
                    <NavLink
                      to="/requests"
                      className="navbar-primary-link !font-medium !text-muted hover:!text-ink dark:hover:!text-ink"
                    >
                      Requests
                    </NavLink>
                  </NavigationMenuLink>
                </NavigationMenuItem>

                {/* My listings Link */}
                <NavigationMenuItem>
                  <NavigationMenuLink
                    asChild
                    className={navigationMenuTriggerStyle()}
                  >
                    <NavLink
                      to="/my-listings"
                      className="navbar-primary-link !font-medium !text-muted hover:!text-ink dark:hover:!text-ink"
                    >
                      My listings
                    </NavLink>
                  </NavigationMenuLink>
                </NavigationMenuItem>

                {/* Admin Link (Conditional) */}
                {isAdmin ? (
                  <NavigationMenuItem>
                    <NavigationMenuLink
                      asChild
                      className={navigationMenuTriggerStyle()}
                    >
                      <NavLink
                        to="/admin"
                        className="navbar-primary-link !font-medium !text-muted hover:!text-ink dark:hover:!text-ink"
                      >
                        Admin
                      </NavLink>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                ) : null}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* Right Action Buttons */}
          <div className="hidden shrink-0 items-center gap-2.5 lg:flex">
            <MarketplaceSearch enableShortcut />
            {user ? <NotificationTray /> : null}
            <ProfileMenu />
          </div>

          {/* Mobile Menu Button & Sheet */}
          <div className="flex items-center gap-2 lg:hidden">
            <MarketplaceSearch compact />
            {user ? <NotificationTray mobile /> : null}
            <ProfileMenu compact />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full border-line text-ink"
                  aria-label="Open menu"
                >
                  <MenuIcon className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="top"
                className="max-h-screen overflow-auto bg-surface/95 backdrop-blur-xl border-b border-line"
              >
                <SheetHeader className="border-b border-line pb-3">
                  <SheetTitle>
                    <Link
                      to="/"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-1.5 text-[20px] font-bold tracking-[-0.03em] text-ink"
                    >
                      <span className="text-accent">Uni</span>
                      <span>Market</span>
                    </Link>
                  </SheetTitle>
                </SheetHeader>
                <div className="flex flex-col p-4">
                  <Accordion type="single" collapsible className="mt-2 mb-2">
                    <AccordionItem value="browse" className="border-none">
                      <AccordionTrigger className="text-[15px] font-medium text-ink hover:no-underline py-2.5">
                        Browse
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid md:grid-cols-2 gap-1 pt-1">
                          {DROPDOWN_ITEMS.map((item, index) => {
                            const href = getCategoryHref(item, categories);
                            return (
                              <Link
                                to={href}
                                key={index}
                                onClick={() => setOpen(false)}
                                className="rounded-xl p-2.5 transition-colors hover:bg-brand-hover/[0.03] block"
                              >
                                <div>
                                  <p className="mb-0.5 text-[14px] font-medium text-ink">
                                    {item.title}
                                  </p>
                                  <p className="text-[12px] text-muted line-clamp-1">
                                    {item.description}
                                  </p>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  <div className="flex flex-col gap-3 py-2 border-t border-line">
                    <Link
                      to="/saved"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-muted hover:text-ink transition-colors py-1"
                    >
                      Saved
                    </Link>
                    <Link
                      to="/chats"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-muted hover:text-ink transition-colors py-1"
                    >
                      Chats
                    </Link>
                    <Link
                      to="/requests"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-muted hover:text-ink transition-colors py-1"
                    >
                      Requests
                    </Link>
                    <Link
                      to="/my-listings"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-muted hover:text-ink transition-colors py-1"
                    >
                      My listings
                    </Link>
                    {isAdmin ? (
                      <Link
                        to="/admin"
                        onClick={() => setOpen(false)}
                        className="text-[15px] font-medium text-accent transition-colors py-1"
                      >
                        Admin
                      </Link>
                    ) : null}
                    {user ? (
                      <>
                        <Link
                          to="/notifications"
                          onClick={() => setOpen(false)}
                          className="text-[15px] font-normal text-muted hover:text-ink transition-colors py-1"
                        >
                          Notifications
                        </Link>
                        <Link
                          to="/profile"
                          onClick={() => setOpen(false)}
                          className="text-[15px] font-normal text-muted hover:text-ink transition-colors py-1"
                        >
                          Profile ({user.displayName})
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </nav>
      </div>
    </header>
  );
};
