"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions/auth-actions";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { useHireDesk } from "@/components/hire/hire-desk-context";
import type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";
import { NewProjectDialog } from "@/components/hire/new-project-dialog";
import { RenameProjectDialog } from "@/components/hire/rename-project-dialog";
import { ProjectAssessmentsList } from "@/components/hire/project-assessments-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  ChartColumn,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Folder,
  FolderKanban,
  FolderOpen,
  House,
  LifeBuoy,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
} from "lucide-react";

/** Projects shown before "Show more" takes over. */
const PROJECTS_COLLAPSED = 6;

/**
 * "2d ago" from an ISO timestamp.
 *
 * Deliberately coarse. The nav card is answering "is this stale?", not "when
 * exactly?", and a minute-accurate string in a rail the recruiter never reads
 * closely is noise that also re-renders more often than it earns.
 */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** "SK" from "sohail khan" — the avatar fallback, initials only. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The nav card on the left of the Scout desk.
 *
 * Six bands, top to bottom: navigation, the current project, that project's
 * recent searches, every project, and the recruiter. The
 * order is deliberate — it narrows from "the whole product" to "this project"
 * to "this account", so the thing a recruiter is looking at is always nearer
 * the top than the thing they might switch to.
 *
 * Analytics has no page yet, so it stays a disabled row rather than a link to
 * nowhere. "+ New Project" and the "+" beside CURRENT PROJECT open the same
 * dialog; "+ New search" asks ScoutChat to start a search inside the open
 * project through the desk context, because that conversation state lives
 * there, not here.
 */
export function HireSidebar({
  account,
  unreadMessages = 0,
  projects = [],
  openProjectId = null,
}: {
  account: RecruiterAccountSnapshot | null;
  /** T-232: outreach threads where the candidate replied since this recruiter last looked. */
  unreadMessages?: number;
  /** Plan 133: the recruiter's projects, for switching. */
  projects?: { id: string; label: string; updatedAt: string }[];
  /** Plan 133: the project in the URL, if any. */
  openProjectId?: string | null;
}) {
  const pathname = usePathname();
  const { openAuth } = useHireAuth();
  const { projectName, requestNewProject, requestNewSearch, project } =
    useHireDesk();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [showAllProjects, setShowAllProjects] = useState(false);

  // Only the project actually in the URL. The desk context outlives the page
  // that set it, so a project left behind must not keep showing here.
  const liveProject = project && project.id === openProjectId ? project : null;

  const openProject = useMemo(
    () => projects.find((p) => p.id === openProjectId) ?? null,
    [projects, openProjectId],
  );

  const visibleProjects = showAllProjects
    ? projects
    : projects.slice(0, PROJECTS_COLLAPSED);

  const name = account?.fullName ?? "Guest";
  const sub = account
    ? `${account.company}’s Dashboard`
    : "Sign in to save searches";

  const currentLabel = projectName || openProject?.label || "Current Project";
  const searchCount = liveProject?.sessions.length ?? 0;
  const currentMeta = [
    liveProject
      ? `${searchCount} ${searchCount === 1 ? "search" : "searches"}`
      : null,
    openProject ? `Updated ${ago(openProject.updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const who = (
    <>
      <span className="hire-side__avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="hire-side__who">
        <span className="hire-side__name">{name}</span>
        <span className="hire-side__sub">{sub}</span>
      </span>
    </>
  );

  return (
    <aside className="hire-side" aria-label="Hire navigation">
      <nav className="hire-side__nav" aria-label="Sections">
        <Link
          href="/hire"
          className={cn("hire-side__item", pathname === "/hire" && "is-current")}
          aria-current={pathname === "/hire" ? "page" : undefined}
        >
          <House className="hire-side__icon" aria-hidden="true" />
          Home
        </Link>
        {/* The Projects/History page, not the contact-request tracker — the
            label and the destination now describe the same thing. */}
        <Link
          href="/hire/projects"
          className={cn(
            "hire-side__item",
            pathname.startsWith("/hire/projects") && "is-current",
          )}
          aria-current={
            pathname.startsWith("/hire/projects") ? "page" : undefined
          }
        >
          <FolderKanban className="hire-side__icon" aria-hidden="true" />
          Search history
        </Link>
        {account && (
          <Link
            href="/hire/messages"
            className={cn(
              "hire-side__item",
              pathname.startsWith("/hire/messages") && "is-current",
            )}
            aria-current={
              pathname.startsWith("/hire/messages") ? "page" : undefined
            }
          >
            <MessageSquare className="hire-side__icon" aria-hidden="true" />
            Messages
            {unreadMessages > 0 && (
              <span className="hire-side__badge">
                {unreadMessages}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </Link>
        )}
        {account && (
          <Link
            href="/hire/settings"
            className={cn(
              "hire-side__item",
              pathname.startsWith("/hire/settings") && "is-current",
            )}
            aria-current={
              pathname.startsWith("/hire/settings") ? "page" : undefined
            }
          >
            <Settings className="hire-side__icon" aria-hidden="true" />
            Settings
          </Link>
        )}
        {/* Phones only: the header drops its Jobs / Assessments pills to fit
            the menu button, so the drawer carries them instead. */}
        <Link
          href="/hire/jobs"
          className={cn(
            "hire-side__item hire-side__item--phone",
            pathname.startsWith("/hire/jobs") && "is-current",
          )}
          aria-current={pathname.startsWith("/hire/jobs") ? "page" : undefined}
        >
          <Briefcase className="hire-side__icon" aria-hidden="true" />
          Jobs
        </Link>
        <Link
          href="/hire/assessments"
          className={cn(
            "hire-side__item hire-side__item--phone",
            pathname.startsWith("/hire/assessments") && "is-current",
          )}
          aria-current={
            pathname.startsWith("/hire/assessments") ? "page" : undefined
          }
        >
          <ClipboardCheck className="hire-side__icon" aria-hidden="true" />
          Assessments
        </Link>
        <span
          className="hire-side__item is-disabled"
          aria-disabled="true"
          title="Coming soon"
        >
          <ChartColumn className="hire-side__icon" aria-hidden="true" />
          Analytics
        </span>
      </nav>

      {/* Current project ------------------------------------------------- */}
      <section className="hire-side__section" aria-label="Current project">
        <div className="hire-side__head">
          <h2 className="hire-side__kicker">Current project</h2>
          <button
            type="button"
            className="hire-side__headbtn"
            onClick={() =>
              account ? setNewProjectOpen(true) : requestNewProject()
            }
            aria-label="New project"
            title="New project"
          >
            <Plus className="hire-side__headicon" aria-hidden="true" />
          </button>
        </div>

        <div className="hire-side__card">
          <FolderOpen className="hire-side__cardicon" aria-hidden="true" />
          <span className="hire-side__cardtext">
            <span className="hire-side__cardname">{currentLabel}</span>
            {/* suppressHydrationWarning: the server and the browser call
                Date.now() milliseconds apart, so "2d ago" can straddle a
                boundary and render as two different strings. The browser's is
                the right one and wins; without this React logs a mismatch for
                a difference that does not matter. */}
            {currentMeta && (
              <span className="hire-side__cardmeta" suppressHydrationWarning>
                {currentMeta}
              </span>
            )}
          </span>
          {liveProject && openProject && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="hire-side__more"
                    aria-label={`Actions for ${openProject.label}`}
                  />
                }
              >
                <MoreHorizontal className="hire-side__moreicon" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() =>
                    setRenaming({
                      id: openProject.id,
                      name: openProject.label,
                    })
                  }
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </section>

      {/* Recent searches -------------------------------------------------- */}
      {liveProject && (
        <section className="hire-side__section" aria-label="Recent searches">
          <div className="hire-side__head">
            <h2 className="hire-side__kicker">Recent searches</h2>
            <Link href={`/hire/${liveProject.id}`} className="hire-side__headlink">
              View all
            </Link>
          </div>

          {liveProject.sessions.length === 0 ? (
            <p className="hire-side__empty">No searches in this project yet.</p>
          ) : (
            <ul className="hire-side__list">
              {liveProject.sessions.map((s) => {
                const meta = [
                  ago(s.createdAt),
                  typeof s.matchCount === "number"
                    ? `${s.matchCount} result${s.matchCount === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const active = s.id === liveProject.activeSessionId;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/hire/${liveProject.id}?session=${s.id}`}
                      className={cn("hire-side__row", active && "is-current")}
                      aria-current={active ? "page" : undefined}
                      title={s.title}
                    >
                      <Clock className="hire-side__rowicon" aria-hidden="true" />
                      <span className="hire-side__rowtext">
                        <span className="hire-side__rowname">{s.title}</span>
                        {meta && (
                          <span
                            className="hire-side__rowmeta"
                            suppressHydrationWarning
                          >
                            {meta}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            className="hire-side__new"
            onClick={requestNewSearch}
          >
            <Plus className="hire-side__newicon" aria-hidden="true" />
            New search
          </button>

        </section>
      )}

      {/* Assessments ------------------------------------------------------ */}
      {liveProject && (
        <section className="hire-side__section" aria-label="Assessments">
          <div className="hire-side__head">
            <h2 className="hire-side__kicker">Assessments</h2>
          </div>
          <ProjectAssessmentsList
            projectId={liveProject.id}
            assessments={liveProject.assessments}
            unassigned={liveProject.unassignedAssessments}
          />
        </section>
      )}

      {/* All projects ----------------------------------------------------- */}
      {account && projects.length > 0 && (
        <section className="hire-side__section" aria-label="All projects">
          <div className="hire-side__head">
            <h2 className="hire-side__kicker">All projects</h2>
            <button
              type="button"
              className="hire-side__headlink"
              onClick={() => setNewProjectOpen(true)}
            >
              <Plus className="hire-side__headicon" aria-hidden="true" />
              New Project
            </button>
          </div>

          <ul className="hire-side__list">
            {visibleProjects.map((p) => {
              const active = p.id === openProjectId;
              return (
                <li key={p.id} className="hire-side__projectli">
                  <Link
                    href={`/hire/${p.id}`}
                    className={cn("hire-side__row", active && "is-current")}
                    aria-current={active ? "page" : undefined}
                    title={p.label}
                  >
                    <Folder className="hire-side__rowicon" aria-hidden="true" />
                    <span className="hire-side__rowtext">
                      <span className="hire-side__rowname">{p.label}</span>
                    </span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className="hire-side__more hire-side__more--row"
                          aria-label={`Actions for ${p.label}`}
                        />
                      }
                    >
                      <MoreHorizontal
                        className="hire-side__moreicon"
                        aria-hidden="true"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() =>
                          setRenaming({ id: p.id, name: p.label })
                        }
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Rename
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>

          {projects.length > PROJECTS_COLLAPSED && (
            <button
              type="button"
              className="hire-side__showmore"
              onClick={() => setShowAllProjects((v) => !v)}
              aria-expanded={showAllProjects}
            >
              <ChevronDown
                className={cn(
                  "hire-side__showicon",
                  showAllProjects && "is-open",
                )}
                aria-hidden="true"
              />
              {showAllProjects
                ? "Show less"
                : `Show more (${projects.length - PROJECTS_COLLAPSED})`}
            </button>
          )}
        </section>
      )}

      {!account && (
        <button
          type="button"
          className="hire-side__new hire-side__new--standalone"
          onClick={requestNewProject}
        >
          <Plus className="hire-side__newicon" aria-hidden="true" />
          Create New Project
        </button>
      )}

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      {/* Keyed on the project so switching which one is being renamed remounts
          the dialog and re-seeds its field, instead of offering the previous
          project's name. */}
      <RenameProjectDialog
        key={renaming?.id ?? "none"}
        open={renaming !== null}
        onOpenChange={(next) => !next && setRenaming(null)}
        requestId={renaming?.id ?? null}
        currentName={renaming?.name ?? ""}
      />

      <div className="hire-side__foot">
        <Link href="/contact" className="hire-side__item hire-side__item--quiet">
          <LifeBuoy className="hire-side__icon" aria-hidden="true" />
          Support
        </Link>

        {/* Recruiter ------------------------------------------------------ */}
        {account ? (
          <div className="hire-side__me">
            {who}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="hire-side__more"
                    aria-label="Account actions"
                  />
                }
              >
                <MoreHorizontal className="hire-side__moreicon" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  render={<Link href="/hire/settings" />}
                  className="cursor-pointer"
                >
                  <Settings className="size-3.5" aria-hidden="true" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                    Sign out
                  </button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <button
            type="button"
            className="hire-side__me"
            onClick={() => openAuth("nav")}
          >
            {who}
          </button>
        )}
      </div>

    </aside>
  );
}
