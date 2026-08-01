import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./index.css";

// Messages follows the system appearance, so this app does too.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyAppearance = (matches: boolean) => {
  document.documentElement.classList.toggle("dark", matches);
  document.documentElement.style.colorScheme = matches ? "dark" : "light";
};
applyAppearance(dark.matches);
dark.addEventListener("change", (event) => applyAppearance(event.matches));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
