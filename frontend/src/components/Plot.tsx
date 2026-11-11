"use client";

import dynamic from "next/dynamic";
import type { Data, Layout } from "plotly.js";
import { useTheme } from "./theme";
import { Skeleton } from "./ui";

const Plotly = dynamic(
  async () => {
    const [{ default: factory }, plotly] = await Promise.all([import("react-plotly.js/factory"), import("plotly.js-dist-min")]);
    return factory(plotly.default ?? plotly);
  },
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
);

export const PALETTE = { light: { sapphire: "#1f4fd1", copper: "#b4652d", crit: "#b42335", ok: "#1f7a4d", muted: "#8a939d" }, dark: { sapphire: "#7ea2ff", copper: "#e39a63", crit: "#ff8a96", ok: "#6fd3a0", muted: "#6b747e" } };

export function Plot({ data, layout, height = 280, label }: { data: Data[]; layout?: Partial<Layout>; height?: number; label: string }) {
  const { theme } = useTheme();
  const c = PALETTE[theme === "dark" ? "dark" : "light"];
  const ink = theme === "dark" ? "#e6e9ed" : "#1b1f24";
  const grid = theme === "dark" ? "#2c3138" : "#e6e9ee";
  return (
    <div role="img" aria-label={label}>
      <Plotly
        data={data}
        useResizeHandler
        style={{ width: "100%", height }}
        config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] }}
        layout={{ autosize: true, height, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: ink, size: 12, family: "Inter, system-ui, sans-serif" }, colorway: [c.sapphire, c.copper, c.ok, c.crit, c.muted], margin: { l: 44, r: 12, t: 8, b: 40 }, legend: { orientation: "h", y: -0.2 }, xaxis: { gridcolor: grid, zeroline: false }, yaxis: { gridcolor: grid, zeroline: false, rangemode: "tozero" }, bargap: 0.3, ...layout }}
      />
    </div>
  );
}
