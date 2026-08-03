"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkspaceTabs() {
  const path = usePathname();
  return (
    <nav className="topbar-tabs">
      <Link href="/" className={path === "/" ? "active" : ""}>
        واتساب
      </Link>
      <Link href="/market" className={path.startsWith("/market") ? "active" : ""}>
        السوق
      </Link>
    </nav>
  );
}
