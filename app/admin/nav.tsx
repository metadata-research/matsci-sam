"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/terms", label: "Terms" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/prompts", label: "Prompts" },
  { href: "/admin/integrations", label: "Integrations" },
];

export const AdminNav = () => {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-1 border-b pb-2 overflow-x-auto">
      {SECTIONS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm whitespace-nowrap",
            isActive(href)
              ? "bg-secondary font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
};
