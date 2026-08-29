import type { HeatmapCell } from "@/features/dashboard/get-heatmap-data";

export type ClaudeDayUiState =
  | "completed"
  | "available"
  | "locked"
  | "window_closed";

export function mapHeatmapCellToUiState(
  cell: HeatmapCell,
  currentDay: number,
): ClaudeDayUiState {
  if (cell.status === "on_time" || cell.status === "late") {
    return "completed";
  }
  if (cell.dayNumber > currentDay) {
    return "locked";
  }
  // Today with no submission is stored as "future" in heatmap data.
  if (cell.dayNumber === currentDay) {
    return "available";
  }
  if (cell.isRelaxable || cell.status === "rejected") {
    return "available";
  }
  return "window_closed";
}
