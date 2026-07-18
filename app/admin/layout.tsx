import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminNav } from "./nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await auth();
  if (user?.role !== "admin") redirect("/");

  return (
    <div className="max-w-4xl w-full mx-auto my-4 space-y-4 px-4">
      <h1 className="text-3xl font-semibold">Admin</h1>
      <AdminNav />
      {children}
    </div>
  );
}
