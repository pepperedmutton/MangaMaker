import React from "react";
import ReactDOM from "react-dom/client";
import { syncYukinoProject } from "./bootstrap/syncYukinoProject";
import { App } from "./ui/App";
import "./ui/styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

syncYukinoProject();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
