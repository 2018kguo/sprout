import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { load } from "./store";

load();
const app = <StrictMode><App /></StrictMode>;
// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(document.getElementById("root")!)).render(app);
