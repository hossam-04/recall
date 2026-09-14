import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.js";
import "./styles.css";
import { applyTheme, storedTheme } from "./theme.js";

// Before `createRoot`, deliberately: applying the theme during React's first
// render would paint the default palette and then repaint, which is the flash
// this whole mechanism exists to avoid.
applyTheme(storedTheme());

const root = document.getElementById("root");
if (root === null) throw new Error("no #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
