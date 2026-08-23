import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, MenuIcon } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Button } from "./ui/button";
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
      className={`sticky top-0 z-40 w-full transition-all duration-300 ease-in-out ${
        isScrolled
          ? "bg-white/85 backdrop-blur-md shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          : "bg-transparent"
      } ${isVisible ? "translate-y-0" : "-translate-y-full"}`}
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <nav className="flex h-[60px] items-center justify-between">
          {/* Brand (Left) */}
          <div className="flex shrink-0 items-center">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-[20px] font-semibold tracking-[-0.035em] text-[#111827] transition-opacity hover:opacity-85"
            >
              <span className="text-[#176b45]">Uni</span>
              <span>Market</span>
            </Link>
          </div>

          {/* Desktop Navigation (Center) */}
          <div className="hidden flex-1 items-center justify-center lg:flex">
            <NavigationMenu>
              <NavigationMenuList className="gap-1.5">
                {/* Browse Dropdown */}
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="text-[15px] font-medium text-[#6b7280] hover:text-[#111827] transition-colors">
                    Browse
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div
                      style={{ backgroundColor: "#ffffff" }}
                      className="grid w-[580px] grid-cols-2 gap-1.5 p-3.5 bg-white shadow-[0_16px_36px_rgba(0,0,0,0.06)] rounded-2xl border border-[#ebebeb]"
                    >
                      {DROPDOWN_ITEMS.map((item, index) => {
                        const href = getCategoryHref(item, categories);
                        return (
                          <NavigationMenuLink
                            asChild
                            key={index}
                            className="rounded-xl p-2.5 transition-colors duration-150 hover:bg-[#f5f6f5] group block outline-none focus:bg-[#f5f6f5]"
                          >
                            <Link to={href}>
                              <div>
                                <p className="mb-0.5 text-[15px] font-medium text-[#111827] group-hover:text-[#176b45] transition-colors leading-tight">
                                  {item.title}
                                </p>
                                <p className="text-[13px] text-[#6b7280] font-normal leading-snug line-clamp-1">
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
                      className={({ isActive }) =>
                        isActive
                          ? "text-[#6b7280] font-medium"
                          : "text-[#6b7280] hover:text-[#111827] font-normal"
                      }
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
                      className={({ isActive }) =>
                        isActive
                          ? "text-[#111827] font-medium"
                          : "text-[#4b5563] hover:text-[#111827] font-normal"
                      }
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
                      to="/my-listings"
                      className={({ isActive }) =>
                        isActive
                          ? "text-[#111827] font-medium"
                          : "text-[#4b5563] hover:text-[#111827] font-normal"
                      }
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
                        className={({ isActive }) =>
                          isActive
                            ? "text-[#176b45] font-medium"
                            : "text-[#4b5563] hover:text-[#111827] font-normal"
                        }
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
            {user ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  className="h-9 w-9 text-[#4b5563] hover:text-[#111827] hover:bg-black/[0.04] rounded-full transition-colors"
                >
                  <NavLink to="/notifications" aria-label="Notifications">
                    <Bell className="h-4 w-4" />
                  </NavLink>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-9 px-3.5 text-[14px] font-normal text-[#111827] bg-white border border-[#e5e7eb] rounded-full hover:bg-[#fafafa] hover:border-[#d1d5db] transition-all shadow-none"
                >
                  <NavLink to="/profile">{user.displayName}</NavLink>
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="h-9 px-4 text-[14px] font-normal text-[#111827] bg-white border border-[#e5e7eb] rounded-full hover:bg-[#fafafa] hover:border-[#d1d5db] transition-all shadow-none"
              >
                <Link to="/login">Sign in</Link>
              </Button>
            )}
            <Button
              size="sm"
              asChild
              className="h-9 px-4 text-[14px] font-medium text-white !text-white bg-[#111827] hover:bg-black rounded-full transition-colors shadow-none"
            >
              <Link to="/sell" className="text-white !text-white font-medium">
                Sell
              </Link>
            </Button>
          </div>

          {/* Mobile Menu Button & Sheet */}
          <div className="flex items-center gap-2 lg:hidden">
            {!user ? (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="h-8 px-3 text-[13px] font-normal text-[#111827] bg-white border border-[#e5e7eb] rounded-full"
              >
                <Link to="/login">Sign in</Link>
              </Button>
            ) : null}
            <Button
              size="sm"
              asChild
              className="h-8 px-3 text-[13px] font-medium text-white !text-white bg-[#111827] hover:bg-black rounded-full"
            >
              <Link to="/sell" className="text-white !text-white">
                Sell
              </Link>
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full border-[#e5e7eb] text-[#111827]"
                  aria-label="Open menu"
                >
                  <MenuIcon className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="top"
                className="max-h-screen overflow-auto bg-white/95 backdrop-blur-xl border-b border-[#ececec]"
              >
                <SheetHeader className="border-b border-[#f0f0f0] pb-3">
                  <SheetTitle>
                    <Link
                      to="/"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-1.5 text-[20px] font-semibold tracking-[-0.03em] text-[#111827]"
                    >
                      <span className="text-[#176b45]">Uni</span>
                      <span>Market</span>
                    </Link>
                  </SheetTitle>
                </SheetHeader>
                <div className="flex flex-col p-4">
                  <Accordion type="single" collapsible className="mt-2 mb-2">
                    <AccordionItem value="browse" className="border-none">
                      <AccordionTrigger className="text-[15px] font-medium text-[#111827] hover:no-underline py-2.5">
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
                                className="rounded-xl p-2.5 transition-colors hover:bg-black/[0.03] block"
                              >
                                <div>
                                  <p className="mb-0.5 text-[14px] font-medium text-[#111827]">
                                    {item.title}
                                  </p>
                                  <p className="text-[12px] text-[#6b7280] line-clamp-1">
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
                  <div className="flex flex-col gap-3 py-2 border-t border-[#f0f0f0]">
                    <Link
                      to="/saved"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-[#4b5563] hover:text-[#111827] transition-colors py-1"
                    >
                      Saved
                    </Link>
                    <Link
                      to="/chats"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-[#4b5563] hover:text-[#111827] transition-colors py-1"
                    >
                      Chats
                    </Link>
                    <Link
                      to="/my-listings"
                      onClick={() => setOpen(false)}
                      className="text-[15px] font-normal text-[#4b5563] hover:text-[#111827] transition-colors py-1"
                    >
                      My listings
                    </Link>
                    {isAdmin ? (
                      <Link
                        to="/admin"
                        onClick={() => setOpen(false)}
                        className="text-[15px] font-medium text-[#176b45] transition-colors py-1"
                      >
                        Admin
                      </Link>
                    ) : null}
                    {user ? (
                      <>
                        <Link
                          to="/notifications"
                          onClick={() => setOpen(false)}
                          className="text-[15px] font-normal text-[#4b5563] hover:text-[#111827] transition-colors py-1"
                        >
                          Notifications
                        </Link>
                        <Link
                          to="/profile"
                          onClick={() => setOpen(false)}
                          className="text-[15px] font-normal text-[#4b5563] hover:text-[#111827] transition-colors py-1"
                        >
                          Profile ({user.displayName})
                        </Link>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#f0f0f0] flex flex-col gap-2.5">
                    {!user ? (
                      <Button
                        variant="outline"
                        asChild
                        className="h-10 text-[14px] font-normal text-[#111827] bg-white border border-[#e5e7eb] rounded-full"
                      >
                        <Link to="/login" onClick={() => setOpen(false)}>
                          Sign in
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      asChild
                      className="h-10 text-[14px] font-medium text-white !text-white bg-[#111827] hover:bg-black rounded-full"
                    >
                      <Link
                        to="/sell"
                        onClick={() => setOpen(false)}
                        className="text-white !text-white font-medium"
                      >
                        Sell
                      </Link>
                    </Button>
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
