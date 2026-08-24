import { redirect } from "next/navigation";

/** Old bookmark. Recruiters and seats now live on one page. */
export default function AdminRecruiterSeatsRedirect() {
  redirect("/admin/recruiters");
}
