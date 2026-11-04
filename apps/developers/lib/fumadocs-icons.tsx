// Fumadocs UI and Fumadocs OpenAPI import their icons by name from one package, from deep inside their own components (the callout, the
// code block, the sidebar, the search dialog, the theme switch, ...), where no prop or slot reaches them. next.config.mjs points that
// import at this module instead, so every icon the docs chrome draws is a Unitfield icon.
//
// Each export keeps the name Fumadocs asks for and is one adopted Unitfield icon (`@unitfield/ui/icons`). A name Fumadocs adds later
// is not exported here, and the build stops on it instead of shipping the other package's drawing: add it below, with the adopted icon
// that means the same thing.
import * as uf from "@unitfield/ui/icons";
import { forwardRef, type ComponentType, type RefAttributes, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; label?: string; title?: string };

/**
 * Fumadocs fills an icon to show a state (`fill-current` on the active theme, a tinted fill on a callout). A Unitfield icon is never
 * filled by CSS: a filled state is the set's own Bold or Bulk drawing, and a fill painted over a stroked drawing only blots it. So the
 * fill classes are dropped here, and a stroke-width prop has nothing to act on (an icon is drawn at its own weight).
 */
function plain(unitfieldIcon: typeof uf.CheckIcon) {
  // @unitfield/ui is type-checked against the dashboard's copy of the React types: the same shapes, but not the same declarations.
  const Icon = unitfieldIcon as unknown as ComponentType<IconProps & RefAttributes<SVGSVGElement>>;
  const Plain = forwardRef<SVGSVGElement, IconProps>(function PlainIcon({ className, fill: _fill, ...props }, ref) {
    const kept = className
      ?.split(/\s+/)
      .filter((token) => token && !/^(?:[\w-]+:)*-?fill(?:$|-)/.test(token))
      .join(" ");
    return <Icon {...props} className={kept || undefined} ref={ref} />;
  });
  Plain.displayName = `Plain(${Icon.displayName ?? "Icon"})`;
  return Plain;
}

// Names Fumadocs asks for that are already the Unitfield icon's own.
export const CheckIcon = plain(uf.CheckIcon);
export const ChevronRightIcon = plain(uf.ChevronRightIcon);
export const DownloadIcon = plain(uf.DownloadIcon);
export const ExternalLinkIcon = plain(uf.ExternalLinkIcon);
export const FilterIcon = plain(uf.FilterIcon);
export const FolderIcon = plain(uf.FolderIcon);
export const HomeIcon = plain(uf.HomeIcon);
export const LinkIcon = plain(uf.LinkIcon);
export const PlusIcon = plain(uf.PlusIcon);
export const SearchIcon = plain(uf.SearchIcon);

// Navigation and disclosure
export const ChevronRight = plain(uf.ChevronRightIcon);
export const ChevronDown = plain(uf.ChevronDownIcon);
export const ChevronLeft = plain(uf.ChevronLeftIcon);
export const ChevronsUpDown = plain(uf.ChevronsUpDownIcon);
export const ArrowLeft = plain(uf.ArrowLeftIcon);
export const Sidebar = plain(uf.SidebarLeftIcon);
export const SidebarIcon = plain(uf.SidebarLeftIcon);
export const Hash = plain(uf.HashtagIcon);
export const Text = plain(uf.TextAlignLeftIcon);
export const TextIcon = plain(uf.TextAlignLeftIcon);

// Actions
export const Search = plain(uf.SearchIcon);
export const X = plain(uf.CloseIcon);
export const XIcon = plain(uf.CloseIcon);
export const Check = plain(uf.CheckIcon);
export const CopyCheckIcon = plain(uf.CheckIcon);
export const Copy = plain(uf.CopyIcon);
export const Clipboard = plain(uf.ClipboardIcon);
export const Edit = plain(uf.EditIcon);
export const ExternalLink = plain(uf.ExternalLinkIcon);
export const Plus = plain(uf.PlusIcon);
export const Trash2 = plain(uf.DeleteIcon);
export const Upload = plain(uf.UploadIcon);
export const FilterXIcon = plain(uf.FilterClearIcon);
export const Loader2Icon = plain(uf.LoadingIcon);
export const Play = plain(uf.PlayIcon);
export const SendHorizontal = plain(uf.SendIcon);

// Theme switch and language select
export const Sun = plain(uf.SunIcon);
export const Moon = plain(uf.MoonIcon);
export const Airplay = plain(uf.ComputerIcon);
export const Languages = plain(uf.GlobeIcon);
export const LanguagesIcon = plain(uf.GlobeIcon);

// Callouts
export const Info = plain(uf.InfoCircleIcon);
export const TriangleAlert = plain(uf.WarningIcon);
export const CircleAlert = plain(uf.WarningCircleIcon);
export const CircleX = plain(uf.CloseCircleIcon);
export const CircleCheck = plain(uf.CheckCircleIcon);
export const Lightbulb = plain(uf.IdeaIcon);

// Files and feedback
export const FileIcon = plain(uf.DocumentIcon);
export const FolderOpen = plain(uf.FolderOpenIcon);
export const MessageCircleIcon = plain(uf.ChatIcon);

// Only in components this site does not render (the OpenAPI "Try it" playground is off, there is no GitHub repository card). The
// closest adopted icon stands in so the module resolves; they are listed in the icon report as still needing a proper drawing.
export const Star = plain(uf.StarIcon);
export const GitFork = plain(uf.ShareIcon);
export const Braces = plain(uf.CodeIcon);
export const Cookie = plain(uf.CircleIcon);
export const KeyRound = plain(uf.KeyIcon);
export const Rows3 = plain(uf.ListIcon);
export const Route = plain(uf.MapIcon);
export const ShieldCheck = plain(uf.ShieldCheckIcon);
export const SlidersHorizontal = plain(uf.FilterIcon);
